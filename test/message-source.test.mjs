import assert from 'node:assert/strict';
import test from 'node:test';
import { resolvePageMessageSource, validateMessageSource, validatePortSource } from '../extension/background/message-source.js';

const extensionBase = 'chrome-extension://cosmic-gemini/';

test('central rejects malformed and unregistered messages before product dispatch', () => {
  const sender = { url: 'https://example.com/', tab: { id: 7 } };
  for (const message of [null, [], {}, { type: 5 }, { type: '' }, { type: 'CG_UNKNOWN' }]) {
    assert.throws(() => validateMessageSource(message, sender, extensionBase), /message/i);
  }
  assert.throws(() => validateMessageSource({ type: 'CG_SYNC_CENTRAL' },
    { ...sender, tab: { id: -1 } }, extensionBase), /webpage runtimes/i);
});

test('central accepts UI commands only from its own extension pages', () => {
  assert.equal(validateMessageSource({ type: 'UI_GET' }, { url: `${extensionBase}popup/index.html` }, extensionBase), true);
  assert.throws(() => validateMessageSource(
    { type: 'UI_RESET_ALL_SETTINGS' },
    { url: 'https://example.com/' },
    extensionBase
  ), /extension pages/i);
});

test('central accepts page events only from HTTP or HTTPS tab documents', () => {
  assert.equal(validateMessageSource(
    { type: 'CG_SYNC_CENTRAL' },
    { url: 'https://example.com/', tab: { id: 7 } },
    extensionBase
  ), true);
  assert.equal(validateMessageSource(
    { type: 'CG_FEATURE_ACTIVITY' },
    { url: 'https://claude.ai/', tab: { id: 8 } },
    extensionBase
  ), true);
  assert.throws(() => validateMessageSource(
    { type: 'CG_SYNC_CENTRAL' },
    { url: `${extensionBase}popup/index.html`, tab: { id: 7 } },
    extensionBase
  ), /webpage runtimes/i);
});

test('central accepts processing progress only from the video offscreen document', () => {
  assert.equal(validateMessageSource(
    { type: 'CG_VIDEO_DOWNLOAD_PROGRESS' },
    { url: `${extensionBase}offscreen/video-download.html` },
    extensionBase
  ), true);
  assert.throws(() => validateMessageSource(
    { type: 'CG_VIDEO_DOWNLOAD_PROGRESS' },
    { url: `${extensionBase}popup/index.html` },
    extensionBase
  ), /local processor/i);
});

test('central accepts long-lived UI ports only from extension pages', () => {
  assert.equal(validatePortSource({ sender: { url: `${extensionBase}popup/index.html` } }, extensionBase), true);
  assert.equal(validatePortSource({ sender: { url: 'https://example.com/' } }, extensionBase), false);
});

test('central excludes opaque sandboxes, public assets and unknown paths from UI authority', () => {
  const paths = ['popup/index.html', 'settings/all-settings.html?tab=satellites', 'settings/orbiters.html',
    'workspaces/document-preview/document-preview.html?id=local'];
  for (const path of paths) {
    const sender = {url:extensionBase + path,id:'cosmic-gemini',origin:'chrome-extension://cosmic-gemini'};
    assert.equal(validateMessageSource({type:'UI_GET'},sender,extensionBase),true);
    assert.equal(validatePortSource({sender},extensionBase),true);
  }
  for (const sender of [
    ...['workspaces/pdf-viewer/viewer.html','workspaces/document-preview/content.html',
      'assets/ad-marshal-empty.html','offscreen/video-download.html','unknown.html'].map(path => ({url:extensionBase+path})),
    {url:extensionBase+'popup/index.html',origin:'null'},
    {url:extensionBase+'popup/index.html',id:'other-extension'},
    {url:extensionBase+'popup/index.html',frameId:3},
    {url:extensionBase+'settings/all-settings.html',documentLifecycle:'pending_deletion'},
    {url:extensionBase+'workspaces/document-preview/document-preview.html',documentLifecycle:'cached'},
    {url:'chrome-extension://cosmic-gemini.evil.test/popup/index.html'},
    {url:'https://cosmic-gemini/popup/index.html'}
  ]) {
    assert.throws(()=>validateMessageSource({type:'UI_RESET_ALL_SETTINGS'},sender,extensionBase),/trusted extension pages/i);
    assert.equal(validatePortSource({sender},extensionBase),false);
  }
});

