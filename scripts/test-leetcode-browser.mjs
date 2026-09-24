// Real extension injection against representative DOM, in an isolated test profile.
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const { chromium }=await import(pathToFileURL(process.env.PDF_VIEWER_PLAYWRIGHT).href);
const folder=await mkdtemp(join(tmpdir(),'cg-leetcode-'));
const artifacts=resolve('test-dist/leetcode-dark-mode');await mkdir(artifacts,{recursive:true});
const context=await chromium.launchPersistentContext(join(folder,'profile'),{executablePath:process.env.PDF_VIEWER_CHROME,headless:true,args:[`--disable-extensions-except=${resolve('extension')}`,`--load-extension=${resolve('extension')}`]});
const errors=[];
try{
 context.on('page',p=>p.on('pageerror',e=>errors.push(String(e))));
 const child=`<!doctype html><meta charset="utf-8"><style>
 body,.article-inner,.block-markdown,.CodeMirror,pre{background:#fff;color:#111}iframe{height:220px;width:90%}
 .chapter-base,.chapter-list-item{padding:12px;background:white;width:320px}
 .description{position:relative;white-space:nowrap;overflow:hidden}
 .description::after{content:"";position:absolute;bottom:0;right:0;width:40%;height:1.3em;background:linear-gradient(to right,rgba(255,255,255,0),white 50%)}
 .chapter-list-item:hover{background:#ecf0f1}.chapter-list-item:hover .description::after{background:linear-gradient(to right,transparent,#ecf0f1 50%)}
 .chapter-base.active,.chapter-list-item.active{background:#222}.active .description::after{background:linear-gradient(to right,transparent,#222 50%)}
 .chapter-base.active:hover,.chapter-list-item.active:hover{background:black}.active:hover .description::after{background:linear-gradient(to right,transparent,black 50%)}
 .check-mark.completed i{color:#30b8ff;text-shadow:white 0 1px}.check-mark.completed i::before{content:"☑"}
 .playground-mini-base .lang-btn-set-base{display:inline-block;border:1px solid #ddd;border-bottom:none;border-radius:4px 4px 0 0}
 .lang-btn-set button{border:1px solid #ddd;background:#ecf0f1;padding:10px}.lang-btn-set .active{background:white}
 </style><body><div class="content-viewer-base">
 <div class="expandable-chapter-list-base"><div class="chapter-item"><div class="chapter-base"><div class="chapter"><b>Introduction</b><div class="description">A long chapter introduction with a fading end</div></div></div></div><div class="item-list-group"><div class="check-mark completed"><i></i> Completed lesson</div></div></div>
 <div class="chapter-list-base"><div class="chapter-list"><div class="chapter-list-item"><b>Course chapter</b><div class="description">Another long chapter introduction with a fading end</div></div></div></div>
 <div class="article-inner block-markdown"><h1>Explore lesson</h1><p>Readable content</p><pre>Sample code</pre></div>
 <div class="playground-mini-base"><div class="lang-btn-set-base"><div class="lang-btn-set"><button class="btn active">C++</button><button class="btn">Java</button></div></div><div class="CodeMirror"><pre><span class="cm-keyword">return</span> value;</pre></div></div></div>`;
 await context.route('https://leetcode.com/**',route=>{
  const u=new URL(route.request().url()),frame=u.searchParams.has('iframe')||u.pathname.startsWith('/playground/');
  route.fulfill({contentType:'text/html',headers:{'Content-Security-Policy':"script-src 'none'; style-src 'unsafe-inline'"},body:frame?child+(u.searchParams.has('iframe')?'<iframe src="/playground/sample/shared"></iframe>':''):`<!doctype html><html class="dark" style="color-scheme:dark"><head></head><body><h1>Native LeetCode shell</h1><iframe style="width:95%;height:650px" src="/explore/interview/card/fixture/?iframe=0"></iframe></body></html>`});
 });
 const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
 const base=`chrome-extension://${new URL(worker.url()).host}`;
 const settings=await context.newPage();await settings.goto(base+'/settings/satellites.html');
 const toggle=settings.locator('#leetcodeDarkModeEnabled');await toggle.waitFor({state:'attached'});assert.equal(await toggle.isChecked(),false);
 const page=await context.newPage();await page.goto('https://leetcode.com/explore/interview/card/fixture/');
 assert.equal(await page.locator('[data-cg-leetcode-dark]').count(),0);
 await settings.locator('.switch:has(#leetcodeDarkModeEnabled)').click();
 const marker='[data-cg-leetcode-dark]';await page.waitForSelector(marker);
 await page.frameLocator('iframe').locator(marker).waitFor();
 await page.frameLocator('iframe').frameLocator('iframe').locator(marker).waitFor();
 assert.equal(await page.frameLocator('iframe').locator('.article-inner').evaluate(n=>getComputedStyle(n).backgroundColor),'rgb(36, 36, 36)');
 assert.equal(await page.frameLocator('iframe').frameLocator('iframe').locator('.CodeMirror').evaluate(n=>getComputedStyle(n).backgroundColor),'rgb(32, 32, 32)');
 assert.equal(await page.locator('meta[name="darkreader-lock"]').count(),1);
 const lesson=page.frameLocator('iframe'),editor=lesson.frameLocator('iframe');
 for(const selector of ['.chapter-base','.chapter-list-item']){
  const row=lesson.locator(selector);
  const checkFade=async color=>{
   assert.equal(await row.evaluate(n=>getComputedStyle(n).backgroundColor),color);
   assert.equal(await row.locator('.description').evaluate(n=>getComputedStyle(n).backgroundColor),color);
   assert.equal(await row.locator('.description').evaluate(n=>getComputedStyle(n,'::after').backgroundImage),`linear-gradient(to right, rgba(0, 0, 0, 0), ${color} 50%)`);
  };
  await page.mouse.move(0,0);await checkFade('rgb(36, 36, 36)');
  await row.hover();await checkFade('rgb(44, 44, 44)');
  await row.evaluate(n=>n.classList.add('active'));await checkFade('rgb(58, 58, 58)');
  await page.mouse.move(0,0);await checkFade('rgb(58, 58, 58)');
  await row.evaluate(n=>{n.classList.remove('active');n.classList.add('opened');});await checkFade('rgb(58, 58, 58)');
  await row.evaluate(n=>n.classList.remove('opened'));
 }
 assert.equal(await editor.locator('.lang-btn-set-base').evaluate(n=>getComputedStyle(n).borderTopColor),'rgb(66, 66, 66)');
 assert.notEqual(await editor.locator('.btn.active').evaluate(n=>getComputedStyle(n).backgroundColor),await editor.locator('.btn:not(.active)').evaluate(n=>getComputedStyle(n).backgroundColor));
 assert.deepEqual(await lesson.locator('.check-mark i').evaluate(n=>[getComputedStyle(n).textShadow,getComputedStyle(n,'::before').textShadow,getComputedStyle(n).color]),['none','none','rgb(48, 184, 255)']);
 await page.screenshot({path:join(artifacts,'dark.png')});
 await page.evaluate(()=>{document.documentElement.className='light';document.documentElement.style.colorScheme='light';});
 await page.waitForFunction(()=>!document.documentElement.hasAttribute('data-cg-leetcode-dark'));
 await page.frameLocator('iframe').locator(marker).waitFor({state:'detached'});
 assert.equal(await page.locator('meta[name="darkreader-lock"]').count(),0);
 assert.equal(await page.frameLocator('iframe').locator('.article-inner').evaluate(n=>getComputedStyle(n).backgroundColor),'rgb(255, 255, 255)');
 await editor.locator(marker).waitFor({state:'detached'});
 assert.match(await lesson.locator('.chapter-base .description').evaluate(n=>getComputedStyle(n,'::after').backgroundImage),/rgb\(255, 255, 255\)/);
 assert.equal(await editor.locator('.lang-btn-set-base').evaluate(n=>getComputedStyle(n).borderTopColor),'rgb(221, 221, 221)');
 assert.notEqual(await lesson.locator('.check-mark i').evaluate(n=>getComputedStyle(n,'::before').textShadow),'none');
 await page.evaluate(()=>{document.documentElement.className='dark';document.documentElement.style.colorScheme='dark';});await page.waitForSelector(marker);
 // Same-document navigation must deactivate on landing and reactivate on entry.
 await page.evaluate(()=>history.pushState({},'','/explore/'));await page.waitForFunction(()=>!document.documentElement.hasAttribute('data-cg-leetcode-dark'));
 await page.evaluate(()=>history.pushState({},'','/explore/featured/card/fixture/'));await page.waitForSelector(marker);
 await settings.locator('.switch:has(#leetcodeDarkModeEnabled)').click();await page.waitForFunction(()=>!document.documentElement.hasAttribute('data-cg-leetcode-dark'));
 assert.equal(await page.locator('meta[name="darkreader-lock"]').count(),0);
 // Native light remains unchanged even when the preference is enabled.
 await page.evaluate(()=>{document.documentElement.className='light';document.documentElement.style.colorScheme='light';const m=document.createElement('meta');m.name='darkreader-lock';document.head.append(m);});
 await settings.locator('.switch:has(#leetcodeDarkModeEnabled)').click();
 await page.waitForFunction(()=>!!window[Symbol.for('cosmic-gemini.leetcode-dark-mode.runtime')]);
 assert.equal(await page.locator(marker).count(),0);
 await settings.locator('.switch:has(#leetcodeDarkModeEnabled)').click();
 await page.waitForFunction(()=>!window[Symbol.for('cosmic-gemini.leetcode-dark-mode.runtime')]);
 assert.equal(await page.locator('meta[name="darkreader-lock"]').count(),1,'pre-existing lock survives');
 assert.deepEqual(errors,[]);
 console.log('PASS: default off, nested frames, chapter fades/states, editor borders, checkmark shadows, live theme restoration, SPA scope, cleanup, no page errors');
}finally{await context.close();await rm(folder,{recursive:true,force:true});}
