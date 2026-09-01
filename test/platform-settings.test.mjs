import assert from 'node:assert/strict';
import test from 'node:test';
import { SETTINGS_KEY } from '../extension/core/config.js';
import { createPlatform } from '../extension/background/platform.js';

function chromeMock() {
  const local = {};
  let failNextWrite = false;
  let failTabQuery = false;
  return {
    local,
    failWrite() { failNextWrite = true; },
    failQuery() { failTabQuery = true; },
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
        }
      },
      tabs: {
        async query() {
          if (failTabQuery) {
            failTabQuery = false;
            throw new Error('temporary tab query failure');
          }
          return [];
        }
      },
      scripting: { executeScript: async () => [] },
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
