import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BILI_DAILY_ATTEMPT_KEY,
  bilibiliDateKey,
  browserReportsOffline,
  nextBilibiliPlan,
  nextBilibiliSchedule
} from '../extension/core/bili-daily-login.js';
import { FEATURE_IDS, SETTINGS_KEY } from '../extension/core/config.js';
import { createBiliDailyLoginProduct } from '../extension/background/products/standing/bili-daily-login.js';

function storageArea(values = {}) {
  return {
    values,
    async get(key) { return key in values ? { [key]: values[key] } : {}; },
    async set(next) { Object.assign(values, next); },
    async remove(key) {
      for (const name of Array.isArray(key) ? key : [key]) delete values[name];
    }
  };
}

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function dailyFixture(t) {
  const previous = { chrome: globalThis.chrome, fetch: globalThis.fetch, now: Date.now };
  const local = storageArea();
  const alarms = [];
  let settings = { biliDailyLogin: { enabled: true, lastCompletedDate: '' } };
  globalThis.chrome = {
    extension: { inIncognitoContext: false },
    storage: { local },
    windows: { async getAll() { return [{ incognito: false }]; } },
    alarms: {
      async create(name, options) { alarms.push({ name, options }); },
      async clear() { return true; },
      async get() { return null; }
    }
  };
  Date.now = () => Date.parse('2026-08-30T04:00:00Z');
  const product = createBiliDailyLoginProduct({
    async readSettings() { return structuredClone(settings); },
    async mutateSettings(update) { settings = update(settings); return structuredClone(settings); }
  });
  t.after(() => { globalThis.chrome = previous.chrome; globalThis.fetch = previous.fetch; Date.now = previous.now; });
  return { product, local, alarms,
    start: () => product.handleAlarm({ name: 'satellites:biliDailyLogin' }),
    disableInStorage() {
      const oldValue = structuredClone(settings);
      settings.biliDailyLogin.enabled = false;
      return product.handleStorageChanged({ [SETTINGS_KEY]: { oldValue, newValue: structuredClone(settings) } }, 'local');
    }
  };
}

for (const phase of ['window lookup', 'request-header installation']) {
  test(`Bili Daily Login cancellation during ${phase} prevents a subsequent request`, async t => {
    const f = dailyFixture(t);
    const entered = deferred(), release = deferred();
    let requests = 0;
    globalThis.fetch = async () => { requests += 1; return { ok: true, async json() { return { code: -1 }; } }; };
    if (phase === 'window lookup') {
      chrome.windows.getAll = async () => { entered.resolve(); await release.promise; return []; };
    } else {
      chrome.runtime = { id: 'test' };
      chrome.declarativeNetRequest = { async updateSessionRules(update) {
        if (update.addRules) { entered.resolve(); await release.promise; }
      } };
    }
    const run = f.start();
    await entered.promise;
    const stop = f.product.reset();
    release.resolve();
    await Promise.all([run, stop]);
    assert.equal(requests, 0);
    assert.deepEqual(f.alarms, []);
    assert.equal(BILI_DAILY_ATTEMPT_KEY in f.local.values, false);
  });
}

test('a storage disable cancels Bili Daily Login while its response body is still being read', async t => {
  const f = dailyFixture(t);
  const entered = deferred(), release = deferred();
  let requestSignal;
  globalThis.fetch = async (_url, options) => {
    requestSignal = options.signal;
    return { ok: true, json() {
      entered.resolve();
      return new Promise((resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
        release.promise.then(() => resolve({ code: -1 }));
      });
    } };
  };
  const run = f.start();
  await entered.promise;
  const stop = f.disableInStorage();
  try {
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(requestSignal.aborted, true);
  } finally {
    release.resolve();
    await Promise.all([run, stop]);
  }
  assert.deepEqual(f.alarms, []);
  assert.equal(BILI_DAILY_ATTEMPT_KEY in f.local.values, false);
});

test('Bili Daily Login keeps its request timeout active through response-body parsing', async t => {
  const f = dailyFixture(t);
  const entered = deferred(), release = deferred();
  let timeout, cleared = false;
  t.mock.method(globalThis, 'setTimeout', (callback, ms) => {
    assert.equal(ms, 30_000);
    timeout = callback;
    return 1;
  });
  t.mock.method(globalThis, 'clearTimeout', () => { cleared = true; });
  globalThis.fetch = async (_url, options) => ({ ok: true, json() {
    entered.resolve();
    return new Promise((resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new Error('timeout')), { once: true });
      release.promise.then(() => resolve({ code: -1 }));
    });
  } });
  const run = f.start();
  await entered.promise;
  try { assert.equal(cleared, false); timeout(); }
  finally { release.resolve(); await run; }
  assert.equal(cleared, true);
});

