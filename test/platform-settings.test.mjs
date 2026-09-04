import assert from 'node:assert/strict';
import test from 'node:test';
import {
  INCOGNITO_LOCALE_KEY,
  INCOGNITO_SETTINGS_KEY,
  INCOGNITO_WINDOWS_KEY,
  SETTINGS_KEY
} from '../extension/core/config.js';
import { createPlatform } from '../extension/background/platform.js';

function chromeMock(incognito = false) {
  const local = {};
  const session = {};
  let failNextWrite = false;
  let failTabQuery = false;
  let scriptFailures = 0;
  let scriptCalls = 0;
  let tabs = [];
  let windows = incognito ? [{ id: 91, incognito: true }] : [{ id: 1, incognito: false }];
  const actionTitles = [];
  return {
    local,
    session,
    failWrite() { failNextWrite = true; },
    failQuery() { failTabQuery = true; },
    failScripts(count) { scriptFailures = count; },
    scriptCalls() { return scriptCalls; },
    setTabs(value) { tabs = value; },
    setWindows(value) { windows = value; },
    actionTitles,
    api: {
      extension: { inIncognitoContext: incognito },
      storage: {
        local: {
          async get(keys) {
            const names = Array.isArray(keys) ? keys : [keys];
            return Object.fromEntries(names.filter(name => name in local).map(name => [name, local[name]]));
          },
          async set(values) {
            if (failNextWrite) {
              failNextWrite = false;
              throw new Error('temporary storage failure');
            }
            Object.assign(local, values);
          },
          async remove(keys) {
            for (const key of Array.isArray(keys) ? keys : [keys]) delete local[key];
          }
        },
        session: {
          async get(keys) {
            await Promise.resolve();
            if (keys === null) return { ...session };
            const names = Array.isArray(keys) ? keys : [keys];
            return Object.fromEntries(names.filter(name => name in session).map(name => [name, structuredClone(session[name])]));
          },
          async set(values) {
            await Promise.resolve();
            for (const [key, value] of Object.entries(values)) session[key] = structuredClone(value);
          },
          async remove(keys) {
            for (const key of Array.isArray(keys) ? keys : [keys]) delete session[key];
          },
          async clear() {
            for (const key of Object.keys(session)) delete session[key];
          }
        }
      },
      tabs: {
        async query() {
          if (failTabQuery) {
            failTabQuery = false;
            throw new Error('temporary tab query failure');
          }
          return tabs;
        }
      },
      windows: {
        async getAll() { return windows; }
      },
      scripting: {
        async executeScript() {
          scriptCalls += 1;
          if (scriptFailures > 0) {
            scriptFailures -= 1;
            throw new Error('temporary script failure');
          }
          return [{ frameId: 0, result: true }];
        }
      },
      action: {
        setIcon(_details, callback) { callback(); },
        setBadgeText(_details, callback) { callback(); },
        setTitle(details, callback) { actionTitles.push(details); callback(); }
      },
      alarms: { getAll: async () => [], clear: async () => true },
      runtime: { lastError: null },
      i18n: { getUILanguage: () => 'en-US' }
    }
  };
}

test('a failed settings write does not poison later queued updates', async () => {
  const mock = chromeMock();
  globalThis.chrome = mock.api;
  const platform = createPlatform();
  mock.failWrite();
  await assert.rejects(platform.mutateSettings(current => ({ ...current, nativeScroll: { ...current.nativeScroll, enabled: false } }), false));
  const settings = await platform.mutateSettings(current => ({ ...current, nativeScroll: { ...current.nativeScroll, enabled: false } }), false);
  assert.equal(settings.nativeScroll.enabled, false);
  assert.equal(mock.local[SETTINGS_KEY].nativeScroll.enabled, false);
});

test('page-refresh failure does not turn a saved settings update into a failure', async () => {
  const mock = chromeMock();
  globalThis.chrome = mock.api;
  const platform = createPlatform();
  mock.failQuery();
  const settings = await platform.mutateSettings(current => ({
    ...current,
    nsna: { ...current.nsna, whitelistRules: [] }
  }));
  assert.deepEqual(settings.nsna.whitelistRules, []);
  assert.deepEqual(mock.local[SETTINGS_KEY].nsna.whitelistRules, []);
});

test('concurrent activity updates preserve every product state', async () => {
  const mock = chromeMock();
  globalThis.chrome = mock.api;
  const platform = createPlatform();
  await Promise.all([
    platform.setFeatureActivity(17, 'nativeScroll', true),
    platform.setFeatureActivity(17, 'noAutoplay', true),
    platform.setFeatureActivity(17, 'videoDownload', true)
  ]);
  assert.deepEqual(mock.session['tabActivity:17'], {
    nativeScroll: true,
    noAutoplay: true,
    anyCopy: false,
    anyCopyEnhanced: false,
    imageDownload: false,
    videoDownload: true,
    xhsImageDarkMode: false
  });
});

