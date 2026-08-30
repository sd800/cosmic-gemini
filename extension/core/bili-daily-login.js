export const BILI_DAILY_ALARM = 'satellites:biliDailyLogin';
export const BILI_DAILY_RETRY_MS = 60 * 60 * 1000;
export const BILI_DAILY_RETRY_KEY = 'satellites:biliDailyLogin:retry';
export const BILI_DAILY_MAX_ATTEMPTS = 3;

export function bilibiliDateKey(now = Date.now()) {
  return new Date(Number(now) + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function browserReportsOffline(navigatorValue = globalThis.navigator) {
  return navigatorValue?.onLine === false;
}

export function nextBilibiliSchedule(now = Date.now()) {
  const shifted = new Date(Number(now) + 8 * 60 * 60 * 1000);
  const today = Date.UTC(
    shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate(), 0, 5
  ) - 8 * 60 * 60 * 1000;
  return Number(now) < today ? today : today + 24 * 60 * 60 * 1000;
}