test('Bili Daily Login uses Bilibili calendar days in China Standard Time', () => {
  assert.equal(bilibiliDateKey(Date.parse('2026-08-29T15:59:59Z')), '2026-08-29');
  assert.equal(bilibiliDateKey(Date.parse('2026-08-29T16:00:00Z')), '2026-08-30');
});

test('Bili Daily Login plans separate daytime and evening checks', () => {
  const beforeDaytime = Date.parse('2026-08-30T01:00:00Z');
  assert.deepEqual(nextBilibiliPlan(beforeDaytime), {
    id: '2026-08-30:daytime',
    when: Date.parse('2026-08-30T02:05:00Z'),
    due: false
  });

  const afterDaytime = Date.parse('2026-08-30T04:00:00Z');
  assert.deepEqual(nextBilibiliPlan(afterDaytime), {
    id: '2026-08-30:daytime',
    when: afterDaytime,
    due: true
  });
  assert.deepEqual(nextBilibiliPlan(afterDaytime, '2026-08-30:daytime'), {
    id: '2026-08-30:evening',
    when: Date.parse('2026-08-30T10:05:00Z'),
    due: false
  });

  const afterEvening = Date.parse('2026-08-30T12:00:00Z');
  assert.equal(nextBilibiliPlan(afterEvening).id, '2026-08-30:evening');
  assert.equal(nextBilibiliPlan(afterEvening).due, true);
  assert.deepEqual(nextBilibiliPlan(afterEvening, '2026-08-30:evening'), {
    id: '2026-08-31:daytime',
    when: Date.parse('2026-08-31T02:05:00Z'),
    due: false
  });
  assert.equal(
    nextBilibiliSchedule(afterEvening, '2026-08-30:evening'),
    Date.parse('2026-08-31T02:05:00Z')
  );
});

test('Bili Daily Login skips requests when Chrome explicitly reports offline', () => {
  assert.equal(browserReportsOffline({ onLine: false }), true);
  assert.equal(browserReportsOffline({ onLine: true }), false);
  assert.equal(browserReportsOffline({}), false);
});

test('Bili Daily Login ordinary state preserves the saved switch', async () => {
  globalThis.chrome = { extension: { inIncognitoContext: false } };
  const settings = {
    biliDailyLogin: { enabled: true, lastCompletedDate: '2026-08-30' }
  };
  const product = createBiliDailyLoginProduct({});
  assert.equal(product.id, FEATURE_IDS.BILI_DAILY_LOGIN);
  assert.deepEqual(await product.state(settings), settings.biliDailyLogin);
});

test('disabling Bili Daily Login aborts an in-flight request without rescheduling it', async () => {
  const local = storageArea({ [BILI_DAILY_ATTEMPT_KEY]: '2026-08-30:daytime' });
  const createdAlarms = [];
  let settings = {
    biliDailyLogin: { enabled: true, lastCompletedDate: '' }
  };
  globalThis.chrome = {
    extension: { inIncognitoContext: false },
    storage: { local },
    alarms: {
      async create(name, options) { createdAlarms.push({ name, options }); },
      async clear() { return true; },
      async get() { return null; }
    }
  };
  let requestStarted;
  const started = new Promise(resolve => { requestStarted = resolve; });
  const originalFetch = globalThis.fetch;
  const originalNow = Date.now;
  Date.now = () => Date.parse('2026-08-30T12:00:00Z');
  globalThis.fetch = (_url, options) => new Promise((resolve, reject) => {
    requestStarted();
    options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  });
  const platform = {
    async readSettings() { return structuredClone(settings); },
    async mutateSettings(update) {
      settings = update(settings);
      return structuredClone(settings);
    }
  };
  try {
    const product = createBiliDailyLoginProduct(platform);
    const alarmRun = product.handleAlarm({ name: 'satellites:biliDailyLogin' });
    await started;
    await product.handleMessage({ type: 'UI_SET_BILI_DAILY_LOGIN', enabled: false });
    await alarmRun;
    assert.equal(settings.biliDailyLogin.enabled, false);
    assert.equal(BILI_DAILY_ATTEMPT_KEY in local.values, false);
    assert.deepEqual(createdAlarms, []);
  } finally {
    globalThis.fetch = originalFetch;
    Date.now = originalNow;
  }
});

