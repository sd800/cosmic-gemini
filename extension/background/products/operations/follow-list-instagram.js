import { FEATURE_IDS } from '../../../core/config.js';
import { INSTAGRAM_PANEL_PATH, instagramRoute, compareInstagramLists } from '../../../core/follow-list-instagram.js';
import { instagramDomRead } from '../../../content/follow-list-instagram-dom.js';

const PANEL = INSTAGRAM_PANEL_PATH;
const MAX_ACCOUNTS = 20000;
const REQUEST_GAP = 2000;
const MAX_INCOMPLETE_RETRIES = 2;
const CACHE_VERSION = 1;
const CACHE_PREFIX = 'followListInstagram:result:';
const CACHE_INDEX = 'followListInstagram:resultIndex';
const MAX_CACHED_RESULTS = 8;

export function createFollowListInstagramProduct(platform) {
  const sessions = new Map();
  const busyTabs = new Set();
  const ports = new Map();
  const pendingStarts = new Map();
  let cacheWrites = Promise.resolve();

  const cacheKey = username => CACHE_PREFIX + String(username || '').toLowerCase();
  const validAccount = account => account && typeof account.id === 'string' && account.id
    && typeof account.username === 'string' && /^[a-zA-Z0-9._]{1,30}$/.test(account.username)
    && typeof account.name === 'string';

  function queueCacheWrite(task) {
    const next = cacheWrites.catch(() => {}).then(task);
    cacheWrites = next.catch(() => {});
    return next;
  }

  async function readCachedResult(username, profile) {
    try {
      const value = (await chrome.storage.session.get(cacheKey(username)))[cacheKey(username)];
      if (value?.version !== CACHE_VERSION || value.username !== username
        || value.followingCount !== profile.following || value.followersCount !== profile.followers
        || !Array.isArray(value.following) || !Array.isArray(value.followers)
        || value.following.length !== profile.following || value.followers.length !== profile.followers
        || !value.following.every(validAccount) || !value.followers.every(validAccount)) return null;
      const following = new Map(value.following.map(account => [account.id, account]));
      const followers = new Map(value.followers.map(account => [account.id, account]));
      if (following.size !== profile.following || followers.size !== profile.followers) return null;
      return { following, followers };
    } catch { return null; }
  }

  async function writeCachedResult(session) {
    if (session.status !== 'complete' || !session.profile) return;
    const username = session.username;
    const key = cacheKey(username);
    await queueCacheWrite(async () => {
      try {
        const stored = await chrome.storage.session.get(CACHE_INDEX);
        const previous = Array.isArray(stored[CACHE_INDEX]) ? stored[CACHE_INDEX] : [];
        const index = [username, ...previous.filter(value => value !== username)].slice(0, MAX_CACHED_RESULTS);
        const evicted = previous.filter(value => !index.includes(value)).map(cacheKey);
        await chrome.storage.session.set({
          [key]: {
            version: CACHE_VERSION, username,
            followingCount: session.following.size, followersCount: session.followers.size,
            following: [...session.following.values()], followers: [...session.followers.values()],
            completedAt: Date.now()
          },
          [CACHE_INDEX]: index
        });
        if (evicted.length) await chrome.storage.session.remove(evicted);
      } catch {}
    });
  }

  async function clearCachedResult(username) {
    await queueCacheWrite(async () => {
      try {
        const stored = await chrome.storage.session.get(CACHE_INDEX);
        const previous = Array.isArray(stored[CACHE_INDEX]) ? stored[CACHE_INDEX] : [];
        const index = previous.filter(value => value !== username);
        await chrome.storage.session.remove(cacheKey(username));
        if (index.length) await chrome.storage.session.set({ [CACHE_INDEX]: index });
        else await chrome.storage.session.remove(CACHE_INDEX);
      } catch {}
    });
  }

  async function clearAllCachedResults() {
    await queueCacheWrite(async () => {
      try {
        const stored = await chrome.storage.session.get(null);
        const keys = Object.keys(stored).filter(key => key === CACHE_INDEX || key.startsWith(CACHE_PREFIX));
        if (keys.length) await chrome.storage.session.remove(keys);
      } catch {}
    });
  }

  async function clearReader(session) {
    await chrome.scripting.executeScript({ target: { tabId: session.tabId, frameIds: [0] }, world: 'ISOLATED',
      func: instagramDomRead, args: [{ operation: 'cancel', runId: session.runId }] }).catch(() => {});
  }

  async function source(tabId, username) {
    if (!Number.isInteger(tabId)) throw new Error('igPageChanged');
    const tab = await chrome.tabs.get(tabId);
    const route = instagramRoute(tab.url || '');
    if (Boolean(tab.incognito) !== (platform.isIncognitoContext?.() === true)) throw new Error('igPageChanged');
    if (!route.supported || !route.username) throw new Error('igProfileOnly');
    if (username && username !== route.username) throw new Error('igPageChanged');
    return route;
  }

  function snapshot(session) {
    return {
      runId: session.runId, revision: session.revision, profile: session.profile, status: session.status,
      error: session.error || '', ownProfile: session.ownerId === session.profile?.id,
      counts: { following: session.following.size, followers: session.followers.size },
      phase: session.phase,
      groups: session.status === 'complete'
        ? compareInstagramLists([...session.following.values()], [...session.followers.values()]) : null
    };
  }

  async function request(session, input) {
    await source(session.tabId, session.username);
    if (sessions.get(session.tabId) !== session || session.stopped) throw new Error('igStopped');
    const remaining = session.lastRequest + REQUEST_GAP - Date.now();
    if (remaining > 0) await new Promise(resolve => setTimeout(resolve, remaining));
    if (sessions.get(session.tabId) !== session || session.stopped) throw new Error('igStopped');
    session.lastRequest = Date.now();
    const [entry] = await chrome.scripting.executeScript({
      target: { tabId: session.tabId, frameIds: [0] }, world: 'ISOLATED',
      func: instagramDomRead,
      args: [{ ...input, runId: session.runId, username: session.username }]
    });
    if (sessions.get(session.tabId) !== session || session.stopped) throw new Error('igStopped');
    await source(session.tabId, session.username);
    if (!entry?.result) throw new Error('igUnavailable');
    if (entry.result.error) throw new Error(entry.result.error);
    return entry.result;
  }

  async function stop(tabId, remove = false, cancelStart = true) {
    if (cancelStart && pendingStarts.has(tabId)) pendingStarts.get(tabId).cancelled = true;
    const session = sessions.get(tabId);
    if (!session) return { stopped: true };
    session.stopped = true;
    if (session.status !== 'complete') session.status = 'stopped';
    publish(session);
    if (remove) sessions.delete(tabId);
    await clearReader(session);
    return snapshot(session);
  }

  async function begin(tabId, reuseCache = false) {
    const pending = { cancelled: false };
    pendingStarts.set(tabId, pending);
    try {
      const route = await source(tabId);
      if (pending.cancelled) throw new Error('igStopped');
      await stop(tabId, true, false);
      // Active reads stay tab-bound. Only fully validated results enter session storage.
      if (sessions.size >= 8) await stop(sessions.keys().next().value, true);
      if (pending.cancelled) throw new Error('igStopped');
      const session = { tabId, username: route.username, runId: crypto.randomUUID(),
        revision: 0, status: 'loading', phase: 'following', following: new Map(), followers: new Map(),
        lastRequest: 0, stopped: false, pages: 0, incompleteRetries: 0 };
      sessions.set(tabId, session);
      try {
        const result = await request(session, { operation: 'profile' });
        session.profile = result.profile;
        session.ownerId = result.ownProfile === true ? result.profile.id : '';
        if (session.profile?.username !== route.username) throw new Error('igPageChanged');
        if (![session.profile.followers, session.profile.following].every(value => Number.isSafeInteger(value) && value >= 0)) throw new Error('igIncomplete');
        if (Math.max(session.profile.followers, session.profile.following) > MAX_ACCOUNTS) throw new Error('igTooLarge');
        if (reuseCache) {
          const cached = await readCachedResult(route.username, session.profile);
          if (cached) {
            session.following = cached.following;
            session.followers = cached.followers;
            session.phase = 'followers';
            session.status = 'complete';
          }
        }
      } catch (error) {
        session.status = 'error';
        session.error = error.message;
      }
      session.revision += 1;
      if (session.status === 'loading') void pump(session);
      else await clearReader(session);
      return snapshot(session);
    } finally {
      if (pendingStarts.get(tabId) === pending) pendingStarts.delete(tabId);
    }
  }

  async function recoverIncomplete(session) {
    if (session.incompleteRetries >= MAX_INCOMPLETE_RETRIES) return false;
    session.incompleteRetries += 1;
    await clearReader(session);
    const result = await request(session, { operation: 'profile' });
    const fresh = result.profile;
    if (fresh?.id !== session.profile?.id || fresh.username !== session.username
      || ![fresh.followers, fresh.following].every(value => Number.isSafeInteger(value) && value >= 0)) return false;
    if (Math.max(fresh.followers, fresh.following) > MAX_ACCOUNTS) throw new Error('igTooLarge');
    session.profile = fresh;
    session.ownerId = result.ownProfile === true ? fresh.id : '';
    session.following.clear();
    session.followers.clear();
    session.phase = 'following';
    session.pages = 0;
    session.error = '';
    return true;
  }

  async function next(session) {
    if (session.status !== 'loading') return snapshot(session);
    try {
      const kind = session.phase;
      const result = await request(session, { operation: 'list', kind, expected: session.profile[kind] });
      if (!Array.isArray(result.users) || typeof result.done !== 'boolean') throw new Error('igIncomplete');
      const list = session[kind];
      for (const account of result.users) list.set(account.id, account);
      session.pages += 1;
      if (list.size > MAX_ACCOUNTS || session.pages > 5000) throw new Error('igTooLarge');
      if (result.done) {
        if (list.size !== session.profile[kind]) throw new Error('igIncomplete');
        if (kind === 'following') {
          session.phase = 'followers';
        } else {
          const freshResult = await request(session, { operation: 'profile' });
          const fresh = freshResult.profile;
          session.ownerId = freshResult.ownProfile === true ? fresh.id : '';
          if (fresh.id !== session.profile.id || fresh.followers !== session.followers.size
            || fresh.following !== session.following.size) throw new Error('igIncomplete');
          session.status = 'complete';
          await writeCachedResult(session);
        }
      }
    } catch (error) {
      if (!session.stopped && error.message === 'igIncomplete') {
        try {
          if (await recoverIncomplete(session)) return snapshot(session);
        } catch (recoveryError) { error = recoveryError; }
      }
      session.status = session.stopped ? 'stopped' : 'error';
      session.error = session.stopped ? '' : error.message;
    }
    return snapshot(session);
  }

  function publish(session) {
    if (sessions.get(session.tabId) !== session) return;
    session.revision += 1;
    try { ports.get(session.tabId)?.postMessage({ snapshot: snapshot(session) }); } catch {}
  }

  async function pump(session) {
    while (sessions.get(session.tabId) === session && !session.stopped && session.status === 'loading') {
      await next(session);
      publish(session);
    }
    await clearReader(session);
  }

  return Object.freeze({
    id: FEATURE_IDS.FOLLOW_LIST_INSTAGRAM,
    state(_settings, url) { return { ...instagramRoute(url), active: false }; },
    async handleMessage(message, context) {
      const sender = new URL(context.sender.url);
      const panelSender = sender.pathname === '/' + PANEL;
      if (!context.sender.url.startsWith(chrome.runtime.getURL('')) || !panelSender) throw new Error('igUnavailable');
      const tabId = message.tabId;
      if (panelSender && sender.searchParams.get('sourceTab') !== String(tabId)) throw new Error('igPageChanged');
      if (message.type === 'UI_IG_STOP') {
        if (message.runId && sessions.get(tabId)?.runId !== message.runId) return { stopped: true };
        return stop(tabId);
      }
      if (busyTabs.has(tabId)) throw new Error('igBusy');
      busyTabs.add(tabId);
      try {
        if (message.type === 'UI_IG_BEGIN') return await begin(tabId, false);
        if (message.type === 'UI_IG_ATTACH') {
          const existing = sessions.get(tabId);
          if (existing) { await source(tabId, existing.username); return snapshot(existing); }
          return await begin(tabId, true);
        }
        const session = sessions.get(tabId);
        if (!session || session.runId !== message.runId) throw new Error('igSessionEnded');
        await source(tabId, session.username);
        if (message.type === 'UI_IG_STATE') return snapshot(session);
        if (message.type === 'UI_IG_CLEAR_CURRENT') {
          if (session.status !== 'complete') throw new Error('igSessionEnded');
          await clearCachedResult(session.username);
          await stop(tabId, true);
          return { cleared: true };
        }
        if (message.type === 'UI_IG_CLEAR_ALL') {
          await Promise.allSettled([...sessions.keys()].map(id => stop(id, true)));
          await clearAllCachedResults();
          return { cleared: true };
        }
        if (message.type === 'UI_IG_UNFOLLOW') {
          if (session.status !== 'complete' || session.stopped || session.ownerId !== session.profile.id
            || message.confirmed !== true) throw new Error('igOwnProfileOnly');
          const target = session.following.get(String(message.targetId));
          if (!target || session.followers.has(target.id)) throw new Error('igRelationshipChanged');
          let result;
          if (session.uncertain?.has(target.id)) throw new Error('igUnfollowUncertain');
          try {
            result = await request(session, { operation: 'unfollow', targetUsername: target.username, confirmed: true });
          } catch (error) {
            if (error.message === 'igUnfollowUncertain') (session.uncertain ||= new Set()).add(target.id);
            throw error;
          }
          if (result.unfollowed !== true) throw new Error('igUnfollowUncertain');
          session.following.delete(target.id);
          session.profile.following = session.following.size;
          void writeCachedResult(session);
          publish(session);
          return snapshot(session);
        }
        throw new Error('igUnavailable');
      } finally { busyTabs.delete(tabId); }
    },
    connect(port) {
      if (!port.name.startsWith('follow-list-instagram:')) return false;
      const tabId = Number(port.name.split(':')[1]);
      const sender = new URL(port.sender?.url || chrome.runtime.getURL(''));
      if (sender.pathname !== '/' + PANEL || sender.searchParams.get('sourceTab') !== String(tabId)) { port.disconnect(); return true; }
      ports.set(tabId, port);
      port.onMessage.addListener(() => {});
      port.onDisconnect.addListener(() => {
        if (ports.get(tabId) !== port) return;
        ports.delete(tabId);
      });
      return true;
    },
    handleTabUpdated(tabId, change) {
      const session = sessions.get(tabId);
      if (pendingStarts.has(tabId) && (change.status === 'loading' || change.url)) pendingStarts.get(tabId).cancelled = true;
      if (session && (change.status === 'loading' || (change.url && instagramRoute(change.url).username !== session.username))) return stop(tabId, true);
    },
    removeTab(tabId) { return stop(tabId, true); },
    async reset() {
      for (const pending of pendingStarts.values()) pending.cancelled = true;
      await Promise.allSettled([...sessions.keys()].map(tabId => stop(tabId, true)));
      await clearAllCachedResults();
    }
  });
}
