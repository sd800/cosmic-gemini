import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_SETTINGS, DEFAULT_INCOGNITO_SETTINGS, normalizeSettings, SETTINGS_KEY, INCOGNITO_SETTINGS_KEY } from '../extension/core/config.js';
import { settingsViewCache } from '../extension/core/settings-view-cache.js';
import { UTM_PARAMETERS, URL_TRACKING_RULE_IDS, urlTrackingCleanerRule, urlTrackingCleanerState, urlTrackingCleanerRules, cleanTrackingUrl } from '../extension/core/url-tracking-cleaner.js';
import { createUrlTrackingCleanerProduct } from '../extension/background/products/standing/url-tracking-cleaner.js';
const copy=value=>structuredClone(value);

function fixture({incognito=false,enabled=true,utmParameters=true,bilibiliParameters=false}={}) {
  let settings=normalizeSettings({urlTrackingCleaner:{enabled,utmParameters,bilibiliParameters}});
  const rules=new Map([[77,{id:77,priority:1,action:{type:'block'},condition:{urlFilter:'unrelated'}}]]);
  const state={updates:0,writes:0,failRules:false,failWrite:false,omit:false,tabs:[{id:5,incognito:false},{id:3,incognito:false},{id:8,incognito:true}]};
  globalThis.chrome={tabs:{query:async()=>copy(state.tabs)},declarativeNetRequest:{
    getSessionRules:async()=>copy([...rules.values()]),
    updateSessionRules:async({removeRuleIds=[],addRules=[]})=>{state.updates++;if(state.failRules)throw Error('native failure');for(const id of removeRuleIds)rules.delete(id);if(!state.omit)for(const rule of addRules)rules.set(rule.id,copy(rule));}
  }};
  const platform={isIncognitoContext:()=>incognito,readSettings:async()=>copy(settings),
    mutateSettings:async update=>{const next=normalizeSettings(await update(copy(settings)));if(state.failWrite)throw Error('storage failure');if(state.beforeWrite)await state.beforeWrite();settings=next;state.writes++;return copy(settings);}};
  return{product:createUrlTrackingCleanerProduct(platform),state,rules,settings:()=>settings,setSettings:value=>{settings=normalizeSettings(value)}};
}

test('URL Tracking Cleaner defaults and cached preferences keep master/UTM choices separate',()=>{
  for(const defaults of [DEFAULT_SETTINGS,DEFAULT_INCOGNITO_SETTINGS,normalizeSettings()])assert.deepEqual(defaults.urlTrackingCleaner,{enabled:false,utmParameters:true,bilibiliParameters:false});
  const saved=normalizeSettings({urlTrackingCleaner:{enabled:true,utmParameters:false,bilibiliParameters:false}});
  assert.deepEqual(settingsViewCache(saved).urlTrackingCleaner,{enabled:true,utmParameters:false,bilibiliParameters:false});
  assert.equal(urlTrackingCleanerState(saved,'https://example.test/').active,false);
  assert.equal(urlTrackingCleanerState(normalizeSettings({urlTrackingCleaner:{enabled:true}}),'https://example.test/').active,true);
  assert.equal(urlTrackingCleanerState(normalizeSettings({urlTrackingCleaner:{enabled:true}}),'file:///tmp/test').active,false);
});

test('native query transforms are scoped to GET page navigation and exact context tabs',()=>{
  const rule=urlTrackingCleanerRule([5,3,3,-1,undefined],false),filter=new RegExp(rule.condition.regexFilter);
  assert.deepEqual(rule.condition.tabIds,[3,5]);assert.deepEqual(rule.condition.resourceTypes,['main_frame']);assert.deepEqual(rule.condition.requestMethods,['get']);
  assert.deepEqual(rule.action.redirect.transform,{queryTransform:{removeParams:[...UTM_PARAMETERS]}});
  for(const url of ['https://example.test/?utm_source=a&x=1','http://example.test/?x=a&utm_campaign=c','https://example.test/?UTM_SOURCE=a','https://example.test/?utm_source'])assert.equal(filter.test(url),true,url);
  for(const url of ['https://example.test/utm_source=a','https://example.test/?x=utm_source=a','https://example.test/#?utm_source=a','file:///tmp/test?utm_source=a'])assert.equal(filter.test(url),false,url);
  assert.equal(urlTrackingCleanerRule([]),null);assert.notEqual(rule.id,urlTrackingCleanerRule([8],true).id);
});

