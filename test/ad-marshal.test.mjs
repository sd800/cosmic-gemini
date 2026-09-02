import assert from 'node:assert/strict';
import test from 'node:test';

import { createAdMarshalProduct } from '../extension/background/products/standing/ad-marshal.js';
import { normalizeSettings } from '../extension/core/config.js';

test('Ad Marshal saves its unified switch without waiting for network-rule reconciliation', async () => {
  let settings = normalizeSettings();
  globalThis.chrome = {
    declarativeNetRequest: {
      async getSessionRules() { throw new Error('DNR is temporarily unavailable.'); },
      async updateSessionRules() {}
    },
    tabs: { async query() { return []; } }
  };
  const platform = {
    async mutateSettings(update) {
      settings = normalizeSettings(update(settings));
      return settings;
    },
    async readSettings() { return settings; },
    isIncognitoContext() { return false; }
  };
  const runtimeHost = { async sync() { return false; } };
  const product = createAdMarshalProduct(runtimeHost, platform);

  const result = await product.handleMessage({ type: 'UI_SET_AD_MARSHAL_ENABLED', enabled: true });
  assert.deepEqual(result, { enabled: true });
  assert.equal(settings.adMarshal.enabled, true);
  await new Promise(resolve => setImmediate(resolve));
});