test('Bili Daily Login never schedules from the split incognito background context', async () => {
  let settings = { biliDailyLogin: { enabled: false, lastCompletedDate: '' } };
  const createdAlarms = [];
  const local = storageArea({ [BILI_DAILY_ATTEMPT_KEY]: '2026-08-30:daytime' });
  globalThis.chrome = {
    extension: { inIncognitoContext: true },
    storage: { local },
    alarms: {
      async create(name, options) { createdAlarms.push({ name, options }); },
      async clear() { return true; },
      async get() { return null; }
    }
  };
  const product = createBiliDailyLoginProduct({
    async readSettings() { return structuredClone(settings); },
    async mutateSettings(update) {
      settings = update(settings);
      return structuredClone(settings);
    }
  });
  const result = await product.handleMessage({ type: 'UI_SET_BILI_DAILY_LOGIN', enabled: true });
  await product.handleStorageChanged({ cosmicGeminiSettings: { newValue: settings } }, 'local');
  assert.deepEqual(result, { enabled: false, lastCompletedDate: '', available: false });
  assert.equal(settings.biliDailyLogin.enabled, false);
  assert.deepEqual(await product.state(settings), { enabled: false, lastCompletedDate: '', available: false });
  assert.equal(local.values[BILI_DAILY_ATTEMPT_KEY], '2026-08-30:daytime');
  assert.deepEqual(createdAlarms, []);
});

test('Bili Daily Login waits when no regular Chrome window is open', async () => {
  const local = storageArea();
  const createdAlarms = [];
  let requests = 0;
  const settings = { biliDailyLogin: { enabled: true, lastCompletedDate: '' } };
  globalThis.chrome = {
    extension: { inIncognitoContext: false },
    windows: { async getAll() { return []; } },
    storage: { local },
    alarms: {
      async create(name, options) { createdAlarms.push({ name, options }); },
      async clear() { return true; },
      async get() { return null; }
    }
  };
  const originalFetch = globalThis.fetch;
  const originalNow = Date.now;
  Date.now = () => Date.parse('2026-08-30T04:00:00Z');
  globalThis.fetch = async () => { requests += 1; throw new Error('unexpected request'); };
  try {
    const product = createBiliDailyLoginProduct({ async readSettings() { return structuredClone(settings); } });
    await product.handleAlarm({ name: 'satellites:biliDailyLogin' });
    assert.equal(requests, 0);
    assert.equal(BILI_DAILY_ATTEMPT_KEY in local.values, false);
    assert.equal(createdAlarms.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
    Date.now = originalNow;
  }
});

test('Bili Daily Login verifies completion and still schedules the second daily check', async () => {
  const local = storageArea();
  const createdAlarms = [];
  const requests = [];
  const ruleUpdates = [];
  let settings = { biliDailyLogin: { enabled: true, lastCompletedDate: '' } };
  globalThis.chrome = {
    extension: { inIncognitoContext: false },
    runtime: { id: 'cosmic-gemini-test' },
    declarativeNetRequest: {
      async updateSessionRules(update) { ruleUpdates.push(update); }
    },
    windows: { async getAll() { return [{ incognito: false }]; } },
    storage: { local },
    alarms: {
      async create(name, options) { createdAlarms.push({ name, options }); },
      async clear() { return true; },
      async get() { return null; }
    }
  };
  const originalFetch = globalThis.fetch;
  const originalNow = Date.now;
  Date.now = () => Date.parse('2026-08-30T04:00:00Z');
  globalThis.fetch = async url => {
    requests.push(url);
    const body = url.endsWith('/nav')
      ? { code: 0, data: { isLogin: true } }
      : { code: 0, data: { login: true } };
    return { ok: true, async json() { return body; } };
  };
  const platform = {
    async readSettings() { return structuredClone(settings); },
    async mutateSettings(update) {
      settings = update(settings);
      return structuredClone(settings);
    }
  };
  try {
    const product = createBiliDailyLoginProduct(platform);
    await product.handleAlarm({ name: 'satellites:biliDailyLogin' });
    assert.deepEqual(requests, [
      'https://api.bilibili.com/x/web-interface/nav',
      'https://api.bilibili.com/x/member/web/exp/reward'
    ]);
    assert.equal(local.values[BILI_DAILY_ATTEMPT_KEY], '2026-08-30:daytime');
    assert.equal(settings.biliDailyLogin.lastCompletedDate, '2026-08-30');
    assert.equal(createdAlarms.at(-1).options.when, Date.parse('2026-08-30T10:05:00Z'));
    assert.deepEqual(ruleUpdates[1].addRules[0].condition, {
      initiatorDomains: ['cosmic-gemini-test'],
      requestDomains: ['api.bilibili.com'],
      regexFilter: '^https://api\\.bilibili\\.com/x/(web-interface/nav|member/web/exp/reward)(?:\\?.*)?$',
      resourceTypes: ['xmlhttprequest']
    });
    assert.deepEqual(ruleUpdates[1].addRules[0].action.requestHeaders, [
      { operation: 'set', header: 'Origin', value: 'https://www.bilibili.com' },
      { operation: 'set', header: 'Referer', value: 'https://www.bilibili.com/' }
    ]);
    assert.deepEqual(ruleUpdates.at(-1), { removeRuleIds: [800001] });
  } finally {
    globalThis.fetch = originalFetch;
    Date.now = originalNow;
  }
});
