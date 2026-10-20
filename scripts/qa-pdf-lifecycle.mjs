import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile, copyFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';

export async function savePdfAudit(checks, screenshot, bytes, command) {
  const {version}=JSON.parse(await readFile('extension/manifest.json','utf8'));
  const folder=resolve('test-dist', 'pdf-audit-'+version);await mkdir(folder,{recursive:true});
  await writeFile(join(folder,'sample.pdf'),bytes);await copyFile(screenshot,join(folder,'reader.png'));
  await writeFile(join(folder,'report.json'),JSON.stringify({version,checks},null,2)+'\n');
  await writeFile(join(folder,'README.md'),'# PDF lifecycle audit\n\nSynthetic six-page PDF, pre-audit reader screenshot, and passing regression checks. Reproduce with `'+command+'` using the Playwright/Chrome paths from docs/QA.md. The disposable browser instruments only its temporary extension copy, delaying page retrieval and rejecting rasterization to verify selection shortcuts, thumbnail cancellation, print canvas release, teardown, and late-channel isolation. No personal documents, accounts, browser profiles, or AI services are used or saved here.\n');
  return folder;
}

// Called only by disposable browser QA copies with explicit private hooks.
export async function auditPdfLifecycle(frame) {
  const results = [];
  await frame.evaluate(() => { (window.qaViewer || window.qaPdfViewer).currentPageNumber = 3; });
  for (const key of ['ArrowLeft', 'ArrowRight', 'Home', 'End']) {
    for (const modifier of ['shiftKey', 'ctrlKey', 'metaKey']) {
      const state = await frame.evaluate(({key, modifier}) => {
        const viewer = window.qaViewer || window.qaPdfViewer;
        const before = viewer.currentPageNumber;
        const event = new KeyboardEvent('keydown', {key, [modifier]:true, bubbles:true, cancelable:true});
        document.querySelector('#viewport').dispatchEvent(event);
        return {before, after:viewer.currentPageNumber, cancelled:event.defaultPrevented};
      }, {key, modifier});
      assert.equal(state.after, state.before, `${modifier}+${key} must not navigate the PDF`);
      assert.equal(state.cancelled, false, `${modifier}+${key} stays available for native selection`);
    }
  }
  results.push('modified navigation keys preserve native text-selection shortcuts');
  assert.equal(await frame.evaluate(() => {
    const viewer=window.qaViewer||window.qaPdfViewer;
    const composing=new KeyboardEvent('keydown',{key:'ArrowRight',isComposing:true,bubbles:true,cancelable:true});
    document.querySelector('#viewport').dispatchEvent(composing);
    if(viewer.currentPageNumber!==3||composing.defaultPrevented)return false;
    document.querySelector('#viewport').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true,cancelable:true}));
    return viewer.currentPageNumber===4;
  }),true,'IME composition is untouched and ordinary navigation still works');
  await frame.evaluate(() => {
    const viewer = window.qaViewer || window.qaPdfViewer;
    viewer.currentPageNumber = 1;
    if (document.querySelector('#sidebar').hidden) document.querySelector('#sidebar-toggle').click();
  });
  await frame.waitForSelector('.thumbnail');
  await frame.waitForFunction(() => !qaLifecycle.state().thumbnailBusy);
  await frame.evaluate(async () => {
    const viewer = window.qaViewer || window.qaPdfViewer, pdf = viewer.pdfDocument;
    const target = await pdf.getPage(pdf.numPages), original = pdf.getPage.bind(pdf);
    qaLifecycle.clearThumbnails(); qaLifecycle.onlyThumbnail(pdf.numPages);
    window.qaThumbnailRenders = 0;
    const delayed = new Proxy(target, {get(object, key) {
      if (key === 'render') return (...args) => { qaThumbnailRenders++; return object.render(...args); };
      const value = Reflect.get(object, key, object); return typeof value === 'function' ? value.bind(object) : value;
    }});
    pdf.getPage = () => new Promise(resolve => { window.qaReleaseThumbnail = () => resolve(delayed); });
    window.qaRestorePage = () => { pdf.getPage = original; };
    window.qaThumbnailTask = qaLifecycle.drawThumbnails();
  });
  await frame.waitForFunction(() => typeof qaReleaseThumbnail === 'function');
  await frame.evaluate(() => document.querySelector('#sidebar-toggle').click());
  await frame.evaluate(async () => { qaReleaseThumbnail(); await qaThumbnailTask; qaRestorePage(); });
  assert.equal(await frame.evaluate(() => qaThumbnailRenders), 0, 'hidden sidebar must not start a delayed thumbnail render');
  results.push('closing the sidebar invalidates delayed thumbnail page retrieval');

  await frame.evaluate(() => document.querySelector('#sidebar-toggle').click());
  await frame.waitForFunction(() => !qaLifecycle.state().thumbnailBusy);
  const failedThumbnail=await frame.evaluate(async()=>{
    const viewer=window.qaViewer||window.qaPdfViewer,pdf=viewer.pdfDocument;
    const page=await pdf.getPage(pdf.numPages),original=pdf.getPage.bind(pdf);let canvas;
    qaLifecycle.clearThumbnails();qaLifecycle.onlyThumbnail(pdf.numPages);
    pdf.getPage=async()=>new Proxy(page,{get(object,key){
      if(key==='render')return({canvasContext})=>{canvas=canvasContext.canvas;return{promise:Promise.reject(Error('QA thumbnail failure')),cancel(){}};};
      const value=Reflect.get(object,key,object);return typeof value==='function'?value.bind(object):value;
    }});
    try{await qaLifecycle.drawThumbnails();return{width:canvas.width,height:canvas.height};}
    finally{pdf.getPage=original;document.querySelector('#sidebar-toggle').click();}
  });
  assert.deepEqual(failedThumbnail,{width:0,height:0},'failed thumbnail rendering releases its scratch canvas');
  results.push('failed optional thumbnail rasterization releases its canvas');

  const failedPrint = await frame.evaluate(async () => {
    const viewer = window.qaViewer || window.qaPdfViewer, pdf = viewer.pdfDocument;
    const page = await pdf.getPage(1), original = pdf.getPage.bind(pdf);
    let canvas;
    pdf.getPage = async () => new Proxy(page, {get(object, key) {
      if (key === 'render') return ({canvasContext}) => { canvas = canvasContext.canvas; return {promise:Promise.reject(Error('QA render failure')), cancel(){}}; };
      const value = Reflect.get(object, key, object); return typeof value === 'function' ? value.bind(object) : value;
    }});
    document.querySelector('#print-from').value = document.querySelector('#print-to').value = '1';
    try { await qaLifecycle.printDocument(); return {width:canvas.width, height:canvas.height, disabled:document.querySelector('#print').disabled}; }
    finally { pdf.getPage = original; }
  });
  assert.deepEqual(failedPrint, {width:0, height:0, disabled:false}, 'failed printing releases its scratch canvas and unlocks the control');
  results.push('failed print rasterization releases its canvas');

  await frame.evaluate(async () => {
    const viewer = window.qaViewer || window.qaPdfViewer, pdf = viewer.pdfDocument;
    const page = await pdf.getPage(1); window.qaLatePrintRenders = 0;
    pdf.getPage = () => new Promise(resolve => { window.qaReleasePrint = () => resolve(new Proxy(page, {get(object, key) {
      if (key === 'render') return () => { qaLatePrintRenders++; return {promise:Promise.resolve(), cancel(){}}; };
      const value = Reflect.get(object, key, object); return typeof value === 'function' ? value.bind(object) : value;
    }})); });
    window.qaLatePrint = qaLifecycle.printDocument();
  });
  await frame.waitForFunction(() => typeof qaReleasePrint === 'function');
  const retired = await frame.evaluate(async () => {
    const dark = document.documentElement.dataset.dark;
    qaLifecycle.password();
    const password=document.querySelector('#password-dialog'),closePassword=password.onclose;
    qaLifecycle.destroy();password.close('open');closePassword();qaLifecycle.password();
    qaReleasePrint(); await qaLatePrint;
    qaLifecycle.receive({type:'theme', dark:dark !== 'true'});
    return {renders:qaLatePrintRenders, dark:document.documentElement.dataset.dark, before:dark, images:document.querySelector('#print-pages').childElementCount,
      passwordOpen:password.open,accepted:window.qaAcceptedPasswords||0};
  });
  assert.equal(retired.renders, 0, 'a disposed reader cannot start printing after delayed page retrieval');
  assert.equal(retired.images, 0);
  assert.equal(retired.dark, retired.before, 'retired private-channel callbacks cannot repaint the reader');
  assert.equal(retired.passwordOpen,false,'late password requests cannot reopen a retired reader');
  assert.equal(retired.accepted,0,'late password confirmations cannot restart a retired parsing task');
  results.push('disposal rejects delayed printing and queued channel updates');
  return results;
}