test('reconciliation restores enabled rules, avoids no-op writes, and keeps sibling rules',async()=>{
  const f=fixture();await f.product.initialize();
  assert.deepEqual(f.rules.get(URL_TRACKING_RULE_IDS.regular).condition.tabIds,[3,5]);assert.equal(f.rules.has(77),true);
  const writes=f.state.updates;await f.product.initialize();assert.equal(f.state.updates,writes);
  f.state.tabs.push({id:6,incognito:false});await f.product.handleTabCreated({id:6});assert.deepEqual(f.rules.get(URL_TRACKING_RULE_IDS.regular).condition.tabIds,[3,5,6]);
  f.state.tabs=[];await f.product.handleTabRemoved(6);assert.equal(f.rules.has(URL_TRACKING_RULE_IDS.regular),false);assert.equal(f.rules.has(77),true);
});

test('incognito owns a different rule and never includes ordinary tabs',async()=>{
  const f=fixture({incognito:true});f.rules.set(URL_TRACKING_RULE_IDS.regular,urlTrackingCleanerRule([3,5]));await f.product.initialize();
  assert.deepEqual(f.rules.get(URL_TRACKING_RULE_IDS.incognito).condition.tabIds,[8]);await f.product.reset();assert.equal(f.rules.has(URL_TRACKING_RULE_IDS.regular),true);assert.equal(f.rules.has(77),true);
});

test('master and UTM saves install before persistence and preserve child preference while disabled',async()=>{
  const f=fixture({enabled:false});await f.product.initialize();assert.equal(f.rules.has(URL_TRACKING_RULE_IDS.regular),false);
  await f.product.handleMessage({type:'UI_SET_ENABLED',enabled:true});assert.equal(f.rules.has(URL_TRACKING_RULE_IDS.regular),true);
  await f.product.handleMessage({type:'UI_SET_URL_TRACKING_SETTING',name:'utmParameters',value:false});assert.deepEqual(f.settings().urlTrackingCleaner,{enabled:true,utmParameters:false,bilibiliParameters:false});assert.equal(f.rules.has(URL_TRACKING_RULE_IDS.regular),false);
  await f.product.handleMessage({type:'UI_SET_ENABLED',enabled:false});assert.equal(f.settings().urlTrackingCleaner.utmParameters,false);
  await assert.rejects(f.product.handleMessage({type:'UI_SET_URL_TRACKING_SETTING',name:'other',value:true}));assert.equal(f.state.writes,3);
});

test('native failure and omitted rules cannot save an ineffective switch or poison later work',async()=>{
  const f=fixture({enabled:false});f.state.failRules=true;
  await assert.rejects(f.product.handleMessage({type:'UI_SET_ENABLED',enabled:true}),/native failure/);assert.equal(f.settings().urlTrackingCleaner.enabled,false);assert.equal(f.state.writes,0);
  f.state.failRules=false;f.state.omit=true;await assert.rejects(f.product.handleMessage({type:'UI_SET_ENABLED',enabled:true}),/could not be applied/);assert.equal(f.state.writes,0);
  f.state.omit=false;await f.product.handleMessage({type:'UI_SET_ENABLED',enabled:true});assert.equal(f.settings().urlTrackingCleaner.enabled,true);assert.equal(f.rules.has(77),true);
});

test('a storage failure restores rules to the confirmed saved state',async()=>{
  const f=fixture({enabled:false});f.state.failWrite=true;await assert.rejects(f.product.handleMessage({type:'UI_SET_ENABLED',enabled:true}),/storage failure/);
  assert.equal(f.rules.has(URL_TRACKING_RULE_IDS.regular),false);assert.equal(f.rules.has(77),true);assert.equal(f.settings().urlTrackingCleaner.enabled,false);
});

test('storage changes reconcile only the current context and reset removes only owned rules',async()=>{
  const f=fixture();await f.product.initialize();const count=f.state.updates;f.setSettings({urlTrackingCleaner:{enabled:false}});
  await f.product.handleStorageChanged({[INCOGNITO_SETTINGS_KEY]:{newValue:{}}},'session');assert.equal(f.state.updates,count);
  await f.product.handleStorageChanged({[SETTINGS_KEY]:{oldValue:{urlTrackingCleaner:{enabled:true}},newValue:{urlTrackingCleaner:{enabled:false}}}},'local');assert.equal(f.rules.has(URL_TRACKING_RULE_IDS.regular),false);
  f.rules.set(URL_TRACKING_RULE_IDS.incognito,urlTrackingCleanerRule([8],true));await f.product.reset();assert.equal(f.rules.has(URL_TRACKING_RULE_IDS.incognito),true);assert.equal(f.rules.has(77),true);
});


