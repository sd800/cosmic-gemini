export const BILI_DAILY_ALARM = 'satellites:biliDailyLogin';
export const BILI_DAILY_ATTEMPT_KEY = 'satellites:biliDailyLogin:lastAttemptSlot';
export const BILI_DAILY_DEFER_MS = 60 * 60 * 1000;

const CHINA_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const CHECK_OFFSET_MS = (10 * 60 + 5) * 60 * 1000;

function chinaParts(now) {
  const shifted = new Date(Number(now) + CHINA_OFFSET_MS);
  const dayStart = Date.UTC(
    shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()
  ) - CHINA_OFFSET_MS;
  return {
    date: shifted.toISOString().slice(0, 10),
    dayStart
  };
}

export function bilibiliDateKey(now = Date.now()) {
  return chinaParts(now).date;
}

export function browserReportsOffline(navigatorValue = globalThis.navigator) {
  return navigatorValue?.onLine === false;
}

export function nextBilibiliPlan(now = Date.now(), lastAttempt = '') {
  const current = Number(now);
  const { date, dayStart } = chinaParts(current);
  const scheduled = dayStart + CHECK_OFFSET_MS;
  // Either legacy time slot counts as the day's attempt after upgrading.
  if (lastAttempt.split(':', 1)[0] === date) {
    return { id: bilibiliDateKey(current + DAY_MS), when: scheduled + DAY_MS, due: false };
  }
  return { id: date, when: Math.max(current, scheduled), due: current >= scheduled };
}

export function nextBilibiliSchedule(now = Date.now(), lastAttempt = '') {
  return nextBilibiliPlan(now, lastAttempt).when;
}
