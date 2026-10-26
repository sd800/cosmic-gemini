import assert from 'node:assert/strict';
import test from 'node:test';
import { validateMessageSource, validatePortSource } from '../extension/background/message-source.js';

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
  const paths = ['popup/index.html', 'settings/all-settings.html?tab=satellites', 'settings/satellites-site-specific.html',
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