test('central rejects oversized command names and foreign or inactive page/processor senders', () => {
  assert.throws(()=>validateMessageSource({type:'UI_'+ 'A'.repeat(129)},
    {url:extensionBase+'popup/index.html'},extensionBase),/Invalid extension message/);
  for(const sender of [{url:'https://example.test',tab:{id:1},id:'foreign'},
    {url:'https://example.test',tab:{id:1},documentLifecycle:'cached'}]){
    assert.throws(()=>validateMessageSource({type:'CG_PAGE_STATE'},sender,extensionBase),/webpage runtimes/);
  }
  for(const sender of [{url:extensionBase+'offscreen/video-download.html',id:'foreign'},
    {url:extensionBase+'offscreen/video-download.html',origin:'null'}]){
    assert.throws(()=>validateMessageSource({type:'CG_VIDEO_DOWNLOAD_PROGRESS'},sender,extensionBase),/local processor/);
  }
});


const blankSender = { id: 'cosmic-gemini', url: 'about:blank', origin: 'https://example.test',
  tab: { id: 7 }, frameId: 4, documentId: 'child-document', documentLifecycle: 'active' };
const verifiedChild = result => [{ frameId: 4, documentId: 'child-document', result: { url: 'https://example.test/player', origin: 'https://example.test', ...result } }];

test('initial blank metadata resolves only through the exact active same-origin browser document', async () => {
  let target;
  const sender = await resolvePageMessageSource({ type: 'CG_SYNC_CENTRAL', url: 'https://untrusted.test/' }, blankSender, extensionBase,
    async value => { target = value; return verifiedChild(); });
  assert.deepEqual(target, { tabId: 7, frameId: 4, documentId: 'child-document' });
  assert.equal(sender.url, 'https://example.test/player');
  assert.equal(blankSender.url, 'about:blank', 'do not mutate the browser packet');
  assert.equal(validateMessageSource({ type: 'CG_SYNC_CENTRAL' }, sender, extensionBase), true);
});

test('ordinary sources and ineligible blank packets perform no verification injection', async () => {
  let reads = 0; const read = async () => { reads++; return verifiedChild(); };
  for (const [type, override] of [['UI_GET', {}], ['CG_UNKNOWN', {}], ['CG_SYNC_CENTRAL', { url: 'https://example.test/' }],
    ['CG_SYNC_CENTRAL', { id: 'foreign' }], ['CG_SYNC_CENTRAL', { origin: 'null' }], ['CG_SYNC_CENTRAL', { origin: 'chrome-extension://cosmic-gemini' }],
    ['CG_SYNC_CENTRAL', { documentId: '' }], ['CG_SYNC_CENTRAL', { documentLifecycle: 'cached' }], ['CG_SYNC_CENTRAL', { tab: { id: -1 } }]]) {
    const source = { ...blankSender, ...override };
    assert.equal(await resolvePageMessageSource({ type }, source, extensionBase, read), source);
  }
  assert.equal(reads, 0);
});

test('blank source verification rejects navigation, origin/document mismatches, opaque documents, and failures', async () => {
  const readers = [async () => verifiedChild({ url: 'about:blank' }), async () => verifiedChild({ url: 'https://other.test/player' }),
    async () => verifiedChild({ origin: 'null' }), async () => [{ ...verifiedChild()[0], documentId: 'replacement' }],
    async () => [{ ...verifiedChild()[0], frameId: 8 }], async () => { throw Error('Document no longer exists'); }];
  for (const read of readers) {
    const sender = await resolvePageMessageSource({ type: 'CG_PAGE_STATE' }, blankSender, extensionBase, read);
    assert.equal(sender, blankSender);
    assert.throws(() => validateMessageSource({ type: 'CG_PAGE_STATE' }, sender, extensionBase), /webpage runtimes/);
  }
});

test('overlapping blank-source reads share work without caching completed document locations', async () => {
  let reads = 0, finish;
  const read = () => { reads++; return new Promise(resolve => { finish = resolve; }); };
  const first = resolvePageMessageSource({ type: 'CG_SYNC_CENTRAL' }, blankSender, extensionBase, read);
  const second = resolvePageMessageSource({ type: 'CG_PAGE_STATE' }, { ...blankSender }, extensionBase, read);
  await Promise.resolve(); finish(verifiedChild());
  const values = await Promise.all([first, second]); assert.equal(reads, 1); assert.notEqual(values[0], values[1]);
  const next = await resolvePageMessageSource({ type: 'CG_PAGE_STATE' }, blankSender, extensionBase, async () => { reads++; return verifiedChild({ url: 'https://example.test/new-route' }); });
  assert.equal(reads, 2); assert.equal(next.url, 'https://example.test/new-route');
});
