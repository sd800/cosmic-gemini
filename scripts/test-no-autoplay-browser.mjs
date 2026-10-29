// Native media controls and NS/NA combinations in a disposable Chrome profile.
import assert from 'node:assert/strict';
import {access,mkdir,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const {chromium}=await import(pathToFileURL(process.env.PDF_VIEWER_PLAYWRIGHT).href);
const folder=await mkdtemp(join(tmpdir(),'cg-no-autoplay-'));
const artifacts=resolve('test-dist/no-autoplay');
await mkdir(artifacts,{recursive:true});
const context=await chromium.launchPersistentContext(join(folder,'profile'),{
  executablePath:process.env.PDF_VIEWER_CHROME,headless:true,viewport:{width:1100,height:850},
  ignoreDefaultArgs:['--disable-extensions'],args:['--enable-unsafe-extension-debugging']
});
context.setDefaultTimeout(10000);
const errors=[];
context.on('page',page=>page.on('pageerror',error=>errors.push(error.message)));
const naKey='cosmic-gemini.no-autoplay.runtime',nsKey='cosmic-gemini.native-scroll.runtime';
try {
  const sample=join(artifacts,'native.webm');
  try {await access(sample);} catch {
    const generator=await context.newPage();
    const bytes=await generator.evaluate(async()=>{
      const canvas=document.createElement('canvas');canvas.width=320;canvas.height=180;
      const ctx=canvas.getContext('2d'),stream=canvas.captureStream(10);
      const recorder=new MediaRecorder(stream,{mimeType:'video/webm;codecs=vp8'}),chunks=[];
      recorder.ondataavailable=event=>chunks.push(event.data);
      const stopped=new Promise(resolve=>recorder.onstop=resolve);
      recorder.start();
      for(let i=0;i<12;i++){
        ctx.fillStyle=i%2?'#336699':'#6699cc';ctx.fillRect(0,0,320,180);
        await new Promise(resolve=>setTimeout(resolve,100));
      }
      recorder.stop();await stopped;stream.getTracks().forEach(track=>track.stop());
      return Array.from(new Uint8Array(await new Blob(chunks).arrayBuffer()));
    });
    await writeFile(sample,Buffer.from(bytes));await generator.close();
  }
  const videoBytes=await readFile(sample);
  // A one-second silent PCM fixture, constructed in RAM.
  const audioBytes=Buffer.alloc(44+16000);
  audioBytes.write('RIFF');audioBytes.writeUInt32LE(audioBytes.length-8,4);audioBytes.write('WAVEfmt ',8);
  audioBytes.writeUInt32LE(16,16);audioBytes.writeUInt16LE(1,20);audioBytes.writeUInt16LE(1,22);
  audioBytes.writeUInt32LE(8000,24);audioBytes.writeUInt32LE(16000,28);
  audioBytes.writeUInt16LE(2,32);audioBytes.writeUInt16LE(16,34);audioBytes.write('data',36);audioBytes.writeUInt32LE(16000,40);
  await context.route('https://media-controls.test/**',route=>{
    const path=new URL(route.request().url()).pathname;
    if(path==='/clip.webm')return route.fulfill({contentType:'video/webm',body:videoBytes});
    if(path==='/sound.wav')return route.fulfill({contentType:'audio/wav',body:audioBytes});
    return route.fulfill({contentType:'text/html',body:`<!doctype html><title>Native media controls fixture</title>
      <style>body{font:16px system-ui;margin:20px}video{display:block;width:640px;height:360px}button{font:inherit;margin:8px}#other{display:none}</style>
      <button id="unrelated">Ordinary action</button><button id="fullscreen">Full screen</button>
      <div id="player"><video id="video" src="/clip.webm" controls muted loop></video>
      <button id="custom" class="videoPlayButton">Play video</button><button id="delayed" class="videoResumeButton">Resume video</button></div>
      <video id="other" src="/clip.webm" muted loop></video><audio id="audio" src="/sound.wav" controls loop></audio>
      <script>
      const video=document.querySelector('#video');
      custom.onclick=()=>video.play().catch(e=>{window.customError=e.name});
      delayed.onclick=()=>setTimeout(()=>video.play().catch(e=>{window.customError=e.name}),2100);
      fullscreen.onclick=()=>video.requestFullscreen();
      </script>`});
  });
  const loader=await context.browser().newBrowserCDPSession();
  const {id}=await loader.send('Extensions.loadUnpacked',{path:resolve('extension')});
  const settings=await context.newPage();await settings.goto(`chrome-extension://${id}/settings/no-autoplay.html`);
  const command=async message=>{
    const reply=await settings.evaluate(message=>chrome.runtime.sendMessage(message),message);
    assert.equal(reply.ok,true,reply.error);
  };
  const setMode=(featureId,behavior)=>command({type:'UI_SET_BEHAVIOR_RULE',featureId,rule:'media-controls.test',behavior});
  const page=await context.newPage(),cdp=await context.newCDPSession(page);
  const nativeButton=async(mediaId,pseudo='-webkit-media-controls-play-button')=>{
    // QA-only UA-tree inspection: production code uses public media/focus APIs.
    const tree=await cdp.send('DOM.getDocument',{depth:-1,pierce:true});
    const children=n=>[...(n.children||[]),...(n.shadowRoots||[])];
    const attrs=n=>Object.fromEntries(Array.from({length:(n.attributes?.length||0)/2},(_,i)=>n.attributes.slice(i*2,i*2+2)));
    const find=(node,predicate)=>predicate(node)?node:children(node).map(n=>find(n,predicate)).find(Boolean);
    const media=find(tree.root,n=>attrs(n).id===mediaId);
    assert.ok(media,'media node exists');
    const button=find(media,n=>attrs(n).pseudo===pseudo&&!String(attrs(n).style).includes('display: none'));
    assert.ok(button,'native control exists');
    const {model}=await cdp.send('DOM.getBoxModel',{nodeId:button.nodeId});
    const box=model.border;
    await page.mouse.click((box[0]+box[4])/2,(box[1]+box[5])/2);
  };
  const isPlaying=mediaId=>page.waitForFunction(id=>!document.getElementById(id).paused,mediaId);
  const isPaused=mediaId=>page.waitForFunction(id=>document.getElementById(id).paused,mediaId);
  const expireIntent=()=>page.evaluate(key=>{
    const runtime=window[Symbol.for(key)];if(!runtime)return;
    runtime.userIntentUntil=-1;runtime.mediaIntent=new WeakMap();runtime.playerIntent=new WeakMap();
  },naKey);
  const combinations=[['inactive','inactive'],['standard','inactive'],['enhanced','inactive'],['inactive','standard'],['standard','standard'],['enhanced','standard']];
  for(const [ns,na]of combinations){
    await setMode('nativeScroll',ns);await setMode('noAutoplay',na);
    await page.goto('https://media-controls.test/');
    for(const [key,mode]of [[nsKey,ns],[naKey,na]]){
      if(mode!=='inactive')await page.waitForFunction(({key,mode})=>window[Symbol.for(key)]?.active&&window[Symbol.for(key)].mode===mode,{key,mode});
    }
    await page.waitForFunction(()=>video.readyState>=2&&document.querySelector('#audio').readyState>=2);
    assert.equal(await page.evaluate(()=>window[Symbol.for('cosmic-gemini.no-autoplay.runtime')]?.active===true),na!=='inactive');
    await page.locator('#unrelated').click();
    const scriptPlay=await page.evaluate(async()=>{try{await video.play();return 'played';}catch(error){return error.name;}});
    assert.equal(scriptPlay,na==='inactive'?'played':'NotAllowedError');
    await page.locator('#video').evaluate(v=>v.pause());await isPaused('video');await expireIntent();
    await nativeButton('video');await isPlaying('video');
    await page.waitForFunction(()=>video.currentTime>0);
    if(na!=='inactive'){
      assert.equal(await page.evaluate(async()=>{try{await document.querySelector('#other').play();return 'played';}catch(error){return error.name;}}),'NotAllowedError','native control must not authorize another player');
      assert.equal(await page.evaluate(key=>window[Symbol.for(key)].hasRecentPlaybackIntent(),naKey),false);
    }
    await nativeButton('video');await isPaused('video');await expireIntent();
    await nativeButton('video');await isPlaying('video');
    await nativeButton('video');await isPaused('video');await expireIntent();
    await nativeButton('audio');await isPlaying('audio');
    await nativeButton('audio');await isPaused('audio');await expireIntent();
    await page.locator('#custom').click();await isPlaying('video');
    await page.locator('#video').evaluate(v=>v.pause());await isPaused('video');await expireIntent();
    await page.locator('#delayed').click();await isPlaying('video');
    assert.equal(await page.evaluate(()=>window.customError||null),null);
    console.log(`PASS: Native Scroll ${ns}; No Autoplay ${na}; native video/audio, replay, custom controls, and delayed start.`);
  }
  // Both products active: keyboard and full-screen controls use the same media.
  await page.locator('#video').evaluate(v=>v.pause());await isPaused('video');await expireIntent();
  await page.locator('#video').focus();await page.keyboard.press('Space');await isPlaying('video');
  await page.locator('#video').evaluate(v=>v.pause());await isPaused('video');await expireIntent();
  await page.locator('#fullscreen').click();await page.waitForFunction(()=>document.fullscreenElement===video);
  await nativeButton('video');await isPlaying('video');
  await page.evaluate(()=>document.exitFullscreen());
  await page.waitForFunction(()=>!document.fullscreenElement);
  // Attribute-driven playback remains blocked, even after a different native player was used.
  await page.evaluate(()=>{
    const auto=document.createElement('video');auto.id='automatic';auto.src='/clip.webm';auto.muted=true;auto.controls=true;auto.autoplay=true;
    auto.addEventListener('play',()=>{window.automaticPlayObserved=true;});document.body.append(auto);
  });
  await page.waitForFunction(()=>window.automaticPlayObserved===true&&document.querySelector('#automatic').paused);
  // Revoke automatic audio permission without interrupting deliberate audio/video.
  await command({type:'UI_SET_AUDIO_AUTOPLAY_ALL_SITES',enabled:true});
  await page.waitForFunction(key=>window[Symbol.for(key)]?.audioAllowed===true,naKey);
  await expireIntent();
  await page.evaluate(async()=>{
    window.automaticContext=new AudioContext();window.manualContext=new AudioContext();
    await Promise.all([automaticContext.resume(),manualContext.resume()]);
  });
  await page.locator('#custom').click();
  await page.evaluate(()=>manualContext.resume());
  await expireIntent();
  await command({type:'UI_SET_AUDIO_AUTOPLAY_ALL_SITES',enabled:false});
  await page.waitForFunction(()=>automaticContext.state==='suspended'&&manualContext.state==='running'&&!video.paused);
  await page.evaluate(()=>Promise.all([automaticContext.close(),manualContext.close()]));
  await setMode('noAutoplay','enhanced');
  await page.waitForFunction(()=>!document.querySelector('video,audio'));
  await page.evaluate(()=>{const v=document.createElement('video');v.src='/clip.webm';document.body.append(v);});
  await page.waitForFunction(()=>!document.querySelector('video,audio'));
  await setMode('noAutoplay','inactive');await setMode('nativeScroll','inactive');
  await page.waitForFunction(({naKey,nsKey})=>!window[Symbol.for(naKey)]&&!window[Symbol.for(nsKey)],{naKey,nsKey});
  assert.deepEqual(errors,[]);
  await writeFile(join(artifacts,'README.md'),`# No Autoplay fixtures\n\nRun scripts/test-no-autoplay-browser.mjs with PDF_VIEWER_PLAYWRIGHT and PDF_VIEWER_CHROME pointing to the local test runtime. It uses a disposable profile and serves all media in memory. native.webm is a reusable tiny synthetic VP8 clip, generated only if missing; the silent WAV is generated in RAM. No browsing/account content or logs are saved.\n\nCoverage: Native Scroll off/Standard/Enhanced with No Autoplay off/Standard, native video/audio controls, pause/replay, explicit and delayed custom controls, unrelated click rejection, per-player permissions, keyboard, full screen, native attribute autoplay, Enhanced removal, and lifecycle cleanup. Unit tests cover gesture expiry, source resets, audio permission changes, Web Audio rejections/deduplication/aliases, and wrapper ownership.\n`);
  console.log('PASS: Keyboard, full screen, attribute autoplay, Web Audio permission revocation, Enhanced removal, clean disposal, and no page errors.');
} finally {await context.close();await rm(folder,{recursive:true,force:true});}
