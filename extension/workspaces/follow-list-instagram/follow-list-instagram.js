import { loadLocale } from '../../core/locale.js';
import { instagramProfileUrl, instagramRoute } from '../../core/follow-list-instagram.js';
import { localizeDocument, translator } from '../../shared/localization.js';
import { icon, send } from '../../shared/ui.js';

const $ = selector => document.querySelector(selector);
const sourceParam = new URL(location.href).searchParams.get('sourceTab');
const tabId = /^\d+$/.test(sourceParam || '') ? Number(sourceParam) : -1;
const locale = await loadLocale();
document.documentElement.lang = locale;
const t = translator(locale);
localizeDocument(t);
document.title = t('followListInstagramName');
$('#mark').innerHTML = icon('followListInstagram');
$('#categories').setAttribute('aria-label', t('igCategories'));
let snapshot = null;
let generation = 0;
let loading = false;
let writing = false;
let category = 'notFollowingBack';
let page = 0;
let sourceUsername = '';
let port;
let heartbeat;
let closing = false;
let dismissedRun = '';
let pollingUnfollow = false;
const PAGE_SIZE = 60;
const keys = { notFollowingBack: 'igNotFollowingBack', mutual: 'igMutual', followersOnly: 'igFollowersOnly' };
const details = { notFollowingBack: 'igNotFollowingBackHelp', mutual: 'igMutualHelp', followersOnly: 'igFollowersOnlyHelp' };
const message = (type, extra = {}) => send({ type, featureId: 'followListInstagram', tabId, runId: snapshot?.runId, ...extra });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
function status(key, values = {}, error = false) {
  $('#status').textContent = t(key, values);
  $('#status').dataset.error = String(error);
}
function errorStatus(error) {
  const key = /^ig[A-Z]/.test(error?.message || '') && t(error.message) !== error.message ? error.message : 'igUnavailable';
  status(key, {}, true);
}
function controls() {
  $('#stop').hidden = !loading;
  $('#refresh').disabled = loading || writing;
  $('#clearCurrent').disabled = loading || writing;
  $('#clearAll').disabled = loading || writing;
  $('#results').hidden = snapshot?.status !== 'complete';
  $('#readingProgress').hidden = !snapshot?.profile || (!loading && snapshot?.status !== 'complete');
  for (const kind of ['following', 'followers']) {
    const started = kind === 'following' || snapshot?.phase === 'followers' || snapshot?.status === 'complete';
    const complete = snapshot?.status === 'complete' || (kind === 'following' && snapshot?.phase === 'followers');
    $('#' + kind + 'ProgressRow').hidden = !started;
    const total = snapshot?.profile?.[kind] || 0;
    const read = snapshot?.counts?.[kind] || 0;
    const progress = $('#' + kind + 'Progress');
    progress.max = complete ? 1 : Math.max(1, total);
    progress.value = complete ? 1 : total > 0 ? Math.min(total, read) : 0;
    $('#' + kind + 'Count').textContent = complete ? String(read) : `${read} / ${total}`;
    $('#' + kind + 'Percent').textContent = (complete ? 100
      : total > 0 ? Math.floor(Math.min(1, read / total) * 100) : 0) + '%';
  }
}
function render() {
  controls();
  if (snapshot?.profile) $('#profile').textContent = '@' + snapshot.profile.username;
  if (snapshot?.status !== 'complete') return;
  $('#categories').replaceChildren();
  for (const [key, text] of Object.entries(keys)) {
    const button = document.createElement('button');
    button.type = 'button'; button.setAttribute('aria-pressed', String(key === category));
    button.append(document.createTextNode(t(text)));
    const count = document.createElement('span'); count.textContent = snapshot.groups[key].length;
    button.append(count);
    button.addEventListener('click', () => { category = key; page = 0; render(); });
    $('#categories').append(button);
  }
  $('#explanation').textContent = t(details[category], { username: snapshot.profile.username });
  const search = $('#search').value.trim().toLowerCase();
  const accounts = snapshot.groups[category].filter(account => (account.username + ' ' + account.name).toLowerCase().includes(search));
  const pages = Math.max(1, Math.ceil(accounts.length / PAGE_SIZE));
  page = Math.max(0, Math.min(page, pages - 1));
  $('#accounts').replaceChildren();
  for (const account of accounts.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)) {
    const row = document.createElement('li');
    const link = document.createElement('a');
    link.href = instagramProfileUrl(account.username);
    link.target = '_blank'; link.rel = 'noopener noreferrer';
    const handle = document.createElement('span'); handle.className = 'account-handle';
    const username = document.createElement('strong'); username.textContent = '@' + account.username;
    handle.append(username);
    if (account.verified) {
      const verified = document.createElement('span'); verified.className = 'verified-account';
      verified.setAttribute('aria-hidden', 'true');
      verified.textContent = '✓';
      handle.append(verified);
    }
    link.append(handle);
    const name = document.createElement('small'); name.className = 'account-name';
    name.textContent = account.name || '';
    link.append(name);
    row.append(link);
    if (snapshot.ownProfile && category === 'notFollowingBack') {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'danger';
      const unfollowed = snapshot.unfollowedIds?.includes(account.id) === true;
      const pending = snapshot.pendingUnfollowId === account.id;
      button.textContent = t(unfollowed ? 'igUnfollowedAction' : 'igUnfollow');
      button.disabled = unfollowed || pending;
      button.setAttribute('aria-disabled', String(writing || button.disabled));
      button.setAttribute('aria-label', t('igUnfollowAccount', { username: account.username }));
      button.addEventListener('click', async () => {
        if (writing || button.disabled) return;
        writing = true;
        const ticket = generation;
        render(); status('igOpeningUnfollowConfirmation', { username: account.username });
        try {
          const result = await message('UI_IG_OPEN_UNFOLLOW_CONFIRMATION', { targetId: account.id });
          if (ticket !== generation) return;
          snapshot = result.state;
          if (result.result === 'unfollowed') status('igUnfollowVerified', { username: account.username });
          else {
            status('igConfirmOnInstagram', { username: account.username });
            void pollUnfollowConfirmation();
          }
        } catch (error) {
          if (ticket === generation) errorStatus(error);
        } finally { writing = false; if (ticket === generation) render(); }
      });
      row.append(button);
    }
    $('#accounts').append(row);
  }
  $('#empty').hidden = accounts.length !== 0;
  $('#pagination').hidden = pages <= 1;
  $('#page').textContent = `${page + 1} / ${pages}`;
  $('#previous').disabled = page === 0;
  $('#next').disabled = page + 1 === pages;
}
function accountFor(id) {
  if (!id || !snapshot?.groups) return null;
  for (const accounts of Object.values(snapshot.groups)) {
    const account = accounts.find(value => value.id === id);
    if (account) return account;
  }
  return null;
}
async function pollUnfollowConfirmation() {
  if (pollingUnfollow || !snapshot?.pendingUnfollowId) return;
  pollingUnfollow = true;
  const ticket = generation;
  try {
    while (ticket === generation && snapshot?.pendingUnfollowId) {
      const targetId = snapshot.pendingUnfollowId;
      const account = accountFor(targetId);
      await pause(1000);
      if (ticket !== generation || snapshot?.pendingUnfollowId !== targetId) break;
      const result = await message('UI_IG_CHECK_UNFOLLOW_CONFIRMATION', { targetId });
      if (ticket !== generation) break;
      snapshot = result.state;
      render();
      if (result.result === 'waiting') status('igConfirmOnInstagram', { username: account?.username || targetId });
      else if (result.result === 'unfollowed') status('igUnfollowVerified', { username: account?.username || targetId });
      else status('igUnfollowUnchanged', { username: account?.username || targetId });
    }
  } catch (error) {
    if (ticket === generation) errorStatus(error);
  } finally {
    pollingUnfollow = false;
    if (ticket === generation) render();
  }
}
function receive(value) {
  if (!value || value.runId === dismissedRun || (snapshot?.runId === value.runId && snapshot.revision > value.revision)) return;
  snapshot = value;
  loading = value.status === 'loading';
  if (loading) status('igProgress');
  else if (value.status === 'complete' && value.pendingUnfollowId) {
    status('igConfirmOnInstagram', { username: accountFor(value.pendingUnfollowId)?.username || value.pendingUnfollowId });
  }
  else if (value.status === 'complete') status('igComplete');
  else if (value.status === 'error') errorStatus(new Error(value.error));
  else status('igStopped');
  render();
  if (!writing && !attaching && value.pendingUnfollowId) void pollUnfollowConfirmation();
}
let attaching = false;
async function begin(restart = true) {
  if (loading || writing || attaching) return;
  const ticket = ++generation;
  snapshot = null; page = 0;
  dismissedRun = '';
  loading = true; attaching = true; render(); status('igReadingProfile');
  try {
    const tab = await chrome.tabs.get(tabId);
    const route = instagramRoute(tab.url);
    sourceUsername = route.username;
    if (!route.supported || !sourceUsername) throw new Error('igProfileOnly');
    $('#profile').textContent = '@' + sourceUsername;
    const result = await message(restart ? 'UI_IG_BEGIN' : 'UI_IG_ATTACH');
    if (ticket === generation) receive(result);
  } catch (error) { if (ticket === generation) { loading = false; errorStatus(error); render(); } }
  finally {
    attaching = false;
    if (ticket === generation && snapshot?.pendingUnfollowId) void pollUnfollowConfirmation();
  }
}
function stop(key = 'igStopped', notify = true) {
  generation += 1; loading = false;
  const runId = snapshot?.runId;
  dismissedRun = runId || '';
  snapshot = null;
  status(key); render();
  if (notify) void message('UI_IG_STOP', { runId }).catch(() => {});
}
async function clearResults(type, key) {
  if (loading || writing || snapshot?.status !== 'complete') return;
  const ticket = ++generation;
  writing = true; render();
  try {
    await message(type);
    if (ticket !== generation) return;
    snapshot = null; page = 0; dismissedRun = '';
    status(key);
  } catch (error) { if (ticket === generation) errorStatus(error); }
  finally { writing = false; if (ticket === generation) render(); }
}
$('#refresh').addEventListener('click', () => void begin());
$('#stop').addEventListener('click', () => stop());
$('#clearCurrent').addEventListener('click', () => void clearResults('UI_IG_CLEAR_CURRENT', 'igClearedCurrent'));
$('#clearAll').addEventListener('click', () => void clearResults('UI_IG_CLEAR_ALL', 'igClearedAll'));
$('#search').addEventListener('input', () => { page = 0; render(); });
$('#previous').addEventListener('click', () => { page -= 1; render(); });
$('#next').addEventListener('click', () => { page += 1; render(); });
chrome.tabs.onUpdated.addListener((id, change) => {
  if (id === tabId && (change.status === 'loading' || (change.url && instagramRoute(change.url).username !== sourceUsername))) stop('igPageChanged');
});
chrome.tabs.onRemoved.addListener(id => { if (id === tabId) { stop('igPageChanged'); $('#refresh').disabled = true; } });
try {
  port = chrome.runtime.connect({ name: `follow-list-instagram:${tabId}` });
  heartbeat = setInterval(() => { try { port.postMessage({ type: 'keepalive' }); } catch { clearInterval(heartbeat); } }, 20000);
  port.onMessage.addListener(message => { if (!attaching && message.snapshot) receive(message.snapshot); });
  port.onDisconnect.addListener(() => {
    clearInterval(heartbeat);
    if (!closing) { stop('igSessionEnded', false); $('#refresh').disabled = true; }
  });
  addEventListener('pagehide', () => { closing = true; clearInterval(heartbeat); port.disconnect(); }, { once: true });
  await begin(false);
} catch (error) { loading = false; controls(); errorStatus(error); }
