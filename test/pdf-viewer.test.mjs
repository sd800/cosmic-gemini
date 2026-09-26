import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { PDF_LIMITS, pdfDetailCanvasPixels, pdfScale, stepPdfScale, pdfOptions, printRange, rotateLeft, safePdfLink, pdfFileSize } from '../extension/workspaces/pdf-viewer/model.js';
import { formatPdfDate } from '../extension/workspaces/pdf-viewer/document-dates.js';
import { labels } from '../extension/workspaces/pdf-viewer/labels.js';
import { createPdfViewer } from '../extension/workspaces/pdf-viewer/host.js';
import { toggleDocumentAppearance } from '../extension/core/document-preview/document-appearance.js';
const root = new URL('../extension/', import.meta.url);
test('PDF properties preserve ISO date order, optional seconds and original offsets', () => {
  assert.equal(formatPdfDate("D:20260102123456+05'30'"), '2026-01-02 12:34:56 (UTC+5:30)');
  assert.equal(formatPdfDate("D:202602031012-08'00'"), '2026-02-03 10:12 (UTC-8)');
  assert.equal(formatPdfDate('D:20260923080000Z'), '2026-09-23 08:00:00 (UTC)');
  assert.equal(formatPdfDate('202402291030'), '2024-02-29 10:30');
  assert.equal(formatPdfDate('D:20260923103000'), '2026-09-23 10:30:00');
  assert.equal(formatPdfDate('D:20260923'), '2026-09-23 00:00');
  assert.equal(formatPdfDate('D:2026'), '2026-01-01 00:00');
  assert.equal(formatPdfDate('D:202609231030+0545'), '2026-09-23 10:30 (UTC+5:45)');
  for (const [offset, zone] of [['+0800', 'UTC+8'], ['-0500', 'UTC-5'], ['-0030', 'UTC-0:30'], ['+1245', 'UTC+12:45'], ['+0000', 'UTC+0']]) {
    assert.equal(formatPdfDate('D:202609231030' + offset), `2026-09-23 10:30 (${zone})`);
  }
  for (const value of [undefined, null, {}, '', '<b>2026</b>', 'D:20260229120000', 'D:20261301', 'D:202601012400', 'D:202601010060', "D:202601010000+24'00'", "D:202601010000+05'60'", '2'.repeat(81)]) assert.equal(formatPdfDate(value), '', String(value));
});
test('PDF properties show validated decimal file sizes with at most one decimal', () => {
  assert.equal(pdfFileSize(1), '1 byte'); assert.equal(pdfFileSize(999), '999 bytes');
  assert.equal(pdfFileSize(1234), '1.2 KB'); assert.equal(pdfFileSize(1200000), '1.2 MB');
  assert.equal(pdfFileSize(999, 'zh-CN'), '999 字节');
  for (const value of [undefined, -1, 1.5, NaN, Infinity, '1000']) assert.equal(pdfFileSize(value), '');
});
test('single PDF appearance control returns to the configured default', () => {
  for (const systemDark of [true, false]) for (const base of ['light','dark','auto']) {
    const opposite = toggleDocumentAppearance(base, null, systemDark);
    const dark = base === 'dark' || (base === 'auto' && systemDark);
    assert.equal(opposite, dark ? 'light' : 'dark');
    assert.equal(toggleDocumentAppearance(base, opposite, systemDark), null);
    assert.equal(toggleDocumentAppearance(base, dark ? 'dark' : 'light', systemDark), opposite, 'same-as-default site override still switches visibly');
  }
});
test('PDF Viewer applies read-only asset and resource boundaries', () => {
  const data = new Uint8Array([1,2]);
  const options = pdfOptions(data, 'chrome-extension://test/vendor/pdfjs/');
  assert.equal(options.data, data); assert.equal(options.isEvalSupported, false); assert.equal(options.enableXfa, false);
  assert.equal(options.disableAutoFetch, true); assert.equal(options.useWorkerFetch, false);
  assert.equal(options.cMapUrl, 'chrome-extension://test/vendor/pdfjs/cmaps/');
  assert.ok(options.maxImageSize <= 32 * 1024 * 1024);
  assert.equal(safePdfLink('javascript:alert(1)'), null); assert.equal(safePdfLink('data:text/html,hello'), null);
  assert.equal(safePdfLink('file:///etc/passwd'), null); assert.equal(safePdfLink('https://example.com/'), 'https://example.com/');
  assert.equal(safePdfLink('mailto:a@example.com'), 'mailto:a@example.com');
  assert.equal(rotateLeft(0), 270); assert.equal(rotateLeft(90), 0);
  assert.equal(pdfScale(100), 5); assert.equal(pdfScale(.01), .25);
  assert.equal(stepPdfScale(stepPdfScale(1, 1), 1), 1.2);
  assert.equal(stepPdfScale(stepPdfScale(1.2, -1), -1), 1);
  assert.equal(stepPdfScale(5, 1), 5); assert.equal(stepPdfScale(.25, -1), .25);
  for (const sampling of [1, 2, 3, 4, 5, 6]) assert.equal(pdfDetailCanvasPixels(sampling), sampling ** 2 * 1024 * 1024);
  for (const invalid of [undefined, 0, 8, NaN, '6']) assert.equal(pdfDetailCanvasPixels(invalid), 16 * 1024 * 1024);
  assert.equal(printRange(0, 5, 10), null); assert.equal(printRange(1, 51, 80), null);
  assert.equal(printRange(3, 2, 10), null); assert.equal(printRange(1, 11, 10), null);
  assert.deepEqual(printRange('2', '10', 20), {from:2,to:10});
  assert.throws(() => createPdfViewer({bytes: new ArrayBuffer(0)}));
  assert.throws(() => createPdfViewer({bytes: new ArrayBuffer(PDF_LIMITS.bytes + 1)}));
});
test('PDF rendering lives in a network-restricted opaque sandbox without editing/scripting', async () => {
  const manifest = JSON.parse(await readFile(new URL('manifest.json', root)));
  assert.deepEqual(manifest.sandbox.pages, ['workspaces/pdf-viewer/viewer.html', 'workspaces/document-preview/content.html']);
  const policy = manifest.content_security_policy.sandbox;
  assert.doesNotMatch(policy, /allow-same-origin|'unsafe-eval'|https?:|\*/);
  assert.match(policy, /connect-src 'self' blob:/); assert.match(policy, /frame-src 'none'/); assert.match(policy, /object-src 'none'/);
  const source = await readFile(new URL('workspaces/pdf-viewer/viewer.js', root), 'utf8');
  assert.match(source, /annotationEditorMode: pdfjs.AnnotationEditorType.DISABLE/);
  assert.match(source, /scriptingManager: null/); assert.match(source, /enableAutoLinking: false/);
  assert.doesNotMatch(source, /chrome\.|localStorage|sessionStorage|innerHTML|eval\(/);
  assert.match(source, /event.source !== parent/);
  assert.match(source, /drawingDelay: 180/); assert.match(source, /maxCanvasPixels: Math.min\(PDF_LIMITS.canvasPixels, pdfDetailCanvasPixels\(sampling\)\)/);
  assert.match(source, /thumbnailCache.size <= 24/); assert.match(source, /viewer.currentPageNumber = page/);
  const host = await readFile(new URL('workspaces/pdf-viewer/host.js', root), 'utf8');
  assert.match(host, /new MessageChannel/); assert.match(host, /iframe.remove\(\)/);
  const integration = await readFile(new URL('workspaces/document-preview/document-preview.js', root), 'utf8');
  assert.match(integration, /import\('\.\.\/pdf-viewer\/host.js'\)/); assert.doesNotMatch(integration, /pdfViewerEnabled|pdf-dark/);
  const css = await readFile(new URL('workspaces/pdf-viewer/viewer.css', root), 'utf8');
  assert.match(css, /data-dark=true\] \.pdfViewer \.page\{outline:1px solid/);
  assert.deepEqual(Object.keys(labels['en-US']).sort(), Object.keys(labels['zh-CN']).sort());
});
test('PDF dependency assets match pinned integrity and omit the script evaluator', async () => {
  const vendor = new URL('vendor/pdfjs/', root);
  const hashes = JSON.parse(await readFile(new URL('integrity.json', vendor)));
  for (const [name, hash] of Object.entries(hashes)) {
    assert.equal(createHash('sha256').update(await readFile(new URL(name, vendor))).digest('hex'), hash, name);
  }
  assert.ok(hashes['cmaps/UniGB-UCS2-H.bcmap']); assert.ok(hashes['standard_fonts/LiberationSans-Regular.ttf']);
  assert.ok(hashes['wasm/openjpeg.wasm']); assert.ok(hashes['wasm/jbig2.wasm']);
  assert.ok(!(await readdir(new URL('wasm/', vendor))).some(name => name.startsWith('quickjs')));
});

const { createPdfWorker } = await import('../extension/workspaces/pdf-viewer/worker.js');
test('sandbox PDF worker owns its native port across startup, failure and disposal', async t => {
  const bundle = 'globalThis.pdfjsWorker={};const source=import.meta.url;export{WorkerMessageHandler};';
  for (const mode of ['ready','abort','error','invalid','constructor']) await t.test(mode, async t => {
    const controller = new AbortController(); let native, revoked = 0, bytes, terminated = 0;
    t.mock.method(globalThis,'fetch',async()=>({ok:true,text:async()=>mode==='invalid'?'unexpected bundle':bundle}));
    t.mock.method(URL,'createObjectURL',blob=>{bytes=blob;return 'blob:fixed-local-code';});
    t.mock.method(URL,'revokeObjectURL',()=>revoked++);
    class Native extends EventTarget {
      constructor(url) {
        super(); assert.equal(url,'blob:fixed-local-code');
        if(mode==='constructor')throw Error('worker creation failed');
        native=this;
        queueMicrotask(()=>{
          if(mode==='abort')controller.abort();
          else if(mode==='error')this.dispatchEvent(new Event('error'));
          else this.dispatchEvent(new MessageEvent('message',{data:{action:'ready'}}));
        });
      }
      terminate(){terminated++;}
    }
    const descriptor=Object.getOwnPropertyDescriptor(globalThis,'Worker');globalThis.Worker=Native;t.after(()=>{if(descriptor)Object.defineProperty(globalThis,'Worker',descriptor);else delete globalThis.Worker;});
    class PDFWorker {
      constructor({port}){this.port=port;this.promise=Promise.resolve();}
      destroy(){this.destroyed=true;}
    }
    const pending=createPdfWorker({PDFWorker},controller.signal);
    if(mode==='ready') {
      const worker=await pending; assert.equal(worker.port,native);
      const source=await bytes.text(); assert.doesNotMatch(source,/import\.meta|export\{/);assert.match(source,/vendor\/pdfjs\/pdf\.worker\.min\.mjs/);
      controller.abort();assert.equal(worker.destroyed,true);worker.destroy();
    }else await assert.rejects(pending);
    assert.equal(terminated,mode==='invalid'||mode==='constructor'?0:1);
    assert.equal(revoked,mode==='invalid'?0:1);
  });
});

test('opaque PDF dialog markup has no blocked cross-origin autofocus attributes', async () => {
  const source = await readFile(new URL('../extension/workspaces/pdf-viewer/viewer.html', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /\bautofocus(?:\s|=|>)/i);
  assert.match(source, /id="properties-title" tabindex="-1"/);
});

const { showReaderDialog } = await import('../extension/workspaces/pdf-viewer/dialog.js');
test('reader dialogs choose explicit focus without implicit cross-origin autofocus', () => {
  const dialog={inert:false,showModal(){assert.equal(this.inert,true);this.open=true;}};
  let focused=false;
  showReaderDialog(dialog,{focus(options){assert.equal(dialog.inert,false);assert.equal(dialog.open,true);assert.deepEqual(options,{preventScroll:true});focused=true;}});
  assert.equal(focused,true);
  assert.throws(()=>showReaderDialog({inert:false,showModal(){throw Error('detached');}},null));
});

const { externalLinkTarget } = await import('../extension/shared/external-links-capture/target.js');
const { parseExternalLink: parseCapture, linkCopyText: copyCapture } = await import('../extension/shared/external-links-capture/model.js');
test('External Links Capture accepts bounded app targets but never executable or privileged URLs', () => {
  for (const value of ['https://example.com/a?q=a%2Bb','http://example.com/', 'ftp://example.com/a',
    'zoommtg://zoom.us/join?confno=123', 'msteams:/l/meetup-join/example',
    'ms-word:ofe|u|https://example.com/document.docx', 'custom-app:open?item=123']) {
    assert.equal(externalLinkTarget(value), new URL(value).href);
    const capture = parseCapture(value);
    assert.equal(capture.kind, /^https?:/.test(value) ? 'web' : 'app');
    assert.equal(copyCapture(capture, {}), new URL(value).href);
  }
  for (const value of [null, '/relative', '#page', 'C:/private', 'javascript:alert(1)',
    'JaVaScRiPt:alert(1)', 'java\nscript:alert(1)', 'vbscript:attack', 'data:text/html,attack',
    'blob:https://example.com/id', 'file:///private', 'filesystem:https://example.com/a',
    'chrome://settings', 'chrome-extension://id/private', 'about:blank', 'view-source:https://example.com',
    'ms-msdt:payload', 'shell:command', 'https://user:password@example.com/',
    'custom-app://u:p@example.com', 'custom-app:a%00b', 'https://example.com/'+ 'a'.repeat(8192)]) {
    assert.equal(externalLinkTarget(value), null, String(value));
    assert.equal(parseCapture(value), null, String(value));
  }
  for (const [url,kind,text] of [['mailto:a+tag@example.com','mailto','a+tag@example.com'],
    ['tel:+13125550123','tel','+13125550123'], ['sms:+13125550123','sms','+13125550123']]) {
    const capture = parseCapture(url); assert.equal(capture.kind,kind); assert.equal(copyCapture(capture,{}),text);
  }
});

function paperSample(size = 128, pixel = () => [0, 0, 0, 255]) {
  const data = new Uint8ClampedArray(size * size * 4);
  for (let y = 0, i = 0; y < size; y++) for (let x = 0; x < size; x++, i += 4) data.set(pixel(x, y), i);
  return { data, width: size, height: size };
}
const black = [4, 4, 4, 255], white = [255, 255, 255, 255];
const { isDarkPaper, createDarkPaperGuard } = await import('../extension/workspaces/pdf-viewer/dark-paper.js');
test('dark-paper exception requires a uniform neutral bed across the whole page and all edges', () => {
  for (const size of [128, 257]) {
    assert.equal(isDarkPaper(paperSample(size, () => black)), true);
    // Sparse strokes spread across the page, leaving uninterrupted black margins.
    assert.equal(isDarkPaper(paperSample(size, (x,y) => x > 16 && x < size - 16 && y > 16 && y < size - 16 && x % 12 < 2 && y % 24 < 2 ? white : black)), true);
    for (const pixel of [
      () => white, () => [160,160,160,255], () => [3,9,17,255],
      (x,y) => x < 2 || y < 2 || x >= size-2 || y >= size-2 ? white : black, // star field on white paper
      (x,y) => x === 0 ? white : black, // even one thin white edge
      (x,y) => x > size*.45 && x < size*.55 && y > size*.45 && y < size*.55 ? white : black, // small white inset
      (x,y) => x%2 === y%2 ? white : black,
      (x,y) => { const n=(x*31+y*17)%16; return [n,n,n,255]; }, // noisy night photograph
      x => { const n=Math.floor(x/size*16); return [n,n,n,255]; }, // dark gradient
      (x,y) => x > 16 && x < 32 && y > 16 && y < 32 ? [255,0,0,255] : black,
      () => [0,0,0,0]
    ]) assert.equal(isDarkPaper(paperSample(size, pixel)), false);
  }
  for (const shade of [0,4,32,64,96,120,127]) {
    const paper = [shade,shade,shade,255];
    for (const strength of [.85,.9,.96,1]) assert.equal(isDarkPaper(paperSample(128,()=>paper),strength),true);
    assert.equal(isDarkPaper(paperSample(128,(x,y)=>x>16&&x<112&&y>16&&y<112&&x%12<2&&y%24<2?[0,0,0,255]:paper)),true);
    assert.equal(isDarkPaper(paperSample(128,(x,y)=>x<2||y<2||x>=126||y>=126?white:paper)),false);
  }
  for (const shade of [128,160,200,240,255]) assert.equal(isDarkPaper(paperSample(128,()=>[shade,shade,shade,255])),false);
  assert.equal(isDarkPaper(paperSample(128,(x,y)=>{const n=80+(x*31+y*17)%16;return[n,n,n,255];})),false);
  for (const strength of [.5,NaN,2]) assert.equal(isDarkPaper(paperSample(), strength), false);
  for (const strength of [.85,.9,.96,1]) assert.equal(isDarkPaper(paperSample(), strength), true);
  assert.equal(isDarkPaper(), false);
  assert.equal(isDarkPaper({data:new Uint8ClampedArray(4),width:128,height:128}), false);
});
test('black-paper guard stages rare candidates, caches failures and decisions, and releases buffers', () => {
  const reads = [], source = {width:612,height:842}; let sample = size => paperSample(size, () => white), fail = false;
  const canvas = {width:0,height:0,getContext:()=>({drawImage(){},getImageData(x,y,size){reads.push(size);if(fail)throw Error('read failed');return sample(size);}})};
  const guard = createDarkPaperGuard(5,.96,()=>canvas);
  assert.equal(guard.get(1),0); assert.equal(guard.decide(1,source),1); assert.deepEqual(reads,[32]);
  sample = size => paperSample(size, () => black);
  assert.equal(guard.decide(1,source),1); assert.deepEqual(reads,[32]); // cached rejection
  assert.equal(guard.decide(2,source),2); assert.deepEqual(reads,[32,32,128,257]);
  assert.equal(canvas.width,0); assert.equal(canvas.height,0);
  assert.equal(guard.decide(2,{width:4000,height:5000}),2); assert.equal(reads.length,4); // zoom cache
  assert.equal(guard.reject(2),2); // a later interrupted/failed redraw cannot overturn the original verdict
  sample = size => paperSample(size, () => size === 257 ? white : black);
  assert.equal(guard.decide(3,source),1); assert.deepEqual(reads.slice(-3),[32,128,257]); // confirmation veto
  fail = true; assert.equal(guard.decide(4,source),1); const count=reads.length;
  assert.equal(guard.decide(4,source),1); assert.equal(reads.length,count); assert.equal(canvas.width,0);
  assert.equal(guard.decide(5,{width:100,height:100}),1); assert.equal(reads.length,count);
  guard.destroy(); assert.equal(guard.get(2),1); assert.equal(guard.decide(2,source),1);
  let allocations=0; const weak=createDarkPaperGuard(1,NaN,()=>{allocations++;return canvas;});
  assert.equal(weak.decide(1,source),1); assert.equal(allocations,0);
});


test('proven paper permits dense colored content without relaxing the pixel-only fallback', () => {
  const sample = paperSample(257, (x,y) => x>20&&x<230&&y>20&&y<230&&y%20<5 ? [0,140,120,255] : black);
  assert.equal(isDarkPaper(sample),false);
  assert.equal(isDarkPaper(sample,.96,4),true);
  assert.equal(isDarkPaper(sample,.96,80),false,'fill must match the observed paper edge');
  assert.equal(isDarkPaper(paperSample(257,(x,y)=>x<4||y<4?white:black),.96,4),false);
  assert.equal(isDarkPaper(paperSample(257,(x,y)=>x>100&&x<135&&y>100&&y<135?white:black),.96,4),false,'white-panel veto survives structural confirmation');
  for (const size of [128,257]) {
    assert.equal(isDarkPaper(paperSample(size,(x,y)=>x>size*.46&&x<size*.54&&y>size*.46&&y<size*.54?white:black),.96,4),false,'white block straddling four tiles');
    const footer=paperSample(size,(x,y)=>x>10&&x<size-10&&y>size-9&&y<size-1?[0,140,120,255]:black);
    assert.equal(isDarkPaper(footer),false,'pixels alone cannot prove a colorful footer');
    assert.equal(isDarkPaper(footer,.96,4),true,'confirmed dark paper allows content near the edge');
  }
  let reads=0;
  const canvas={width:0,height:0,getContext:()=>({drawImage(){},getImageData(x,y,size){return paperSample(size,(x,y)=>x>10&&x<size-10&&y>10&&y<size-10&&y%20<5?[0,140,120,255]:black);}})};
  const guard=createDarkPaperGuard(2,.96,()=>canvas),source={width:600,height:800};
  assert.equal(guard.decide(1,source,()=>{reads++;return 4;}),2);assert.equal(reads,1);
  assert.equal(guard.decide(1,source,()=>{throw Error('cached');}),2);
  assert.equal(guard.decide(2,source,()=>null),1);
});
const { renderedPaperShade } = await import('../extension/workspaces/pdf-viewer/paper-background.js');
test('paper fill evidence accepts harmless producer setup but rejects painting, transforms and incomplete coverage', () => {
  const ops = Object.fromEntries(['dependency','transform','beginText','endText','setFont','setLeading','setFillRGBColor','constructPath','endPath','fill','eoFill','showText','save','restore','clip','eoClip','setGState'].map((name,i)=>[name,i+1]));
  const rectangle={}, discarded={};
  const setup = [[ops.transform,[1,0,0,1,0,0]], [ops.beginText,null], [ops.dependency,['font']],
    [ops.setFont,['font',12]], [ops.setLeading,[14.4]], [ops.endText,null],
    [ops.constructPath,[ops.endPath,[discarded],null]], [ops.setFillRGBColor,['#15171a']]];
  const fill = [ops.constructPath,[ops.fill,[rectangle],new Float32Array([0,0,600,800])]];
  const context = {canvas:{width:0,height:0},setTransform(){},save(){},restore(){},clip(){},fill(){},
    getImageData(){return {data:new Uint8ClampedArray(32*32*4).fill(255)};}};
  const page = steps => ({view:[0,0,600,800],_intentStates:new Map([['display',{displayReadyCapability:{},operatorList:{lastChunk:true,fnArray:steps.map(s=>s[0]),argsArray:steps.map(s=>s[1])}}]])});
  const expected=.2126*21+.7152*23+.0722*26;
  assert.equal(renderedPaperShade(page([...setup,fill]),ops,context),expected);
  assert.equal(context.canvas.width,0);
  for(const step of [[ops.transform,[2,0,0,2,0,0]],[ops.showText,[]],[ops.setGState,[]],[-1,[]]]) {
    assert.equal(renderedPaperShade(page([step,...setup,fill]),ops,context),null);
  }
  assert.equal(renderedPaperShade(page([[ops.setFillRGBColor,['#ffffff']],fill,...setup,fill]),ops,context),null,'white paper painted before a dark rectangle');
  assert.equal(renderedPaperShade(page([...setup,[ops.constructPath,[ops.fill,[rectangle],[10,10,590,790]]]]),ops,context),null,'white margins');
  context.getImageData=()=>{const data=new Uint8ClampedArray(32*32*4).fill(255);data[3]=0;return {data};};
  assert.equal(renderedPaperShade(page([...setup,fill]),ops,context),null,'a triangle or clipped rectangle is not full paper');
  const incomplete=page([...setup,fill]);incomplete._intentStates.get('display').operatorList.lastChunk=false;
  assert.equal(renderedPaperShade(incomplete,ops,context),null);
});

import { pdfPageNumber } from '../extension/workspaces/pdf-viewer/model.js';
test('page edits reject fractional/invalid values and clamp whole page numbers', () => {
  for (const value of ['', ' ', 'abc', '2.5', 'Infinity', NaN, Infinity]) assert.equal(pdfPageNumber(value, 8, 3), 3);
  assert.equal(pdfPageNumber('999', 8, 3), 8);
  assert.equal(pdfPageNumber('-1', 8, 3), 1);
  assert.equal(pdfPageNumber('5', 8, 3), 5);
});
test('reopening a reader dialog clears previous confirmation while preserving focus safety', () => {
  const dialog = { open:false, inert:false, returnValue:'print', showModal() { assert.equal(this.inert, true); this.open=true; } };
  let focused=0;
  const target={focus(options) { assert.equal(dialog.inert,false); assert.equal(options.preventScroll,true); focused++; }};
  showReaderDialog(dialog,target);assert.equal(dialog.returnValue,'');assert.equal(focused,1);
  dialog.open=false;dialog.returnValue='open';showReaderDialog(dialog,target);assert.equal(dialog.returnValue,'');
});
