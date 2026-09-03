import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BILI_DAILY_ATTEMPT_KEY,
  bilibiliDateKey,
  browserReportsOffline,
  nextBilibiliPlan,
  nextBilibiliSchedule
} from '../extension/core/bili-daily-login.js';
import { createSatellitesProduct } from '../extension/background/products/operations/satellites.js';

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
    satellites: { biliDailyLogin: { enabled: true, lastCompletedDate: '2026-08-30' } }
  };
  const product = createSatellitesProduct({});
  assert.deepEqual(await product.state(settings), settings.satellites);
});

test('disabling Bili Daily Login aborts an in-flight request without rescheduling it', async () => {
  const local = storageArea({ [BILI_DAILY_ATTEMPT_KEY]: '2026-08-30:daytime' });
  const createdAlarms = [];
  let settings = {
    satellites: { biliDailyLogin: { enabled: true, lastCompletedDate: '' } }
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
    const product = createSatellitesProduct(platform);
    const alarmRun = product.handleAlarm({ name: 'satellites:biliDailyLogin' });
    await started;
    await product.handleMessage({ type: 'UI_SET_BILI_DAILY_LOGIN', enabled: false });
    await alarmRun;
    assert.equal(settings.satellites.biliDailyLogin.enabled, false);
    assert.equal(BILI_DAILY_ATTEMPT_KEY in local.values, false);
    assert.deepEqual(createdAlarms, []);
  } finally {
    globalThis.fetch = originalFetch;
    Date.now = originalNow;
  }
});

test('Bili Daily Login never schedules from the split incognito background context', async () => {
  let settings = { satellites: { biliDailyLogin: { enabled: false, lastCompletedDate: '' } } };
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
  const product = createSatellitesProduct({
    async readSettings() { return structuredClone(settings); },
    async mutateSettings(update) {
      settings = update(settings);
      return structuredClone(settings);
    }
  });
  const result = await product.handleMessage({ type: 'UI_SET_BILI_DAILY_LOGIN', enabled: true });
  await product.handleStorageChanged({ cosmicGeminiSettings: { newValue: settings } }, 'local');
  assert.deepEqual(result, { enabled: false, lastCompletedDate: '', available: false });
  assert.equal(settings.satellites.biliDailyLogin.enabled, false);
  assert.deepEqual(await product.state(settings), {
    biliDailyLogin: { enabled: false, lastCompletedDate: '', available: false }
  });
  assert.equal(local.values[BILI_DAILY_ATTEMPT_KEY], '2026-08-30:daytime');
  assert.deepEqual(createdAlarms, []);
});

test('Bili Daily Login waits when no regular Chrome window is open', async () => {
  const local = storageArea();
  const createdAlarms = [];
  let requests = 0;
  const settings = { satellites: { biliDailyLogin: { enabled: true, lastCompletedDate: '' } } };
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
    const product = createSatellitesProduct({ async readSettings() { return structuredClone(settings); } });
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
  let settings = { satellites: { biliDailyLogin: { enabled: true, lastCompletedDate: '' } } };
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
    const product = createSatellitesProduct(platform);
    await product.handleAlarm({ name: 'satellites:biliDailyLogin' });
    assert.deepEqual(requests, [
      'https://api.bilibili.com/x/web-interface/nav',
      'https://api.bilibili.com/x/member/web/exp/reward'
    ]);
    assert.equal(local.values[BILI_DAILY_ATTEMPT_KEY], '2026-08-30:daytime');
    assert.equal(settings.satellites.biliDailyLogin.lastCompletedDate, '2026-08-30');
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
