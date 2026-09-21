import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_INCOGNITO_SETTINGS,
  DEFAULT_SETTINGS,
  normalizeAccessControlDomain,
  normalizeSettings
} from '../extension/core/config.js';
import { createAccessControlProduct } from '../extension/background/products/standing/access-control.js';

test('Access Control starts disabled and stores one canonical domain for the root and its subdomains', () => {
  assert.deepEqual(DEFAULT_SETTINGS.accessControl, { enabled: false, blockedDomains: [] });
  assert.deepEqual(DEFAULT_INCOGNITO_SETTINGS.accessControl, { enabled: false, blockedDomains: [] });
  assert.equal(normalizeAccessControlDomain('Example.COM'), 'example.com');
  assert.equal(normalizeAccessControlDomain('*.Example.COM'), 'example.com');
  assert.throws(() => normalizeAccessControlDomain('https://example.com/path'));
  assert.throws(() => normalizeAccessControlDomain('localhost'));
  assert.throws(() => normalizeAccessControlDomain('127.0.0.1'));
  assert.deepEqual(normalizeSettings({ accessControl: {
    enabled: true,
    blockedDomains: ['*.Example.com', 'example.com', 'bad/path']
  } }).accessControl, { enabled: true, blockedDomains: ['example.com'] });
});

test('Access Control installs root-and-subdomain navigation blocks and removes them when disabled', async () => {
  let settings = normalizeSettings({ accessControl: { enabled: true, blockedDomains: ['example.com', 'media.example'] } });
  let installed = [];
  const updates = [];
  globalThis.chrome = {
    runtime: { getURL: path => 'chrome-extension://test/' + path },
    declarativeNetRequest: {
      async getSessionRules() { return installed; },
      async updateSessionRules(update) {
        updates.push(update);
        const removed = new Set(update.removeRuleIds || []);
        installed = installed.filter(rule => !removed.has(rule.id)).concat(update.addRules || []);
      }
    }
  };
  const platform = {
    isIncognitoContext: () => false,
    readSettings: async () => settings,
    mutateSettings: async update => (settings = normalizeSettings(update(settings)))
  };
  const product = createAccessControlProduct(platform);
  await product.reconcile();
  assert.deepEqual(installed.map(rule => [rule.id, rule.condition.urlFilter]), [
    [920001, '||example.com^'],
    [920002, '||media.example^']
  ]);
  assert.deepEqual(installed[0].condition.resourceTypes, ['main_frame', 'sub_frame']);
  const installedOnce = updates.length;
  await product.reconcile();
  assert.equal(updates.length, installedOnce, 'unchanged rules are not reinstalled');

  const saved = await product.handleMessage({
    type: 'UI_ADD_RULE', listName: 'blockedDomains', rule: '*.docs.example.com'
  }, { sender: { url: 'chrome-extension://test/settings/satellites.html' } });
  assert.deepEqual(saved.blockedDomains, ['docs.example.com', 'example.com', 'media.example']);
  await product.reconcile();
  assert.ok(installed.some(rule => rule.condition.urlFilter === '||docs.example.com^'));

  await product.handleMessage({ type: 'UI_SET_ENABLED', enabled: false }, {
    sender: { url: 'chrome-extension://test/settings/satellites.html' }
  });
  await product.reconcile();
  assert.deepEqual(installed, []);
  assert.ok(updates.at(-1).removeRuleIds.length > 0);
});

test('Access Control rejects changes outside Settings', async () => {
  globalThis.chrome = {
    runtime: { getURL: path => 'chrome-extension://test/' + path },
    declarativeNetRequest: { async getSessionRules() { return []; }, async updateSessionRules() {} }
  };
  const settings = normalizeSettings();
  const product = createAccessControlProduct({
    isIncognitoContext: () => false,
    readSettings: async () => settings,
    mutateSettings: async update => normalizeSettings(update(settings))
  });
  await assert.rejects(product.handleMessage({ type: 'UI_SET_ENABLED', enabled: true }, {
    sender: { url: 'https://example.com/' }
  }));
});