test('reset is serialized behind settings writes and leaves defaults in storage', async () => {
  const mock = chromeMock();
  globalThis.chrome = mock.api;
  const platform = createPlatform();
  const update = platform.mutateSettings(current => ({
    ...current,
    nativeScroll: { ...current.nativeScroll, enabled: false }
  }), false);
  const reset = platform.resetStorage();
  await Promise.all([update, reset]);
  assert.equal(mock.local[SETTINGS_KEY].nativeScroll.enabled, true);
});

test('reset preserves artifact records for downloads already accepted by Chrome', async () => {
  const mock = chromeMock();
  globalThis.chrome = mock.api;
  mock.session['videoDownloadArtifact:31'] = { artifactId: 'video-31' };
  mock.session['imageDownloadArtifact:32'] = { artifactId: 'image-32' };
  mock.session['imageCaptureArtifact:7:capture'] = { artifactId: 'capture' };
  mock.session['tabActivity:7'] = { videoDownload: true };
  const platform = createPlatform();
  await platform.resetStorage();
  assert.deepEqual(mock.session['videoDownloadArtifact:31'], { artifactId: 'video-31' });
  assert.deepEqual(mock.session['imageDownloadArtifact:32'], { artifactId: 'image-32' });
  assert.deepEqual(mock.session['imageCaptureArtifact:7:capture'], { artifactId: 'capture' });
  assert.equal(mock.session['tabActivity:7'], undefined);
});

test('toolbar recovery does not reject a saved activity update when locale storage is unavailable', async () => {
  const mock = chromeMock();
  globalThis.chrome = mock.api;
  mock.api.storage.local.get = async () => { throw new Error('temporary locale read failure'); };
  const platform = createPlatform();
  await platform.setFeatureActivity(17, 'nativeScroll', true);
  assert.equal(mock.session['tabActivity:17'].nativeScroll, true);
});

test('changing the interface language refreshes active toolbar titles', async () => {
  const mock = chromeMock();
  globalThis.chrome = mock.api;
  mock.setTabs([{ id: 17 }]);
  mock.session['tabActivity:17'] = { nativeScroll: true };
  const platform = createPlatform();
  assert.equal(await platform.setLocale('zh-CN'), 'zh-CN');
  await new Promise(resolve => setTimeout(resolve, 40));
  assert.equal(mock.actionTitles.at(-1).title, 'Native Scroll · 正在处理此页面');
});

test('shared page settings changes refresh this browser context without refreshing for download-only preferences', async () => {
  const mock = chromeMock();
  globalThis.chrome = mock.api;
  mock.setTabs([{ id: 17, url: 'https://example.com/' }]);
  const platform = createPlatform();
  platform.handleStorageChanged({
    [SETTINGS_KEY]: {
      oldValue: { nativeScroll: { enabled: true } },
      newValue: { nativeScroll: { enabled: false } }
    }
  }, 'local');
  await new Promise(resolve => setTimeout(resolve, 40));
  assert.equal(mock.scriptCalls(), 1);
  platform.handleStorageChanged({
    [SETTINGS_KEY]: {
      oldValue: { videoDownload: { preferredQuality: 'best' } },
      newValue: { videoDownload: { preferredQuality: '720' } }
    }
  }, 'local');
  await new Promise(resolve => setTimeout(resolve, 40));
  assert.equal(mock.scriptCalls(), 1);
});

test('page synchronization retries transient script injection failures', async () => {
  const mock = chromeMock();
  globalThis.chrome = mock.api;
  const platform = createPlatform();
  mock.failScripts(2);
  assert.equal(await platform.refreshTabPage(17), true);
  assert.equal(mock.scriptCalls(), 3);
});

test('incognito settings start disabled and never inherit regular saved settings', async () => {
  const mock = chromeMock(true);
  mock.local[SETTINGS_KEY] = {
    nativeScroll: { enabled: true },
    noAutoplay: { enabled: true },
    anyCopy: { siteRules: ['example.com'] }
  };
  globalThis.chrome = mock.api;
  const platform = createPlatform();
  const settings = await platform.ensureSettings();
  assert.equal(settings.nativeScroll.enabled, false);
  assert.equal(settings.noAutoplay.enabled, false);
  assert.equal(Object.values(settings.adMarshal.managedSites).some(Boolean), false);
  assert.deepEqual(settings.anyCopy.siteRules, []);
  assert.equal(mock.local[SETTINGS_KEY].nativeScroll.enabled, true);
  assert.equal(mock.session[INCOGNITO_SETTINGS_KEY].nativeScroll.enabled, false);
  assert.equal(Object.values(mock.session[INCOGNITO_SETTINGS_KEY].adMarshal.managedSites).some(Boolean), false);
});

