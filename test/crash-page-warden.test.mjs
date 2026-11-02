import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeSettings } from '../extension/core/config.js';
import { WARDEN_CSP, wardenPageUrl, sameWardenPage } from '../extension/core/crash-page-warden.js';
import { websiteToolEnabled } from '../extension/background/products/standing/website-fixer-tools.js';
import { createCrashPageWarden, wardenRules } from '../extension/background/products/standing/website-fixer-warden.js';
import { normalizeCrashPageWardenRuleInput } from '../extension/core/website-rule-input.js';

const tools = () => ({ translateOverride: [], stayOnPage: [], crashPageWarden: [] });
const settings = (domains = ['news.example.test']) => normalizeSettings({ websiteFixer: { crashPageWarden: { enabled: true, whitelistDomains: domains } } });

test('static policy preserves exact hosts, explicit wildcards, and temporary off choices', () => {
  const s = settings(['news.example.test', '*.second.test']);
  assert.equal(websiteToolEnabled(s, tools(), 'crashPageWarden', 'https://news.example.test/a'), true);
  assert.equal(websiteToolEnabled(s, tools(), 'crashPageWarden', 'https://other.example.test/a'), false);
  assert.equal(websiteToolEnabled(s, tools(), 'crashPageWarden', 'https://deep.second.test/a'), true);
  assert.equal(websiteToolEnabled(s, { ...tools(), crashPageWarden: [{ site: 'second.test', enabled: false }] }, 'crashPageWarden', 'https://second.test/a'), false);
  assert.equal(normalizeCrashPageWardenRuleInput('https://news.example.test/path'), 'news.example.test');
  assert.equal(normalizeCrashPageWardenRuleInput('*.second.test'), '*.second.test');
  assert.throws(() => normalizeCrashPageWardenRuleInput('https://name:secret@news.example.test/'));
});

test('native protection targets HTML GET responses in the owning tabs without redirecting the address', () => {
  const [rule] = wardenRules(settings(), tools(), [7]);
  assert.equal(rule.action.type, 'modifyHeaders');
  assert.equal(rule.action.redirect, undefined);
  assert.deepEqual(rule.condition.tabIds, [7]);
  assert.deepEqual(rule.condition.requestMethods, ['get']);
  assert.deepEqual(rule.condition.resourceTypes, ['main_frame']);
  assert.deepEqual(rule.condition.responseHeaders[0].values, ['text/html*', 'application/xhtml+xml*']);
  assert.ok(new RegExp(rule.condition.regexFilter).test('https://news.example.test/a'));
  assert.equal(new RegExp(rule.condition.regexFilter).test('https://news.example.test.evil/a'), false);
  assert.equal(rule.priority, 210, 'one-time navigation allowances must not suppress response hardening');
  assert.match(WARDEN_CSP, /script-src 'none'/);
  assert.match(WARDEN_CSP, /sandbox allow-same-origin/);
  assert.match(WARDEN_CSP, /worker-src 'none'/);
  assert.equal(wardenRules(settings(), tools(), [7], true)[0].id, 942001);
  assert.deepEqual(wardenRules(settings(), tools(), []), []);
  assert.equal(wardenPageUrl('https://news.example.test/file.pdf'), '');
  assert.equal(sameWardenPage('https://news.example.test/a#one', 'https://news.example.test/a#two'), true);
});

function fixture(t) {
  const previous = globalThis.chrome, stored = {}, scripts = new Map(), reloads = [];
  const tabs = new Map([[7, { id: 7, url: 'https://news.example.test/a', incognito: false }],
    [8, { id: 8, url: 'https://news.example.test/private', incognito: true }]]);
  let rules = [{ id: 920001, priority: 100, action: { type: 'block' } }], protectedPage = false, failRules = false;
  globalThis.chrome = {
    tabs: { query: async () => [...tabs.values()], get: async id => ({ ...tabs.get(id) }), reload: async id => { reloads.push(id); } },
    scripting: {
      getRegisteredContentScripts: async ({ ids }) => [...scripts.values()].filter(s => ids.includes(s.id)),
      registerContentScripts: async list => { for (const s of list) scripts.set(s.id, s); },
      updateContentScripts: async list => { for (const s of list) scripts.set(s.id, s); },
      unregisterContentScripts: async ({ ids }) => { for (const id of ids) scripts.delete(id); },
      executeScript: async () => [{ documentId: 'doc-one', result: { active: protectedPage, href: tabs.get(7).url } }]
    },
    declarativeNetRequest: {
      getSessionRules: async () => structuredClone(rules),
      updateSessionRules: async ({ removeRuleIds, addRules = [] }) => { if (!failRules) rules = rules.filter(r => !removeRuleIds.includes(r.id)).concat(addRules); }
    }
  };
  const platform = { isIncognitoContext: () => false, getLocale: async () => 'en-US', sessionStorage: {
    get: async key => ({ [key]: structuredClone(stored[key]) }), set: async values => Object.assign(stored, structuredClone(values)),
    remove: async key => { delete stored[key]; }
  } };
  const product = createCrashPageWarden(platform);
  const sender = () => ({ frameId: 0, documentId: 'doc-one', tab: { ...tabs.get(7) }, url: tabs.get(7).url });
  t.after(() => { globalThis.chrome = previous; });
  return { product, platform, sender, tabs, scripts, reloads, stored, rules: () => rules,
    protect: () => { protectedPage = true; }, fail: () => { failRules = true; } };
}

