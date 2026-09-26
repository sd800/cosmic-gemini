import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { normalizeSettings, WHITE_TONES } from '../extension/core/config.js';
import { settingsViewCache } from '../extension/core/settings-view-cache.js';
import { isLeetCodeExplorePage, isLeetCodeExploreFrame } from '../extension/core/leetcode-dark-mode.js';
import { createLeetcodeDarkModeProduct } from '../extension/background/products/operations/leetcode-dark-mode.js';
const url='https://leetcode.com/explore/interview/card/course/704/4660/';
test('LeetCode Explore scope excludes the landing page, unrelated frames and lookalike hosts',()=>{
 for(const value of [url,'https://leetcode.com/explore/featured/card/course/']) assert.equal(isLeetCodeExplorePage(value),true);
 for(const value of ['https://leetcode.com/explore/','https://leetcode.com/explore/?theme=dark','https://leetcode.com/explore','https://leetcode.com/problems/a/','https://leetcode.com.evil.test/explore/a','https://example.com/explore/a','http://leetcode.com/explore/a','bad'])assert.equal(isLeetCodeExplorePage(value),false,value);
 assert.equal(isLeetCodeExploreFrame(url,url+'?iframe=0'),true);
 assert.equal(isLeetCodeExploreFrame(url,'https://leetcode.com/playground/abc/shared'),true);
 assert.equal(isLeetCodeExploreFrame('https://leetcode.com/explore/','https://leetcode.com/playground/abc/shared'),false);
 assert.equal(isLeetCodeExploreFrame(url,'https://player.vimeo.com/video/1'),false);
 assert.equal(isLeetCodeExploreFrame(url,'https://leetcode.com/problems/a/'),false);
});

function bridgeFixture() {
 const window=new EventTarget(),requests=[],configs=[];let listener;
 class CustomEvent extends Event { constructor(type,options={}) {super(type);this.detail=options.detail;} }
 const location={href:url};window.top=window;window.location=location;
 window.addEventListener('cosmic-gemini:leetcode-dark-mode:configure',event=>configs.push(JSON.parse(event.detail)));
 const context=vm.createContext({window,location,CustomEvent,Promise,setTimeout,clearTimeout,chrome:{runtime:{
  sendMessage:()=>new Promise(resolve=>requests.push(resolve)),onMessage:{addListener(fn){listener=fn;},removeListener(){}}
 }}});
 vm.runInContext(readFileSync(new URL('../extension/content/leetcode-dark-mode/leetcode-dark-mode-bridge.js',import.meta.url),'utf8'),context);
 return {requests,configs,location,announce:()=>window.dispatchEvent(new CustomEvent('cosmic-gemini:leetcode-dark-mode:main-ready',{detail:'test-token'})),
  refresh:()=>new Promise(resolve=>listener({type:'CG_REFRESH_FEATURE_CONFIG',featureId:'leetcodeDarkMode'},{},resolve)),
  stop:()=>listener({type:'CG_STOP_CENTRAL_FEATURE',featureId:'leetcodeDarkMode'},{},()=>{})};
}
const activeResponse={ok:true,result:{leetcodeDarkMode:{active:true}}};
test('overlapping ready and refresh requests acknowledge the same successful configuration',async()=>{
 const fixture=bridgeFixture();fixture.announce();const response=fixture.refresh();fixture.announce();
 for(const resolve of fixture.requests)resolve(activeResponse);
 assert.equal((await response).configured,true,'a newer ready event must not make the host remove valid styles');
 assert.equal(fixture.requests.length,1,'concurrent lookups are coalesced');
 assert.equal(fixture.configs.filter(message=>message.config.active).length,1);
 fixture.stop();
});
test('late configuration cannot revive a stopped LeetCode runtime',async()=>{
 const fixture=bridgeFixture();const response=fixture.refresh();fixture.stop();fixture.requests[0](activeResponse);
 assert.equal((await response).configured,false);
 assert.equal(fixture.configs.some(message=>message.config.active),false);
});
test('navigation during a lookup discards the stale inactive answer before acknowledging the host',async()=>{
 const fixture=bridgeFixture();fixture.announce();const response=fixture.refresh();
 fixture.location.href='https://leetcode.com/explore/featured/card/another/';
 fixture.requests[0]({ok:true,result:{leetcodeDarkMode:{active:false}}});
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(fixture.requests.length,2);
 fixture.requests[1](activeResponse);
 assert.equal((await response).configured,true);
 assert.equal(fixture.configs.some(message=>message.config.active===false),false);
 fixture.stop();
});
test('LeetCode color preference shares every White Softer tone but keeps its own off choice',async()=>{
 let settings=normalizeSettings({leetcodeDarkMode:{enabled:true}});
 assert.equal(settings.leetcodeDarkMode.tone,'warm');
 const product=createLeetcodeDarkModeProduct({}, {async mutateSettings(change){settings=normalizeSettings(change(settings));return settings;},async refreshOpenPages(){}});
 for(const tone of ['off',...WHITE_TONES.tones.map(tone=>tone.id)]) {
  await product.handleMessage({type:'UI_SET_LEETCODE_DARK_MODE_TONE',featureId:product.id,tone});
  assert.equal(product.state(settings,url).tone,tone);
  assert.equal(settingsViewCache(settings).leetcodeDarkMode.tone,tone);
  assert.deepEqual(settings.whiteSofter,{enabled:false,tone:'warm'});
 }
 await assert.rejects(product.handleMessage({type:'UI_SET_LEETCODE_DARK_MODE_TONE',featureId:product.id,tone:'invalid'}));
 await product.handleMessage({type:'UI_SET_ENABLED',featureId:product.id,enabled:false});
 assert.equal(settings.leetcodeDarkMode.tone,'cool');
});
test('default-off preference, scoped activation and SPA refresh belong to Operations product',async()=>{
 let settings=normalizeSettings(),refreshes=0;const decisions=[];
 const p=createLeetcodeDarkModeProduct({async sync(product,context,active,css){decisions.push({active,css});}},{async mutateSettings(update){settings=update(settings);return settings;},async refreshOpenPages(){refreshes++;},async readSettings(){return settings;},async refreshTabPage(){refreshes++;}});
 const context={topUrl:url,frameUrl:url,frameId:0};
 assert.equal(p.state(settings,url).active,false);assert.equal(await p.sync(context,settings),false);
 await p.handleTabUpdated(1,{url});assert.equal(refreshes,0);
 await p.handleMessage({type:'UI_SET_ENABLED',featureId:p.id,enabled:true});
 assert.equal(settingsViewCache(settings).leetcodeDarkMode.enabled,true);
 assert.equal(await p.sync(context,settings),true);
 assert.equal(await p.sync({...context,frameId:1,frameUrl:'https://leetcode.com/playground/abc/shared'},settings),true);
 assert.equal(await p.sync({...context,frameId:2,frameUrl:'https://outside.test/'},settings),false);
 await p.handleTabUpdated(1,{url:'https://leetcode.com/explore/'});assert.equal(refreshes,2);
 await p.handleTabUpdated(1,{url:'https://other.test/'});assert.equal(refreshes,2);
 assert.equal(decisions[1].css[0],'content/leetcode-dark-mode/leetcode-dark-mode.css');
 await p.handleMessage({type:'UI_SET_ENABLED',featureId:p.id,enabled:false});assert.equal(settings.leetcodeDarkMode.enabled,false);
});
