import assert from 'node:assert/strict';
import test from 'node:test';
import { SETTINGS_KEY } from '../extension/core/config.js';
import { createPlatform } from '../extension/background/platform.js';

function chromeMock() {
  const local = {};
  const session = {};
  let failNextWrite = false;
  let failTabQuery = false;
  let scriptFailures = 0;
  let scriptCalls = 0;
  let tabs = [];
  const actionTitles = [];
  return {
    local,
    session,
    failWrite() { failNextWrite = true; },
    failQuery() { failTabQuery = true; },
    failScripts(count) { scriptFailures = count; },
    scriptCalls() { return scriptCalls; },
    setTabs(value) { tabs = value; },
    actionTitles,
    api: {
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
    videoDownload: true
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
  assert.equal(mock.actionTitles.at(-1).title, 'Native Scroll · 正在处理此页面');
});

test('page synchronization retries transient script injection failures', async () => {
  const mock = chromeMock();
  globalThis.chrome = mock.api;
  const platform = createPlatform();
  mock.failScripts(2);
  assert.equal(await platform.refreshTabPage(17), true);
  assert.equal(mock.scriptCalls(), 3);
});
