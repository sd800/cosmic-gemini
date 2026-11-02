import assert from 'node:assert/strict';import test from 'node:test';
import {createDocumentUrlPreview} from '../extension/background/features/document-url-preview.js';
import {validateMessageSource} from '../extension/background/message-source.js';
const id='11111111-1111-4111-8111-111111111111',nonce='22222222-2222-4222-8222-222222222222',url='https://example.edu/read.docx';
function fixture(t,incognito=false){
 const previous=globalThis.chrome,session={},rules=new Map(),tabs=new Map([[7,{id:7,url,incognito}]]),scopes=new Map([[7,{documentId:'root-7',result:{url,name:'cosmic-gemini-document:'+nonce}}]]);
 globalThis.chrome={runtime:{id:'test',getURL:path=>'chrome-extension://test/'+path},tabs:{query:async()=>[...tabs.values()],get:async tab=>{if(!tabs.has(tab))throw Error('closed');return tabs.get(tab);},remove:async tab=>tabs.delete(tab)},
  scripting:{executeScript:async({target})=>{const scope=scopes.get(target.tabId);if(!scope||target.documentIds&&!target.documentIds.includes(scope.documentId))throw Error('document changed');return [{...scope,frameId:0}];}},
  declarativeNetRequest:{getSessionRules:async()=>[...rules.values()],isRegexSupported:async()=>({isSupported:true}),updateSessionRules:async({removeRuleIds=[],addRules=[]})=>{removeRuleIds.forEach(id=>rules.delete(id));addRules.forEach(rule=>rules.set(rule.id,rule));}}
 };
 const platform={isIncognitoContext:()=>incognito,sessionStorage:{get:async key=>({[key]:session[key]}),set:async value=>Object.assign(session,structuredClone(value))}};
 const controller=createDocumentUrlPreview(platform),source={frameId:0,documentId:'source',url:'https://example.edu/article',tab:{id:9}},doc={id,url};
 const sender={id:'test',origin:'chrome-extension://test',frameId:4,documentId:'viewer',documentLifecycle:'active',tab:{id:7},url:'chrome-extension://test/workspaces/document-preview/document-preview.html#id='+id};
 t.after(()=>{globalThis.chrome=previous;});return{controller,source,doc,sender,session,rules,tabs,scopes};
}
test('framed readers receive only document and locale commands at ingress',()=>{
 const sender={id:'test',origin:'chrome-extension://test',frameId:4,tab:{id:7},url:'chrome-extension://test/workspaces/document-preview/document-preview.html'};
 for(const type of ['UI_DOCUMENT_GET','UI_DOCUMENT_PREPARE','UI_DOCUMENT_DOWNLOAD','UI_DOCUMENT_SET_THEME','UI_DOCUMENT_URL_READY','UI_GET_LOCALE'])assert.equal(validateMessageSource({type},sender,'chrome-extension://test/'),true);
 for(const type of ['UI_SET_ENABLED','UI_RESET_ALL_SETTINGS','UI_SET_LOCALE','UI_VIDEO_START'])assert.throws(()=>validateMessageSource({type},sender,'chrome-extension://test/'));
 assert.throws(()=>validateMessageSource({type:'UI_DOCUMENT_GET'},{...sender,origin:'https://example.edu'},'chrome-extension://test/'));
});
test('only the same-origin user-created root can authorize a document frame',async t=>{
 const f=fixture(t);const record=await f.controller.reserve(f.doc,f.source,nonce);assert.equal(record.tabId,7);
 assert.equal(await f.controller.authorize(f.sender,id),true);
 for(const patch of [{id:'foreign'},{origin:'null'},{frameId:0},{documentLifecycle:'cached'},{tab:{id:8}}])await assert.rejects(f.controller.authorize({...f.sender,...patch},id));
 await assert.rejects(f.controller.authorize(f.sender,nonce));
 f.scopes.get(7).documentId='replacement';await assert.rejects(f.controller.authorize(f.sender,id));
});
test('URL roots retain hash changes but not document or context changes',async t=>{
 const f=fixture(t);await f.controller.reserve(f.doc,f.source,nonce);
 f.tabs.get(7).url=url+'#page=2';f.scopes.get(7).result.url=url+'#page=2';await f.controller.reconcile([...f.tabs.values()]);assert.equal(await f.controller.authorize(f.sender,id),true);
 f.tabs.get(7).incognito=true;await assert.rejects(f.controller.authorize(f.sender,id));
 assert.equal(await f.controller.reserve({...f.doc,url:'https://other.edu/read.docx'},f.source,nonce),null);
 assert.equal(await f.controller.reserve({...f.doc,local:true},f.source,nonce),null);
});
test('simultaneous reservations have distinct rule IDs and cleanup cannot remove a new owner',async t=>{
 const f=fixture(t);const first=await f.controller.reserve(f.doc,f.source,nonce);
 f.tabs.set(8,{id:8,url,incognito:false});f.scopes.set(8,{documentId:'root-8',result:{url,name:'cosmic-gemini-document:'+id}});
 const second=await f.controller.reserve(f.doc,f.source,id);assert.notEqual(first.ruleId,second.ruleId);
 f.rules.set(first.ruleId,{id:first.ruleId,condition:{tabIds:[8]}});
 await f.controller.abandon(first);assert.equal(f.rules.has(first.ruleId),true,'a reused rule owned by another tab is untouched');assert.equal(f.tabs.has(7),false);
 assert.equal(f.controller.owns(8,f.doc.id),true);
});
test('render acknowledgement installs a low-priority tab-only fallback and closing reclaims it',async t=>{
 const f=fixture(t);const record=await f.controller.reserve(f.doc,f.source,nonce);
 const mounting=f.controller.mount(record,'chrome-extension://test/workspaces/document-preview/document-preview.html#id='+id);
 await new Promise(resolve=>setImmediate(resolve));await f.controller.authorize(f.sender,id);f.controller.report(7,true);assert.equal(await mounting,true);
 const rule=f.rules.get(record.ruleId);assert.equal(rule.priority,5);assert.deepEqual(rule.condition.tabIds,[7]);assert.deepEqual(rule.condition.requestMethods,['get']);assert.match(rule.action.redirect.url,/entry.html#id=/);
 f.tabs.delete(7);await f.controller.reconcile([]);assert.equal(f.rules.size,0);assert.equal(f.controller.owns(7,id),false);
});
test('refresh metadata survives the own fallback workspace but expires on unrelated navigation',async t=>{
 const f=fixture(t);await f.controller.reserve(f.doc,f.source,nonce);
 f.tabs.get(7).url='chrome-extension://test/workspaces/document-preview/entry.html#id='+id;
 await f.controller.reconcile([...f.tabs.values()]);assert.equal(f.controller.retainedIds([...f.tabs.values()]).has(id),true);
 await assert.rejects(f.controller.authorize(f.sender,id),'the retired original-address root cannot authorize a new frame');
 f.tabs.get(7).url='chrome-extension://test/workspaces/document-preview/document-preview.html#id='+id;
 await f.controller.reconcile([...f.tabs.values()]);assert.equal(f.controller.owns(7,id),true);
 f.tabs.get(7).url='https://example.edu/other';await f.controller.reconcile([...f.tabs.values()]);assert.equal(f.controller.retainedIds([...f.tabs.values()]).size,0);
});
test('closing a root cancels a pending render acknowledgement without waiting for its timeout',async t=>{
 const f=fixture(t),record=await f.controller.reserve(f.doc,f.source,nonce);
 const mounting=f.controller.mount(record,'chrome-extension://test/workspaces/document-preview/document-preview.html#id='+id);
 await new Promise(resolve=>setImmediate(resolve));f.tabs.delete(7);await f.controller.reconcile([]);assert.equal(await mounting,false);
});
