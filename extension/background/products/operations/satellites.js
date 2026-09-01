import {
  BILI_DAILY_ALARM,
  BILI_DAILY_MAX_ATTEMPTS,
  BILI_DAILY_RETRY_MS,
  BILI_DAILY_RETRY_KEY,
  bilibiliDateKey,
  browserReportsOffline,
  nextBilibiliSchedule
} from '../../../core/bili-daily-login.js';

export function createSatellitesProduct(platform) {
  let running = null;
  let scheduleRepair = null;
  let scheduleRepairAttempts = 0;

  async function requestJson(url) {
    const response = await fetch(url, {
      cache: 'no-store',
      credentials: 'include',
      headers: { Accept: 'application/json' }
    });
    if (!response.ok) throw new Error('Bilibili request failed.');
    return response.json();
  }

  async function schedule(when) {
    await chrome.alarms.create(BILI_DAILY_ALARM, { when: Math.max(Date.now() + 1_000, Number(when)) });
  }

  async function syncSchedule() {
    const settings = await platform.readSettings();
    const feature = settings.satellites.biliDailyLogin;
    if (!feature.enabled) {
      await chrome.alarms.clear(BILI_DAILY_ALARM);
      await chrome.storage.session.remove(BILI_DAILY_RETRY_KEY);
      return;
    }
    const existing = await chrome.alarms.get(BILI_DAILY_ALARM);
    if (existing?.scheduledTime > Date.now()) return;
    await schedule(feature.lastCompletedDate === bilibiliDateKey() ? nextBilibiliSchedule() : Date.now() + 1_000);
  }

  function repairSchedule() {
    if (scheduleRepair || scheduleRepairAttempts >= 3) return;
    scheduleRepairAttempts += 1;
    scheduleRepair = setTimeout(() => {
      scheduleRepair = null;
      void syncSchedule()
        .then(() => { scheduleRepairAttempts = 0; })
        .catch(() => repairSchedule());
    }, 5_000);
  }

  async function ensureSchedule() {
    try {
      await syncSchedule();
      scheduleRepairAttempts = 0;
    } catch (error) {
      repairSchedule();
      throw error;
    }
  }

  function cancelScheduleRepair() {
    if (scheduleRepair) clearTimeout(scheduleRepair);
    scheduleRepair = null;
    scheduleRepairAttempts = 0;
  }

  async function run() {
    const settings = await platform.readSettings();
    const feature = settings.satellites.biliDailyLogin;
    const today = bilibiliDateKey();
    if (!feature.enabled) {
      await chrome.alarms.clear(BILI_DAILY_ALARM);
      await chrome.storage.session.remove(BILI_DAILY_RETRY_KEY);
      return;
    }
    if (feature.lastCompletedDate === today) {
      await chrome.storage.session.remove(BILI_DAILY_RETRY_KEY);
      await schedule(nextBilibiliSchedule());
      return;
    }
    if (browserReportsOffline()) {
      await schedule(Math.min(Date.now() + BILI_DAILY_RETRY_MS, nextBilibiliSchedule()));
      return;
    }
    const stored = (await chrome.storage.session.get(BILI_DAILY_RETRY_KEY))[BILI_DAILY_RETRY_KEY];
    const attempts = stored?.date === today ? Number(stored.attempts || 0) : 0;
    if (attempts >= BILI_DAILY_MAX_ATTEMPTS) {
      await schedule(nextBilibiliSchedule());
      return;
    }
    const nextAttempts = attempts + 1;
    await chrome.storage.session.set({ [BILI_DAILY_RETRY_KEY]: { date: today, attempts: nextAttempts } });
    let completed = false;
    try {
      const account = await requestJson('https://api.bilibili.com/x/web-interface/nav');
      if (account?.code === 0 && account?.data?.isLogin === true) {
        const reward = await requestJson('https://api.bilibili.com/x/member/web/exp/reward');
        completed = reward?.code === 0 && reward?.data?.login === true;
      }
    } catch {}
    if (completed) {
      await platform.mutateSettings(current => ({
        ...current,
        satellites: {
          ...current.satellites,
          biliDailyLogin: { ...current.satellites.biliDailyLogin, lastCompletedDate: today }
        }
      }), false);
      await chrome.storage.session.remove(BILI_DAILY_RETRY_KEY);
      await schedule(nextBilibiliSchedule());
      return;
    }
    await schedule(nextAttempts < BILI_DAILY_MAX_ATTEMPTS
      ? Math.min(Date.now() + BILI_DAILY_RETRY_MS, nextBilibiliSchedule())
      : nextBilibiliSchedule());
  }

  function runOnce() {
    if (running) return running;
    running = run().finally(() => { running = null; });
    return running;
  }

  return Object.freeze({
    id: 'satellites',
    async state(settings) { return settings.satellites; },
    ensureSchedule,
    async handleMessage(message) {
      if (message.type !== 'UI_SET_BILI_DAILY_LOGIN') throw new Error('Satellites does not support this command.');
      const enabled = message.enabled === true;
      const settings = await platform.mutateSettings(current => ({
        ...current,
        satellites: {
          ...current.satellites,
          biliDailyLogin: { ...current.satellites.biliDailyLogin, enabled }
        }
      }));
      try {
        await chrome.storage.session.remove(BILI_DAILY_RETRY_KEY);
        await chrome.alarms.clear(BILI_DAILY_ALARM);
        if (enabled) await ensureSchedule();
        else cancelScheduleRepair();
      } catch { repairSchedule(); }
      return settings.satellites.biliDailyLogin;
    },
    async handleAlarm(alarm) {
      if (alarm.name !== BILI_DAILY_ALARM) return false;
      await runOnce();
      return true;
    },
    async reset() {
      cancelScheduleRepair();
      await chrome.alarms.clear(BILI_DAILY_ALARM);
      await chrome.storage.session.remove(BILI_DAILY_RETRY_KEY);
    }
  });
}
