import {
  BILI_DAILY_ALARM,
  BILI_DAILY_MAX_ATTEMPTS,
  BILI_DAILY_RETRY_MS,
  BILI_DAILY_RETRY_KEY,
  bilibiliDateKey,
  browserReportsOffline,
  nextBilibiliSchedule
} from '../../../core/bili-daily-login.js';
import { SETTINGS_KEY } from '../../../core/config.js';

export function createSatellitesProduct(platform) {
  const ownsDailySchedule = chrome.extension?.inIncognitoContext !== true;
  let running = null;
  let runController = null;
  let scheduleRepair = null;
  let scheduleRepairAttempts = 0;

  async function requestJson(url, signal) {
    const response = await fetch(url, {
      cache: 'no-store',
      credentials: 'include',
      signal,
      headers: { Accept: 'application/json' }
    });
    if (!response.ok) throw new Error('Bilibili request failed.');
    return response.json();
  }

  async function schedule(when) {
    await chrome.alarms.create(BILI_DAILY_ALARM, { when: Math.max(Date.now() + 1_000, Number(when)) });
  }

  async function syncSchedule() {
    if (!ownsDailySchedule) {
      await clearUnavailableState();
      return;
    }
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
    const latest = await platform.readSettings();
    if (!latest.satellites.biliDailyLogin.enabled) await clearDisabledState();
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

  function dailySettingsSignature(value) {
    const feature = value?.satellites?.biliDailyLogin;
    return JSON.stringify({
      enabled: feature?.enabled === true,
      lastCompletedDate: String(feature?.lastCompletedDate || '')
    });
  }

  async function clearDisabledState() {
    await chrome.alarms.clear(BILI_DAILY_ALARM);
    await chrome.storage.session.remove(BILI_DAILY_RETRY_KEY);
  }

  async function clearUnavailableState() {
    await chrome.alarms.clear(BILI_DAILY_ALARM);
  }

  async function hasRegularBrowserWindow() {
    if (typeof chrome.windows?.getAll !== 'function') return true;
    try {
      const windows = await chrome.windows.getAll({ windowTypes: ['normal'] });
      return windows.some(window => window.incognito !== true);
    } catch { return false; }
  }

  async function run(signal) {
    const settings = await platform.readSettings();
    const feature = settings.satellites.biliDailyLogin;
    const today = bilibiliDateKey();
    if (!feature.enabled) {
      await clearDisabledState();
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
    if (!await hasRegularBrowserWindow()) {
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
      const account = await requestJson('https://api.bilibili.com/x/web-interface/nav', signal);
      if (account?.code === 0 && account?.data?.isLogin === true) {
        const reward = await requestJson('https://api.bilibili.com/x/member/web/exp/reward', signal);
        completed = reward?.code === 0 && reward?.data?.login === true;
      }
    } catch {}
    const latest = await platform.readSettings();
    if (signal.aborted || !latest.satellites.biliDailyLogin.enabled) {
      await clearDisabledState();
      return;
    }
    if (completed) {
      const saved = await platform.mutateSettings(current => ({
        ...current,
        satellites: {
          ...current.satellites,
          biliDailyLogin: { ...current.satellites.biliDailyLogin, lastCompletedDate: today }
        }
      }), false);
      if (!saved.satellites.biliDailyLogin.enabled) {
        await clearDisabledState();
        return;
      }
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
    const controller = new AbortController();
    runController = controller;
    const current = run(controller.signal).finally(() => {
      if (running === current) running = null;
      if (runController === controller) runController = null;
    });
    running = current;
    return running;
  }

  async function stopRun() {
    runController?.abort();
    if (running) await running.catch(() => {});
  }

  return Object.freeze({
    id: 'satellites',
    async state(settings) {
      if (ownsDailySchedule) return settings.satellites;
      return {
        ...settings.satellites,
        biliDailyLogin: {
          ...settings.satellites.biliDailyLogin,
          enabled: false,
          available: false
        }
      };
    },
    ensureSchedule,
    async handleMessage(message) {
      if (message.type !== 'UI_SET_BILI_DAILY_LOGIN') throw new Error('Satellites does not support this command.');
      if (!ownsDailySchedule) {
        await clearUnavailableState();
        cancelScheduleRepair();
        return { enabled: false, lastCompletedDate: '', available: false };
      }
      const enabled = message.enabled === true;
      const settings = await platform.mutateSettings(current => ({
        ...current,
        satellites: {
          ...current.satellites,
          biliDailyLogin: { ...current.satellites.biliDailyLogin, enabled }
        }
      }), false);
      try {
        if (!enabled) await stopRun();
        await clearDisabledState();
        if (enabled) await ensureSchedule();
        else cancelScheduleRepair();
      } catch { repairSchedule(); }
      return settings.satellites.biliDailyLogin;
    },
    async handleAlarm(alarm) {
      if (alarm.name !== BILI_DAILY_ALARM) return false;
      if (!ownsDailySchedule) {
        await clearUnavailableState();
        return true;
      }
      try { await runOnce(); }
      catch (error) {
        repairSchedule();
        throw error;
      }
      return true;
    },
    async handleStorageChanged(changes, areaName) {
      if (!ownsDailySchedule) return false;
      const change = areaName === 'local' ? changes?.[SETTINGS_KEY] : null;
      if (!change || dailySettingsSignature(change.oldValue) === dailySettingsSignature(change.newValue)) return false;
      try { await ensureSchedule(); }
      catch { repairSchedule(); }
      return true;
    },
    async reset() {
      cancelScheduleRepair();
      await stopRun();
      if (ownsDailySchedule) await clearDisabledState();
      else await clearUnavailableState();
    }
  });
}
