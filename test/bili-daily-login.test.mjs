import assert from 'node:assert/strict';
import test from 'node:test';
import { bilibiliDateKey, browserReportsOffline, nextBilibiliSchedule } from '../extension/core/bili-daily-login.js';

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
