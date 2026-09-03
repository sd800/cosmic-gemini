import {
  BILI_DAILY_ALARM,
  BILI_DAILY_ATTEMPT_KEY,
  BILI_DAILY_DEFER_MS,
  bilibiliDateKey,
  browserReportsOffline,
  nextBilibiliPlan
} from '../../../core/bili-daily-login.js';
import { SETTINGS_KEY } from '../../../core/config.js';

const BILI_DAILY_HEADER_RULE_ID = 800_001;
const BILI_DAILY_REQUEST_TIMEOUT_MS = 30_000;

export function createSatellitesProduct(platform) {
  const ownsDailySchedule = chrome.extension?.inIncognitoContext !== true;
  let running = null;
  let runController = null;
  let scheduleRepair = null;
  let scheduleRepairAttempts = 0;
  let requestHeadersActive = false;

  async function requestJson(url, signal) {
    const controller = new AbortController();
    const abort = () => controller.abort();
    const timeout = setTimeout(abort, BILI_DAILY_REQUEST_TIMEOUT_MS);
    signal.addEventListener('abort', abort, { once: true });
    try {
      const response = await fetch(url, {
        cache: 'no-store',
        credentials: 'include',
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
          From: 'COSMIC_GEMINI'
        }
      });
      if (!response.ok) throw new Error('Bilibili request failed.');
      return response.json();
    } finally {
      clearTimeout(timeout);
      signal.removeEventListener('abort', abort);
    }
  }

  async function removeRequestHeaderRule() {
    if (!chrome.declarativeNetRequest?.updateSessionRules) return;
    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: [BILI_DAILY_HEADER_RULE_ID]
    }).catch(() => {});
  }

  async function withRequestHeaders(task) {
    if (!chrome.declarativeNetRequest?.updateSessionRules || !chrome.runtime?.id) return task();
    await removeRequestHeaderRule();
    try {
      await chrome.declarativeNetRequest.updateSessionRules({
        addRules: [{
          id: BILI_DAILY_HEADER_RULE_ID,
          priority: 100,
          action: {
            type: 'modifyHeaders',
            requestHeaders: [
              { operation: 'set', header: 'Origin', value: 'https://www.bilibili.com' },
              { operation: 'set', header: 'Referer', value: 'https://www.bilibili.com/' }
            ]
          },
          condition: {
            initiatorDomains: [chrome.runtime.id],
            requestDomains: ['api.bilibili.com'],
            regexFilter: '^https://api\\.bilibili\\.com/x/(web-interface/nav|member/web/exp/reward)(?:\\?.*)?$',
            resourceTypes: ['xmlhttprequest']
          }
        }]
      });
      requestHeadersActive = true;
    } catch {
      return task();
    }
    try { return await task(); }
    finally {
      await removeRequestHeaderRule();
      requestHeadersActive = false;
    }
  }

  async function lastAttemptSlot() {
    return String((await chrome.storage.local.get(BILI_DAILY_ATTEMPT_KEY))[BILI_DAILY_ATTEMPT_KEY] || '');
  }

  async function schedule(when) {
    await chrome.alarms.create(BILI_DAILY_ALARM, { when: Math.max(Date.now() + 1_000, Number(when)) });
  }

  async function scheduleNext() {
    const plan = nextBilibiliPlan(Date.now(), await lastAttemptSlot());
    await schedule(plan.due ? Date.now() + 1_000 : plan.when);
  }

  async function syncSchedule() {
    if (!ownsDailySchedule) {
      await clearUnavailableState();
      return;
    }
    const settings = await platform.readSettings();
    const feature = settings.satellites.biliDailyLogin;
    if (!feature.enabled) {
      await clearDisabledState();
      return;
    }
    const existing = await chrome.alarms.get(BILI_DAILY_ALARM);
    if (existing?.scheduledTime > Date.now()) return;
    await scheduleNext();
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
    if (!requestHeadersActive) await removeRequestHeaderRule();
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
    await Promise.allSettled([
      chrome.storage.local.remove(BILI_DAILY_ATTEMPT_KEY),
      removeRequestHeaderRule()
    ]);
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

  async function deferUnavailableAttempt() {
    const nextPlan = nextBilibiliPlan(Date.now(), await lastAttemptSlot());
    await schedule(nextPlan.due
      ? Date.now() + BILI_DAILY_DEFER_MS
      : Math.min(Date.now() + BILI_DAILY_DEFER_MS, nextPlan.when));
  }

  async function run(signal) {
    const settings = await platform.readSettings();
    const feature = settings.satellites.biliDailyLogin;
    if (!feature.enabled) {
      await clearDisabledState();
      return;
    }

    const plan = nextBilibiliPlan(Date.now(), await lastAttemptSlot());
    if (!plan.due) {
      await schedule(plan.when);
      return;
    }
    if (browserReportsOffline() || !await hasRegularBrowserWindow()) {
      await deferUnavailableAttempt();
      return;
    }

    const today = bilibiliDateKey();
    let completed = false;
    try {
      await withRequestHeaders(async () => {
        const account = await requestJson('https://api.bilibili.com/x/web-interface/nav', signal);
        if (account?.code === 0 && account?.data?.isLogin === true) {
          const reward = await requestJson('https://api.bilibili.com/x/member/web/exp/reward', signal);
          completed = reward?.code === 0 && reward?.data?.login === true;
        }
      });
    } catch {}
    const latest = await platform.readSettings();
    if (signal.aborted || !latest.satellites.biliDailyLogin.enabled) {
      await clearDisabledState();
      return;
    }
    await chrome.storage.local.set({ [BILI_DAILY_ATTEMPT_KEY]: plan.id });
    if (completed && latest.satellites.biliDailyLogin.lastCompletedDate !== today) {
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
    }
    await scheduleNext();
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
