// Local file selection uses a disposable profile, never a user's Chrome session.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { viewerPdf } from '../test/fixtures/pdf-viewer.mjs';
import { emailMetadataSample } from '../test/fixtures/additional-document-formats.mjs';
import { spreadsheetEntries, presentationEntries } from '../test/fixtures/office-formats.mjs';
import { storedZip } from '../test/fixtures/zip.mjs';

const { chromium } = await import(process.env.CONTEXT_PLAYWRIGHT ? pathToFileURL(process.env.CONTEXT_PLAYWRIGHT).href : 'playwright');
const profile = await mkdtemp(join(tmpdir(), 'cg-local-document-qa-'));
const samples = resolve('test-dist/document-preview/local');
const emailOnly=process.env.DOCUMENT_QA==='email';
await mkdir(samples, { recursive: true });
const rtf = Buffer.from('{\\rtf1\\ansi Local document preview.\\par Original file stays on this device.'+'\\par A paragraph for scrolling and document gesture zoom.'.repeat(100)+'}');
await writeFile(join(samples, 'sample.rtf'), rtf);
await writeFile(join(samples, 'sample.pdf'), viewerPdf(1));
const email=emailMetadataSample.replace('<h2>Email content</h2><p>HTML body</p>', '<div hidden>Hidden preheader</div><h2>Project reading notes</h2><p>Hello Alex,</p><p>Here are the <strong>updated reading notes</strong> for our next discussion.</p><table><tr><td>Session</td><td>Friday, 10:00</td></tr><tr><td>Topic</td><td>Design decisions and trade-offs</td></tr></table><blockquote><p>Earlier message: please review the examples before the meeting.</p></blockquote><p><a href=3D"mailto:contact@example.test">Contact the team</a></p><table border=3D"1" cellpadding=3D"6"><tr><td>Explicit table border</td><td>Preserved</td></tr></table><p>Thank you,<br>The reading group</p>');
await writeFile(join(samples,'sample.eml'),email);
await writeFile(join(samples,'plain.eml'),'From: Example <contact@example.test>\r\nTo: reader@example.test\r\nSubject: Plain text reading notes\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nHello Alex,\r\n\r\n  Two spaces stay here.\r\n    Four spaces stay here.\r\n\r\nRegards,\r\nExample');
for(const [format,entries] of [['xlsx',spreadsheetEntries()],['pptx',presentationEntries()]]) await writeFile(join(samples,'sample.'+format),Buffer.from(storedZip(entries)));
await writeFile(join(samples, 'README.md'), '# Local document fixtures\n\nSynthetic RTF/PDF/EML/XLSX/PPTX files, gesture tests, and light/dark/narrow EML screenshots from `scripts/test-document-local-browser.mjs`. The script recreates fixtures in this ignored directory. It tests native file selection, RAM-backed reload, safe mail layout, and ctrl-wheel pinch zoom across document/sheet/slide readers using a disposable Chrome profile. Use `DOCUMENT_QA=email` for metadata-only changes; screenshots include default, expanded, bilingual, and narrow mail layouts. No personal files or browser profiles are saved here.\n');
await mkdir(join(profile,'Default'),{recursive:true});
await writeFile(join(profile,'Default','Preferences'),JSON.stringify({download:{default_directory:join(profile,'downloads'),prompt_for_download:false}}));
const extension = resolve('extension');
let context;
try {
  context = await chromium.launchPersistentContext(profile, { headless: true, executablePath: process.env.CONTEXT_CHROME,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const id = new URL(worker.url()).host, settings = await context.newPage();
  const cdp = await context.newCDPSession(settings);
  await cdp.send('Browser.setDownloadBehavior',{behavior:'default'});
  const external = [];
  context.on('request', request => { if (/^https?:/.test(request.url())) external.push(request.url()); });
  await settings.goto(`chrome-extension://${id}/settings/satellites.html`);
  const button = settings.locator('#documentOpenFile');
  await button.waitFor(); await settings.waitForFunction(() => document.documentElement.dataset.localePending !== 'true');
  assert.equal(await settings.locator('#documentPreviewEnabled').isChecked(), false);
  assert.equal(await button.isEnabled(), true);
  assert.equal(await settings.locator('#documentPreviewOptions').evaluate(node => node.disabled), true);
  const choose = async payload => {
    const chooser = settings.waitForEvent('filechooser'); await button.click();
    await (await chooser).setFiles(payload);
  };
  async function gesture(reader, selector) {
    const frame=await (await reader.locator('#document').elementHandle()).contentFrame();
    const box=await frame.locator(selector).first().boundingBox(), toolbar=await reader.locator('header').boundingBox();
    const x=box.x+Math.min(box.width/2,300), y=Math.min(box.y+100,700);
    const session=await context.newCDPSession(reader);
    await session.send('Input.dispatchMouseEvent',{type:'mouseWheel',x,y,deltaX:0,deltaY:-40,modifiers:2});
    await reader.waitForFunction(()=>parseInt(document.querySelector('#zoom-reset').textContent)>100);
    assert.ok(parseInt(await reader.locator('#zoom-reset').textContent())<130,'pinch changes scale continuously');
    assert.deepEqual(await reader.locator('header').boundingBox(),toolbar,'the toolbar never scales');
    await reader.locator('#zoom-reset').click();await reader.waitForFunction(()=>document.querySelector('#zoom-reset').textContent==='100%');
    await session.send('Input.dispatchMouseEvent',{type:'mouseWheel',x,y,deltaX:0,deltaY:100});
    assert.equal(await reader.locator('#zoom-reset').textContent(),'100%','ordinary scrolling does not zoom');
    await session.detach();
    return frame;
  }
  let preview;
  if(!emailOnly) {
    // Cancelling the picker must not open a preview or change any preference.
    const before = context.pages().length;
    await choose([]); assert.equal(context.pages().length, before);
    await choose({name:'unsupported.txt',mimeType:'text/plain',buffer:Buffer.from('unsupported file')});
    await settings.locator('.document-open-message').filter({hasText:/supported file formats/}).waitFor();
    assert.equal(context.pages().length, before);
    await choose({name:'empty.pdf',mimeType:'application/pdf',buffer:Buffer.alloc(0)});
    await settings.locator('.document-open-message').filter({hasText:/empty or too large/}).waitFor();
    const opened = context.waitForEvent('page');
    await choose(join(samples, 'sample.rtf')); preview = await opened;
    await preview.waitForURL(/document-preview.html/);
    await preview.frameLocator('#document').locator('body').filter({hasText:'Local document preview.'}).waitFor();
    await gesture(preview,'p');
    assert.equal(await preview.locator('#metadata').textContent(), 'Local file · documents');
    assert.equal(await settings.locator('#documentPreviewEnabled').isChecked(), false);
    const sourceIndex = await settings.evaluate(async () => (await chrome.tabs.getCurrent()).index);
    const previewIndex = await preview.evaluate(async () => (await chrome.tabs.getCurrent()).index);
    assert.equal(previewIndex, sourceIndex + 1);
    await preview.locator('#download').click();
    const file = await preview.evaluate(async()=> {
      for (let i=0;i<100;i++) {
        const found=(await chrome.downloads.search({state:'complete'})).find(file=>file.filename.endsWith('/sample.rtf'));
        if(found) return found;
        await new Promise(resolve=>setTimeout(resolve,50));
      }
      throw Error('Original download did not complete: '+JSON.stringify(await chrome.downloads.search({})));
    });
    const { readFile } = await import('node:fs/promises');
    assert.equal(file.filename,join(profile,'downloads','sample.rtf'));
    assert.deepEqual(await readFile(file.filename), rtf);
    const session = await settings.evaluate(()=>chrome.storage.session.get('documentPreview:regular'));
    const record = session['documentPreview:regular'].documents[0];
    assert.equal(record.local,true);
    assert.equal(record.url,'');
    assert.equal(Object.hasOwn(record,'blob'),false,'session storage contains metadata, never file contents or a disk copy');
    await preview.reload();
    await preview.frameLocator('#document').locator('body').filter({hasText:'Local document preview.'}).waitFor();
  }
  for(const format of (emailOnly?['eml']:['eml','xlsx','pptx'])) {
    const opening=context.waitForEvent('page');await choose(join(samples,'sample.'+format));const reader=await opening;
    await reader.waitForURL(/document-preview.html/);await reader.waitForFunction(()=>document.querySelector('#document').style.visibility==='visible');
    const frame=await gesture(reader,format==='pptx'?'.cg-slide-page':format==='xlsx'?'table':'.cg-email-body');
    if(format==='eml') {
      assert.equal(await frame.locator('.cg-email-subject').textContent(),'邮件预览');
      assert.equal(await frame.locator('.cg-email-attachment-name').textContent(),'test.exe');
      assert.equal(await frame.locator('.cg-email-attachment-size').textContent(),'21 bytes');
      assert.equal(await frame.getByText('Hidden preheader').isVisible(),false);
      assert.equal(await frame.locator('.cg-email-body table').first().locator('td').first().evaluate(e=>getComputedStyle(e).borderTopWidth),'0px');
      assert.equal(await frame.locator('.cg-email-body table').last().locator('td').first().evaluate(e=>getComputedStyle(e).borderTopWidth),'1px');
      assert.equal(await frame.locator('.cg-email-body :is(img,script,iframe,style)').count(),0);
      assert.equal(await frame.locator('.cg-email-attachment a,.cg-email-attachment button').count(),0);
      const envelope=frame.locator('.cg-email-header>.cg-email-fields');
      for(const label of ['Sent by','Reply to','Bcc'])assert.equal(await envelope.getByText(label,{exact:true}).count(),1);
      assert.equal(await frame.locator('details').count(),2);
      assert.equal(await frame.locator('details[open]').count(),0,'both inspection sections start collapsed');
      assert.equal(await frame.locator('.cg-email-detail-content').isVisible(),false);
      await frame.evaluate(()=>window.scrollTo(0,0));
      await reader.screenshot({path:join(samples,'email-light.png')});
      await frame.locator('.cg-email-details>summary').press('Enter');
      await frame.locator('.cg-email-details[open]').waitFor();
      assert.equal(await frame.locator('.cg-email-detail-content').getByText('Message-ID',{exact:true}).isVisible(),true);
      assert.equal(await frame.locator('.cg-email-details :is(img,script,a,iframe)').count(),0,'metadata is inert text, not markup or links');
      await frame.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      await reader.screenshot({path:join(samples,'email-details-light.png')});
      await frame.locator('.cg-email-details>summary').click();
      await reader.locator('#theme-toggle').click();await frame.waitForFunction(()=>document.documentElement.dataset.dark==='true');
      await reader.screenshot({path:join(samples,'email-dark.png')});
      await frame.locator('.cg-email-raw>summary').press('Space');await frame.locator('.cg-email-raw[open]').waitFor();
      const raw=frame.locator('.cg-email-raw-text');
      assert.match(await raw.textContent(),/X-Unknown-Header: <script>neverExecute\(\)<\/script>/);
      assert.match(await raw.textContent(),/;\n\tTue, 22 Sep/);assert.doesNotMatch(await raw.textContent(),/HTML body|TVpOb3R/);
      assert.equal(await raw.locator('*').count(),0);assert.ok(await raw.evaluate(e=>e.clientHeight<=360));
      await frame.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      await reader.screenshot({path:join(samples,'email-headers-dark.png')});
      await frame.locator('.cg-email-raw>summary').click();
      await reader.setViewportSize({width:480,height:800});
      await frame.evaluate(()=>window.scrollTo(0,0));
      assert.equal(await frame.locator('.cg-email-attachment-list').evaluate(e=>getComputedStyle(e).gridTemplateColumns.split(' ').length),1);
      assert.equal(await frame.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      await reader.screenshot({path:join(samples,'email-narrow.png')});
      await reader.setViewportSize({width:1280,height:900});
      await frame.locator('a[data-external-link]').click();await frame.locator('dialog[open]').waitFor();
      const oldZoom=await reader.locator('#zoom-reset').textContent();
      await frame.evaluate(()=>window.dispatchEvent(new WheelEvent('wheel',{ctrlKey:true,deltaY:-50,cancelable:true})));
      assert.equal(await reader.locator('#zoom-reset').textContent(),oldZoom,'capture dialogs suspend document pinches');
    } else if(format==='pptx') {
      const width=await frame.locator('.cg-slide-rail').evaluate(e=>e.getBoundingClientRect().width);
      await reader.locator('#zoom-in').click();await reader.waitForFunction(()=>document.querySelector('#zoom-reset').textContent==='110%');
      assert.equal(await frame.locator('.cg-slide-rail').evaluate(e=>e.getBoundingClientRect().width),width);
      await reader.locator('#part-next').click();await frame.locator('[aria-current=page][data-index="1"]').waitFor();
    } else {
      await reader.locator('#part-next').click();
      await reader.frameLocator('#document').getByText('第二张表').waitFor();
    }
    await reader.close();
  }
  const plainOpening=context.waitForEvent('page');await choose(join(samples,'plain.eml'));const plain=await plainOpening;
  await plain.frameLocator('#document').locator('.cg-email-plain>pre').waitFor();
  assert.equal(await plain.frameLocator('#document').locator('.cg-email-plain>pre').evaluate(e=>getComputedStyle(e).whiteSpace),'break-spaces');
  assert.equal(await plain.frameLocator('#document').locator('.cg-email-attachments').count(),0);await plain.close();
  await settings.locator('#language').selectOption('zh-CN');
  await button.filter({hasText:'打开文件'}).waitFor();
  if(emailOnly) {
    const opening=context.waitForEvent('page');await choose(join(samples,'sample.eml'));const reader=await opening;
    const frame=reader.frameLocator('#document');
    await frame.locator('.cg-email-details>summary').filter({hasText:'邮件详情'}).waitFor();
    assert.equal(await frame.locator('.cg-email-raw>summary').textContent(),'原始邮件头');
    for(const label of ['代发方','回复地址','密送'])assert.equal(await frame.locator('.cg-email-header>.cg-email-fields').getByText(label,{exact:true}).count(),1);
    await frame.locator('.cg-email-details>summary').click();
    assert.equal(await frame.getByText('身份验证邮件头',{exact:true}).isVisible(),true);
    await reader.setViewportSize({width:480,height:800});
    await reader.screenshot({path:join(samples,'email-details-zh-narrow.png')});
    await reader.close();
  }
  let pdf;
  if(!emailOnly) {
    const pdfOpened = context.waitForEvent('page'); await choose(join(samples, 'sample.pdf'));
    pdf = await pdfOpened;
    await pdf.waitForURL(/document-preview.html/);
    await pdf.frameLocator('iframe.pdf-viewer-frame').locator('.page canvas').first().waitFor();
    assert.equal(await pdf.locator('#metadata').textContent(), '本地文件 · PDF');
    await settings.close();
    await pdf.frameLocator('iframe.pdf-viewer-frame').locator('.textLayer').first().filter({hasText:'PDF Viewer page 1'}).waitFor();
    await pdf.reload();
    await pdf.frameLocator('iframe.pdf-viewer-frame').locator('.page canvas').first().waitFor();
  }
  assert.deepEqual(external, [], 'local previews do not make website requests');
  const extensions = await context.newPage(); await extensions.goto('chrome://extensions');
  const errors = await extensions.evaluate(id => new Promise(resolve => chrome.developerPrivate.getExtensionsInfo(
    {includeDisabled:true,includeTerminated:true}, items => resolve(items.find(item=>item.id===id)?.runtimeErrors || []))), id);
  assert.deepEqual(errors, []);
  await pdf?.close(); await preview?.close();
  await worker.evaluate(async()=>{
    for(let attempt=0;attempt<50;attempt++) {
      const saved=(await chrome.storage.session.get('documentPreview:regular'))['documentPreview:regular'];
      if (!saved?.documents.some(doc=>doc.local)) return;
      await new Promise(resolve=>setTimeout(resolve,20));
    }
    throw Error('Local file references were not released after closing previews.');
  });
  console.log(emailOnly?'PASS: bilingual email envelope and grouped/raw metadata, default-collapsed keyboard-accessible sections, inert hostile headers, light/dark/narrow layouts, plain mail, no remote requests or extension errors.':'PASS: native file selection, RTF/EML/XLSX/PPTX gesture zoom, fixed toolbar/slide rail, email headers/body/tables/inert attachments, light/dark/narrow layouts, plain-text spacing, PDF preview, RAM-backed reload/cleanup, no network or extension errors.');
} finally { await context?.close(); await rm(profile, { recursive:true, force:true }); }
