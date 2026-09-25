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
