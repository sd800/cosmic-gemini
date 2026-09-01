import assert from 'node:assert/strict';
import test from 'node:test';
import { bilibiliDateKey, browserReportsOffline, nextBilibiliSchedule } from '../extension/core/bili-daily-login.js';
import { createSatellitesProduct } from '../extension/background/products/operations/satellites.js';

test('Bili Daily Login uses Bilibili calendar days in China Standard Time', () => {
  assert.equal(bilibiliDateKey(Date.parse('2026-08-29T15:59:59Z')), '2026-08-29');
  assert.equal(bilibiliDateKey(Date.parse('2026-08-29T16:00:00Z')), '2026-08-30');
});

test('Bili Daily Login schedules 00:05 in China Standard Time regardless of local timezone', () => {
  assert.equal(
    new Date(nextBilibiliSchedule(Date.parse('2026-08-29T16:04:00Z'))).toISOString(),
    '2026-08-29T16:05:00.000Z'
  );
  assert.equal(
    new Date(nextBilibiliSchedule(Date.parse('2026-08-29T17:00:00Z'))).toISOString(),
    '2026-08-30T16:05:00.000Z'
  );
});

test('Bili Daily Login skips requests when Chrome explicitly reports offline', () => {
  assert.equal(browserReportsOffline({ onLine: false }), true);
  assert.equal(browserReportsOffline({ onLine: true }), false);
  assert.equal(browserReportsOffline({}), false);
});

test('disabling Bili Daily Login aborts an in-flight request without rescheduling it', async () => {
  const session = {};
  const createdAlarms = [];
  let settings = {
    satellites: { biliDailyLogin: { enabled: true, lastCompletedDate: '' } }
  };
  globalThis.chrome = {
    storage: {
      session: {
        async get(key) { return key in session ? { [key]: session[key] } : {}; },
        async set(values) { Object.assign(session, values); },
        async remove(key) { delete session[key]; }
      }
    },
    alarms: {
      async create(name, options) { createdAlarms.push({ name, options }); },
      async clear() { return true; },
      async get() { return null; }
    }
  };
  let requestStarted;
  const started = new Promise(resolve => { requestStarted = resolve; });
  const originalFetch = globalThis.fetch;
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
    assert.deepEqual(createdAlarms, []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
