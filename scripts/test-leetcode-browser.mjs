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
 const child=`<!doctype html><style>body,.article-inner,.block-markdown,.CodeMirror,pre{background:#fff;color:#111}iframe{height:220px;width:90%}</style><body><div class="content-viewer-base"><div class="article-inner block-markdown"><h1>Explore lesson</h1><p>Readable content</p><pre>Sample code</pre></div><div class="CodeMirror"><pre><span class="cm-keyword">return</span> value;</pre></div></div>`;
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
 await page.screenshot({path:join(artifacts,'dark.png')});
 await page.evaluate(()=>{document.documentElement.className='light';document.documentElement.style.colorScheme='light';});
 await page.waitForFunction(()=>!document.documentElement.hasAttribute('data-cg-leetcode-dark'));
 await page.frameLocator('iframe').locator(marker).waitFor({state:'detached'});
 assert.equal(await page.locator('meta[name="darkreader-lock"]').count(),0);
 assert.equal(await page.frameLocator('iframe').locator('.article-inner').evaluate(n=>getComputedStyle(n).backgroundColor),'rgb(255, 255, 255)');
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
 console.log('PASS: default off, nested frames, CSP-safe colors, live native theme, SPA scope, cleanup, no page errors');
}finally{await context.close();await rm(folder,{recursive:true,force:true});}
