import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_INCOGNITO_SETTINGS,
  DEFAULT_SETTINGS,
  normalizeAccessControlDomain,
  normalizeSettings
} from '../extension/core/config.js';
import { createAccessControlProduct } from '../extension/background/products/standing/access-control.js';

test('Access Control starts disabled and stores canonical domains and exact IP addresses', () => {
  assert.deepEqual(DEFAULT_SETTINGS.accessControl, { enabled: false, blockedDomains: [] });
  assert.deepEqual(DEFAULT_INCOGNITO_SETTINGS.accessControl, { enabled: false, blockedDomains: [] });
  assert.equal(normalizeAccessControlDomain('Example.COM'), 'example.com');
  assert.equal(normalizeAccessControlDomain('*.Example.COM'), 'example.com');
  assert.equal(normalizeAccessControlDomain('192.0.2.1'), '192.0.2.1');
  assert.equal(normalizeAccessControlDomain('2001:0db8::1'), '[2001:db8::1]');
  assert.throws(() => normalizeAccessControlDomain('https://example.com/path'));
  assert.throws(() => normalizeAccessControlDomain('localhost'));
  assert.deepEqual(normalizeSettings({ accessControl: {
    enabled: true,
    blockedDomains: ['z.example', '*.Example.com', 'z.example', 'bad/path', 'a.example', '192.0.2.1', '2001:db8::1']
  } }).accessControl, {
    enabled: true,
    blockedDomains: ['z.example', 'example.com', 'a.example', '192.0.2.1', '[2001:db8::1]']
  });
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
  assert.deepEqual(saved.blockedDomains, ['example.com', 'media.example', 'docs.example.com']);
  await product.reconcile();
  assert.deepEqual(installed.map(rule => rule.condition.urlFilter), [
    '||example.com^', '||media.example^', '||docs.example.com^'
  ]);

  await product.handleMessage({
    type: 'UI_DELETE_RULE', listName: 'blockedDomains', rule: 'example.com'
  }, { sender: { url: 'chrome-extension://test/settings/satellites.html' } });
  const reordered = await product.handleMessage({
    type: 'UI_ADD_RULE', listName: 'blockedDomains', rule: 'example.com'
  }, { sender: { url: 'chrome-extension://test/settings/satellites.html' } });
  assert.deepEqual(reordered.blockedDomains, ['media.example', 'docs.example.com', 'example.com']);
  await product.reconcile();
  assert.deepEqual(installed.map(rule => rule.condition.urlFilter), [
    '||media.example^', '||docs.example.com^', '||example.com^'
  ]);

  const alphabetized = await product.handleMessage({
    type: 'UI_ALPHABETIZE_RULES', listName: 'blockedDomains'
  }, { sender: { url: 'chrome-extension://test/settings/satellites.html' } });
  assert.deepEqual(alphabetized.blockedDomains, ['docs.example.com', 'example.com', 'media.example']);
  await product.reconcile();
  assert.deepEqual(installed.map(rule => rule.condition.urlFilter), [
    '||docs.example.com^', '||example.com^', '||media.example^'
  ]);

  const appended = await product.handleMessage({
    type: 'UI_ADD_RULE', listName: 'blockedDomains', rule: 'a-later.example'
  }, { sender: { url: 'chrome-extension://test/settings/satellites.html' } });
  assert.deepEqual(appended.blockedDomains, [
    'docs.example.com', 'example.com', 'media.example', 'a-later.example'
  ]);

  await product.handleMessage({
    type: 'UI_ADD_RULE', listName: 'blockedDomains', rule: '192.0.2.1'
  }, { sender: { url: 'chrome-extension://test/settings/satellites.html' } });
  await product.handleMessage({
    type: 'UI_ADD_RULE', listName: 'blockedDomains', rule: '2001:0db8::1'
  }, { sender: { url: 'chrome-extension://test/settings/satellites.html' } });
  await product.reconcile();
  assert.equal(installed.at(-2).condition.urlFilter, undefined);
  assert.equal(new RegExp(installed.at(-2).condition.regexFilter).test('http://192.0.2.1:8080/path'), true);
  assert.equal(new RegExp(installed.at(-2).condition.regexFilter).test('http://x.192.0.2.1/path'), false);
  assert.equal(installed.at(-1).condition.urlFilter, undefined);
  assert.match(installed.at(-1).condition.regexFilter, /2001:db8::1/);
  assert.equal(new RegExp(installed.at(-1).condition.regexFilter).test('https://[2001:db8::1]:8443/path'), true);

  const cleared = await product.handleMessage({
    type: 'UI_CLEAR_RULES', listName: 'blockedDomains'
  }, { sender: { url: 'chrome-extension://test/settings/satellites.html' } });
  assert.deepEqual(cleared.blockedDomains, []);
  await product.reconcile();
  assert.deepEqual(installed, []);

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
