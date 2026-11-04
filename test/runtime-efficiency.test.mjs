import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {featureState,siteFeatureState,mailtoCaptureState,pageDisplayState,adMarshalState,websiteFixerState,xhsImageDarkModeState,xhsNavigationState,chineseResponseClaudeState} from '../extension/core/config.js';

test('product state checks avoid touching unrelated website-list groups',()=>{
 const cases=[['nativeScroll',settings=>featureState(settings,'nativeScroll','https://example.test')],['anyCopy',settings=>siteFeatureState(settings,'anyCopy','https://example.test')],['mailtoCapture',mailtoCaptureState],['pageDisplay',pageDisplayState],['adMarshal',adMarshalState],['websiteFixer',websiteFixerState],['xhsImageDarkMode',xhsImageDarkModeState],['xhsNavigation',xhsNavigationState],['chineseResponseClaude',chineseResponseClaudeState]];
 for(const [feature,check]of cases){const settings={[feature]:{enabled:true}};Object.defineProperty(settings,'documentPreview',{get(){throw Error('unrelated normalization');}});assert.doesNotThrow(()=>check(settings,'https://example.test'),feature);}
 assert.equal(xhsNavigationState({xhsImageDarkMode:{keyboardNavigationEnabled:true}},'https://www.xiaohongshu.com').active,true,'retain legacy navigation preference');
});

test('page nonce fallbacks use secure random bytes without randomUUID',async()=>{
 let reads=0;const crypto={getRandomValues:bytes=>{reads++;return globalThis.crypto.getRandomValues(bytes);}};
 for(const file of ['url-tracking-cleaner/url-tracking-cleaner-runtime.js','zhihu-image-adjustment/zhihu-image-adjustment-runtime.js']){
  const source=await readFile(new URL('../extension/content/'+file,import.meta.url),'utf8');const end=source.indexOf('\n  const ',source.indexOf('function randomToken'));
  const token=runInNewContext(source.slice(source.indexOf('  function randomToken'),end)+'\nrandomToken()',{crypto});assert.match(token,/^[a-f0-9]{36}$/);
 }
 const source=await readFile(new URL('../extension/content/document-preview/document-preview-dialog.js',import.meta.url),'utf8');const start=source.indexOf('  function randomNonce'),end=source.indexOf('\n  const key',start);
 const nonce=runInNewContext(source.slice(start,end)+'\nrandomNonce()',{crypto});assert.match(nonce,/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);assert.equal(reads,3);
});

test('unchanged image configuration preserves controls and avoids forced theme reprocessing',async()=>{
 const source=await readFile(new URL('../extension/content/xhs-image-dark-mode/xhs-image-dark-mode-runtime.js',import.meta.url),'utf8');const start=source.indexOf('    onConfigure(event)'),end=source.indexOf('\n    onDispose(event)',start);
 const object=runInNewContext('({'+source.slice(start,end)+'})',{location:{hostname:'www.xiaohongshu.com'},clamp:(n,a,b)=>Math.max(a,Math.min(b,n))});
 const calls=[];Object.assign(object,{token:'owned',active:true,locale:'en-US',overrideDarkMode:false,showImageControl:true,controlOpacity:.5,closeControlMenu:()=>calls.push('close'),updateControls:()=>calls.push('controls'),evaluateTheme:force=>calls.push(force)});
 object.onConfigure({detail:JSON.stringify({token:'owned',config:{active:true,locale:'en-US',controlOpacity:.5}})});assert.deepEqual(calls,[false]);
 object.onConfigure({detail:JSON.stringify({token:'owned',config:{active:true,locale:'en-US',controlOpacity:.6}})});assert.deepEqual(calls,[false,'close','controls',true]);
});