test('pre-navigation cleanup preserves unrelated query bytes and handles repeated/encoded UTM keys',()=>{
  assert.equal(cleanTrackingUrl('https://example.test/?utm_source=a&x=a%20b&x=c+q&utm_source=b#part'),'https://example.test/?x=a%20b&x=c+q#part');
  assert.equal(cleanTrackingUrl('https://example.test/?%75tm_source=a&uTm_Medium=b'),'https://example.test/');
  assert.equal(cleanTrackingUrl('https://example.test/?utm_source='+ 'x'.repeat(65536)), '');
  for(const url of ['https://example.test/?q=utm_source=a','https://example.test/#?utm_source=a','https://example.test/?utm_custom=keep','mailto:reader@example.test?utm_source=a'])assert.equal(cleanTrackingUrl(url),'');
});

test('lifecycle reconciliation cannot read stale preferences while a confirmed activation is being saved',async()=>{
  const f=fixture({enabled:false});let entered,release;const arrived=new Promise(resolve=>entered=resolve),gate=new Promise(resolve=>release=resolve);
  f.state.beforeWrite=async()=>{entered();await gate};
  const saving=f.product.handleMessage({type:'UI_SET_ENABLED',enabled:true});await arrived;
  const opened=f.product.handleTabCreated({id:6});release();await Promise.all([saving,opened]);
  assert.equal(f.settings().urlTrackingCleaner.enabled,true);assert.equal(f.rules.has(URL_TRACKING_RULE_IDS.regular),true);assert.equal(f.state.updates,1);
});


test('Bilibili query removal is opt-in, covers every subdomain, and leaves other domains intact',()=>{
  const options={utmParameters:false,bilibiliParameters:true};
  for(const url of ['https://www.bilibili.com/video/BV1test000001?trackid=test&spm_id_from=333','https://account.bilibili.com/account/home?spm_id_from=333#section','https://space.bilibili.com/12345678?spm_id_from=333','https://bilibili.com/?anything=yes'])assert.equal(cleanTrackingUrl(url,options),url.split('?')[0]);
  for(const url of ['https://space.bilibili.com/12345678#section','https://bilibili.com.evil.test/?spm_id_from=1','https://notbilibili.com/?a=1','https://bilibili.com@evil.test/?a=1'])assert.equal(cleanTrackingUrl(url,options),'');
  assert.equal(cleanTrackingUrl('https://space.bilibili.com/1?spm_id_from=1'),'', 'Bilibili is not enabled by the UTM-only helper default');
  const preference={enabled:true,utmParameters:false,bilibiliParameters:true},rules=urlTrackingCleanerRules([3],false,preference);
  assert.equal(rules.length,1);assert.equal(rules[0].id,URL_TRACKING_RULE_IDS.bilibiliRegular);assert.deepEqual(rules[0].condition.requestDomains,['bilibili.com']);assert.deepEqual(rules[0].action.redirect.transform,{query:'',fragment:''});
  assert.equal(urlTrackingCleanerState({urlTrackingCleaner:preference},'https://example.test/').active,true);
});

test('each context removes only its own selected-rule set when both options change',async()=>{
  const f=fixture({utmParameters:true,bilibiliParameters:true});await f.product.initialize();assert.equal(f.rules.has(URL_TRACKING_RULE_IDS.regular),true);assert.equal(f.rules.has(URL_TRACKING_RULE_IDS.bilibiliRegular),true);
  await f.product.handleMessage({type:'UI_SET_URL_TRACKING_SETTING',name:'utmParameters',value:false});assert.equal(f.rules.has(URL_TRACKING_RULE_IDS.regular),false);assert.equal(f.rules.has(URL_TRACKING_RULE_IDS.bilibiliRegular),true);
  await f.product.handleMessage({type:'UI_SET_URL_TRACKING_SETTING',name:'bilibiliParameters',value:false});assert.equal(f.rules.has(URL_TRACKING_RULE_IDS.bilibiliRegular),false);assert.equal(f.settings().urlTrackingCleaner.enabled,true);assert.equal(f.rules.has(77),true);
});