test('explicit incognito changes remain in session storage and do not alter regular settings', async () => {
  const mock = chromeMock(true);
  mock.local[SETTINGS_KEY] = { nativeScroll: { enabled: true } };
  globalThis.chrome = mock.api;
  const platform = createPlatform();
  await platform.mutateSettings(current => ({
    ...current,
    nativeScroll: { ...current.nativeScroll, enabled: true, standardRules: ['example.com'] }
  }), false);
  await platform.setLocale('zh-CN');
  assert.deepEqual(mock.session[INCOGNITO_SETTINGS_KEY].nativeScroll.standardRules, ['example.com']);
  assert.equal(mock.session[INCOGNITO_LOCALE_KEY], 'zh-CN');
  assert.deepEqual(mock.local[SETTINGS_KEY], { nativeScroll: { enabled: true } });
});

test('resetting incognito settings leaves regular saved settings untouched', async () => {
  const mock = chromeMock(true);
  mock.local[SETTINGS_KEY] = { nativeScroll: { enabled: true, enhancedRules: ['example.com'] } };
  globalThis.chrome = mock.api;
  const platform = createPlatform();
  await platform.mutateSettings(current => ({
    ...current,
    nativeScroll: { ...current.nativeScroll, enabled: true }
  }), false);
  const reset = await platform.resetStorage();
  assert.equal(reset.nativeScroll.enabled, false);
  assert.deepEqual(mock.local[SETTINGS_KEY], { nativeScroll: { enabled: true, enhancedRules: ['example.com'] } });
  assert.equal(mock.session[INCOGNITO_SETTINGS_KEY].nativeScroll.enabled, false);
});

test('incognito context refreshes only for its session settings changes', async () => {
  const mock = chromeMock(true);
  mock.setTabs([{ id: 17, url: 'https://example.com/' }]);
  globalThis.chrome = mock.api;
  const platform = createPlatform();
  assert.equal(platform.handleStorageChanged({
    [SETTINGS_KEY]: { oldValue: { nativeScroll: { enabled: false } }, newValue: { nativeScroll: { enabled: true } } }
  }, 'local'), false);
  await new Promise(resolve => setTimeout(resolve, 40));
  assert.equal(mock.scriptCalls(), 0);
  assert.equal(platform.handleStorageChanged({
    [INCOGNITO_SETTINGS_KEY]: { oldValue: { nativeScroll: { enabled: false } }, newValue: { nativeScroll: { enabled: true } } }
  }, 'session'), true);
  await new Promise(resolve => setTimeout(resolve, 40));
  assert.equal(mock.scriptCalls(), 1);
});

test('a new incognito window set discards settings from the previous incognito session', async () => {
  const mock = chromeMock(true);
  mock.setWindows([{ id: 202, incognito: true }]);
  mock.session[INCOGNITO_WINDOWS_KEY] = [101];
  mock.session[INCOGNITO_SETTINGS_KEY] = {
    nativeScroll: { enabled: true, standardRules: ['example.com'] },
    noAutoplay: { enabled: true }
  };
  mock.session[INCOGNITO_LOCALE_KEY] = 'zh-CN';
  globalThis.chrome = mock.api;
  const platform = createPlatform();
  const settings = await platform.ensureSettings();
  assert.equal(settings.nativeScroll.enabled, false);
  assert.equal(settings.noAutoplay.enabled, false);
  assert.equal(mock.session[INCOGNITO_LOCALE_KEY], undefined);
  assert.deepEqual(mock.session[INCOGNITO_WINDOWS_KEY], [202]);
});

test('closing the last incognito window removes its temporary settings', async () => {
  const mock = chromeMock(true);
  globalThis.chrome = mock.api;
  const platform = createPlatform();
  await platform.ensureSettings();
  await platform.mutateSettings(current => ({
    ...current,
    nativeScroll: { ...current.nativeScroll, enabled: true }
  }), false);
  mock.setWindows([]);
  await platform.handleIncognitoWindowChange();
  assert.equal(mock.session[INCOGNITO_SETTINGS_KEY], undefined);
  assert.equal(mock.session[INCOGNITO_LOCALE_KEY], undefined);
  assert.equal(mock.session[INCOGNITO_WINDOWS_KEY], undefined);
});