test('reconciliation retires watchdog hooks, preserves other rules, and isolates private tabs', async t => {
  const f = fixture(t);
  f.scripts.set('cosmic-gemini-crash-page-warden-bootstrap', { id: 'cosmic-gemini-crash-page-warden-bootstrap' });
  await f.product.reconcile(settings(), tools());
  assert.equal(f.scripts.has('cosmic-gemini-crash-page-warden-bootstrap'), false);
  const script = f.scripts.get('cosmic-gemini-crash-page-warden');
  assert.equal(script.world, 'ISOLATED'); assert.equal(script.runAt, 'document_start'); assert.equal(script.allFrames, false);
  assert.equal(script.js[0], 'content/crash-page-warden/bootstrap.js');
  assert.deepEqual(f.rules().find(r => r.id === 940001).condition.tabIds, [7]);
  assert.ok(f.rules().some(r => r.id === 920001));
  await f.product.reset();
  assert.equal(f.scripts.size, 0); assert.deepEqual(f.rules().map(r => r.id), [920001]);
});

test('native rule acknowledgement is required before a save succeeds', async t => {
  const f = fixture(t); f.fail();
  await assert.rejects(f.product.reconcile(settings(), tools()), /verify/);
});

test('activation automatically reloads once and leaves already static pages alone across worker restarts', async t => {
  const f = fixture(t);
  await f.product.reconcile(settings(), tools());
  await f.product.syncSites(['example.test'], settings(), tools());
  await f.product.syncSites(['example.test'], settings(), tools());
  assert.deepEqual(f.reloads, [7]);
  assert.equal((await f.product.activate(settings(), tools(), f.sender())).active, true);
  f.protect();
  const restarted = createCrashPageWarden(f.platform);
  await restarted.reconcile(settings(), tools());
  await restarted.syncSites(null, settings(), tools());
  assert.deepEqual(f.reloads, [7]);
});

test('off choices and reset retain the current document but cannot transfer authorization to a reload or private frame', async t => {
  const f = fixture(t);
  assert.equal((await f.product.activate(settings(), tools(), f.sender())).active, true);
  const off = normalizeSettings();
  await f.product.reconcile(off, tools());
  assert.equal((await f.product.activate(off, tools(), f.sender())).active, true);
  await f.product.reset();
  assert.equal((await f.product.activate(off, tools(), f.sender())).active, true);
  assert.equal((await f.product.activate(off, tools(), { ...f.sender(), documentId: 'new-document' })).active, false);
  assert.equal((await f.product.activate(settings(), tools(), { ...f.sender(), frameId: 1 })).active, false);
  assert.equal((await f.product.activate(settings(), tools(), { ...f.sender(), tab: { ...f.sender().tab, incognito: true } })).active, false);
  await f.product.handleTabRemoved(7);
  assert.equal(f.stored.cosmicGeminiCrashPageWardenStatic.length, 0);
});

test('a requested automatic reload remains protected when policy changes while that reload is in progress', async t => {
  const f = fixture(t);
  await f.product.reconcile(settings(), tools()); await f.product.syncSites(null, settings(), tools());
  assert.equal((await f.product.activate(normalizeSettings(), tools(), f.sender())).active, true);
  assert.equal((await f.product.activate(normalizeSettings(), tools(), { ...f.sender(), documentId: 'next-reload' })).active, false);
});
