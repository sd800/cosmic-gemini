export const BILI_DAILY_ALARM = 'satellites:biliDailyLogin';
export const BILI_DAILY_ATTEMPT_KEY = 'satellites:biliDailyLogin:lastAttemptSlot';
export const BILI_DAILY_DEFER_MS = 60 * 60 * 1000;

const CHINA_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const WINDOWS = Object.freeze([
  Object.freeze({ id: 'daytime', hour: 10, minute: 5 }),
  Object.freeze({ id: 'evening', hour: 18, minute: 5 })
]);

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

function slot(date, dayStart, window) {
  return {
    id: `${date}:${window.id}`,
    when: dayStart + (window.hour * 60 + window.minute) * 60 * 1000
  };
}

export function bilibiliDateKey(now = Date.now()) {
  return chinaParts(now).date;
}

export function browserReportsOffline(navigatorValue = globalThis.navigator) {
  return navigatorValue?.onLine === false;
}

export function nextBilibiliPlan(now = Date.now(), lastAttemptSlot = '') {
  const current = Number(now);
  const { date, dayStart } = chinaParts(current);
  const daytime = slot(date, dayStart, WINDOWS[0]);
  const evening = slot(date, dayStart, WINDOWS[1]);

  if (current < daytime.when) return { ...daytime, due: false };
  if (current < evening.when) {
    return lastAttemptSlot === daytime.id || lastAttemptSlot === evening.id
      ? { ...evening, due: false }
      : { ...daytime, when: current, due: true };
  }
  if (lastAttemptSlot !== evening.id) return { ...evening, when: current, due: true };

  const tomorrow = new Date(current + DAY_MS + CHINA_OFFSET_MS).toISOString().slice(0, 10);
  return {
    ...slot(tomorrow, dayStart + DAY_MS, WINDOWS[0]),
    due: false
  };
}

export function nextBilibiliSchedule(now = Date.now(), lastAttemptSlot = '') {
  return nextBilibiliPlan(now, lastAttemptSlot).when;
}
