import assert from 'node:assert/strict';
import test from 'node:test';
import {featureState,normalizeSettings,normalizeNsnaSite} from '../extension/core/config.js';
import {normalizeNsnaRuleInput} from '../extension/core/website-rule-input.js';
import {settingsViewCache} from '../extension/core/settings-view-cache.js';
import {createStandingProvince} from '../extension/background/provinces/standing.js';

const products=['nativeScroll','noAutoplay'];
test('NS/NA domain inputs reduce pasted URLs and legacy host/wildcard rules to the same site',()=>{
 for(const input of ['a.b.example.co.uk','*.a.example.co.uk','https://a.b.example.co.uk:8443/read?x=1#text','https//a.example.co.uk/read','https:a.example.co.uk/read','http/a.example.co.uk/read'])assert.equal(normalizeNsnaRuleInput(input),'example.co.uk');
 for(const [input,expected] of [['www.例子.公司.cn','xn--fsqu00a.xn--55qx5d.cn'],['a.city.kawasaki.jp','city.kawasaki.jp'],['a.corporate-server.corp','corporate-server.corp'],['a.alice.github.io','alice.github.io'],['127.0.0.1','127.0.0.1'],['[2001:0db8::1]','[2001:db8::1]'],['localhost','localhost']])assert.equal(normalizeNsnaSite(input),expected);
 for(const input of ['https://user:secret@example.com/','javascript:alert(1)','bad@@host','a.*.example.com'])assert.throws(()=>normalizeNsnaRuleInput(input));
});
test('legacy rules merge deterministically, retain first insertion order, and match all sibling subdomains',()=>{
 const old={nsna:{whitelistRules:['private.area.example.net','*.example.net']},anyCopy:{siteRules:['copy.a.example.net']}};
 for(const id of products)old[id]={enabled:false,inactiveRules:['docs.example.com'],standardRules:['shop.example.com','a.standard.example'],enhancedRules:['*.example.com','video.standard.example','enhanced.example'],permanentAudioAllowRules:['audio.a.example.edu','*.example.edu']};
 const settings=normalizeSettings(old);
 for(const id of products){
  assert.deepEqual(settings[id].inactiveRules,['example.com']);
  assert.deepEqual(settings[id].standardRules,['standard.example']);
  assert.deepEqual(settings[id].enhancedRules,['enhanced.example']);
  for(const host of ['example.com','www.example.com','deep.sibling.example.com'])assert.equal(featureState(settings,id,'https://'+host).behavior,'inactive');
  assert.equal(featureState(settings,id,'https://other.standard.example').mode,'standard');
  assert.equal(featureState(settings,id,'https://other.enhanced.example').mode,'enhanced');
  assert.equal(featureState(settings,id,'https://notexample.com').active,false);
  assert.equal(featureState(settings,id,'https://x.example.net').sharedWhitelisted,true);
 }
 assert.deepEqual(settings.noAutoplay.permanentAudioAllowRules,['example.edu']);
 assert.deepEqual(settings.anyCopy.siteRules,['copy.a.example.net'],'unrelated exact-host policies stay exact');
 assert.deepEqual(normalizeSettings(settings),settings,'repeated normalization does not alter the resulting policy');
 const cached=settingsViewCache(old);for(const id of ['nsna',...products])assert.deepEqual(cached[id],settings[id]);
});
test('NS/NA site matching honors private/public suffix boundaries, IPs, ports, and the top-level site',()=>{
 for(const id of products){
  const settings={nsna:{whitelistRules:['blocked.example.org']},[id]:{enabled:false,standardRules:['a.alice.github.io','www.example.co.uk','127.0.0.1','[2001:db8::1]','localhost','co.uk']}};
  for(const url of ['https://a.alice.github.io','https://alice.github.io','https://b.example.co.uk','http://127.0.0.1:8080','https://[2001:db8::1]:8443','http://localhost:8769'])assert.equal(featureState(settings,id,url).active,true,url);
  for(const url of ['https://bob.github.io','https://other.co.uk','https://notexample.co.uk','http://127.0.0.2','chrome://settings/'])assert.equal(featureState(settings,id,url).active,false,url);
 }
 const settings={noAutoplay:{enabled:true,permanentAudioAllowRules:['a.media.example.com'],inactiveRules:['blocked.example.org']}};
 assert.equal(featureState(settings,'noAutoplay','https://sibling.example.com').audioAllowed,true);
 assert.equal(featureState(settings,'noAutoplay','https://other.example.org').audioAllowed,false);
});
test('popup actions write the current registrable site and reject stale sibling-host actions',async t=>{
 const previous=globalThis.chrome;t.after(()=>{globalThis.chrome=previous;});
 let live='https://a.b.example.co.uk/read',settings=normalizeSettings();
 globalThis.chrome={runtime:{getURL:path=>'chrome-extension://test/'+path},tabs:{get:async()=>({url:live})}};
 const province=createStandingProvince({mutateSettings:async update=>settings=normalizeSettings(update(settings))});
 const context={sender:{url:'chrome-extension://test/popup/index.html'}};
 for(const id of products){
  const toggle=type=>province.handleMessage(id,{type,tabId:7,hostname:'a.b.example.co.uk'},context);
  await toggle('UI_TOGGLE_PAGE_FEATURE');assert.deepEqual(settings[id].standardRules,['example.co.uk']);
  const sibling=()=>featureState(settings,id,'https://sibling.example.co.uk/');assert.equal(sibling().active,true);assert.equal(sibling().exactBehaviorOverride,true);
  await toggle('UI_TOGGLE_PAGE_ENHANCED');assert.equal(sibling().mode,'enhanced');assert.deepEqual(settings[id].enhancedRules,['example.co.uk']);
  await toggle('UI_TOGGLE_PAGE_ENHANCED');assert.equal(sibling().mode,'standard');
  await toggle('UI_TOGGLE_PAGE_FEATURE');assert.equal(sibling().active,false);assert.deepEqual(settings[id].standardRules,[]);
  live='https://sibling.example.co.uk/';await assert.rejects(toggle('UI_TOGGLE_PAGE_FEATURE'),/page changed/);live='https://a.b.example.co.uk/read';
 }
 const admin={sender:{url:'chrome-extension://test/settings/native-scroll.html'}};
 await province.handleMessage('nativeScroll',{type:'UI_ADD_NSNA_WHITELIST_RULE',rule:'deep.a.example.co.uk'},admin);
 assert.deepEqual(settings.nsna.whitelistRules,['example.co.uk']);
 await province.handleMessage('nativeScroll',{type:'UI_DELETE_NSNA_WHITELIST_RULE',rule:'other.example.co.uk'},admin);assert.deepEqual(settings.nsna.whitelistRules,[]);
 await province.handleMessage('noAutoplay',{type:'UI_ADD_RULE',listName:'permanentAudioAllowRules',rule:'music.example.com'},admin);
 assert.deepEqual(settings.noAutoplay.permanentAudioAllowRules,['example.com']);
 await province.handleMessage('noAutoplay',{type:'UI_DELETE_RULE',listName:'permanentAudioAllowRules',rule:'www.example.com'},admin);assert.deepEqual(settings.noAutoplay.permanentAudioAllowRules,[]);
});
