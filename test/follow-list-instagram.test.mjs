import assert from 'node:assert/strict';
import test from 'node:test';
import { instagramProfileUrl, instagramRoute, compareInstagramLists } from '../extension/core/follow-list-instagram.js';
import { instagramDomRead } from '../extension/content/follow-list-instagram-dom.js';
import { createFollowListInstagramProduct } from '../extension/background/products/operations/follow-list-instagram.js';

const account = (id, verified = false) => ({ id: `account_${id}`, username: `account_${id}`, name: `名称 ${id}`,
  verified });
const profile = (following = 2, followers = 2, ownProfile = true) => ({ profile: { id: 'example', username: 'example', following, followers }, ownProfile });
const base = 'chrome-extension://test/';
const panel = base + 'workspaces/follow-list-instagram/follow-list-instagram.html?sourceTab=7';
const turns = async () => { for (let i = 0; i < 150; i++) await Promise.resolve(); };
async function readDomUntilDone(input, env, limit = 30) {
  const users = new Map();
  for (let attempt = 0; attempt < limit; attempt += 1) {
    const result = await instagramDomRead(input, env);
    if (result.error) return result;
    for (const account of result.users) users.set(account.id, account);
    if (result.done) return { ...result, users: [...users.values()] };
  }
  assert.fail('Instagram DOM reader did not reach a stable bottom');
}
function harness(replies, sessionStore = new Map()) {
  let url = 'https://www.instagram.com/example/';
  const calls = []; let now = 0; const originalNow = Date.now;
  Date.now = () => (now += 5000);
  globalThis.chrome = {
    runtime: { getURL: path => base + path },
    tabs: { get: async () => ({ id: 7, url, incognito: false }) },
    storage: { session: {
      async get(keys) {
        if (keys === null) return Object.fromEntries(sessionStore);
        const wanted = Array.isArray(keys) ? keys : [keys];
        return Object.fromEntries(wanted.filter(key => sessionStore.has(key)).map(key => [key, sessionStore.get(key)]));
      },
      async set(values) { for (const [key, value] of Object.entries(values)) sessionStore.set(key, structuredClone(value)); },
      async remove(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) sessionStore.delete(key); }
    } },
    scripting: { executeScript: async options => {
      const input = options.args[0]; calls.push(input);
      if (input.operation === 'cancel') return [{ result: { ok: true } }];
      const reply = replies.shift(); assert.notEqual(reply, undefined, `Unexpected ${input.operation}`);
      return [{ result: typeof reply === 'function' ? await reply(input) : reply }];
    } }
  };
  const product = createFollowListInstagramProduct({ isIncognitoContext: () => false });
  const send = (type, extra = {}, sender = panel) => product.handleMessage({ type, tabId: 7, ...extra }, { sender: { url: sender } });
  return { product, send, calls, sessionStore, navigate: value => { url = value; }, cleanup: () => { Date.now = originalNow; } };
}
const completeReplies = own => [profile(2, 2, own), { users: [account(2)], done: false }, { users: [account(2), account(3)], done: true }, { users: [account(3), account(4)], done: true }, profile(2, 2, own)];

test('Instagram profile routing ignores interface language and rejects unrelated routes and lookalike hosts', () => {
  for (const value of ['https://www.instagram.com/Example/?hl=zh-cn', 'https://instagram.com/example/tagged/', 'https://www.instagram.com/example/reels/']) assert.equal(instagramRoute(value).username, 'example');
  for (const path of ['', 'p/ABC/', 'reel/ABC/', 'direct/inbox/', 'accounts/', 'example/p/ABC/']) assert.equal(instagramRoute('https://www.instagram.com/' + path).username, '');
  for (const value of ['https://instagram.com.evil.test/example/', 'http://instagram.com/example/', 'https://api.instagram.com/example/', 'invalid']) assert.equal(instagramRoute(value).supported, false);
});

test('Instagram profile links are derived only from validated handlers', () => {
  assert.equal(instagramProfileUrl('Visible.Handler_1'), 'https://www.instagram.com/Visible.Handler_1/');
  for (const value of ['', 'accounts', 'name/other', 'name?query', 'name Verified']) {
    assert.equal(instagramProfileUrl(value), '');
  }
});

test('Instagram comparison deduplicates accounts and separates all three relationship groups', () => {
  const groups = compareInstagramLists([account(2, true), account(5), account(2, true), account(6, true), account(3)],
    [account(3), account(4)]);
  assert.deepEqual(Object.fromEntries(Object.entries(groups).map(([key, list]) => [key, list.map(a => a.id)])), {
    notFollowingBack: ['account_5', 'account_2', 'account_6'], mutual: ['account_3'], followersOnly: ['account_4']
  });
});

test('Instagram background analysis reads complete lists and only allows confirmed own-profile non-mutual unfollows', async () => {
  const h = harness([...completeReplies(true), { unfollowed: true }]);
  try {
    const initial = await h.send('UI_IG_ATTACH'); assert.equal(initial.groups, null);
    await turns();
    let state = await h.send('UI_IG_STATE', { runId: initial.runId });
    assert.equal(state.status, 'complete'); assert.equal(state.ownProfile, true);
    assert.equal(state.groups.mutual[0].id, 'account_3');
    await assert.rejects(h.send('UI_IG_UNFOLLOW', { runId: state.runId, targetId: 'account_2' }), /igOwnProfileOnly/);
    await assert.rejects(h.send('UI_IG_UNFOLLOW', { runId: state.runId, targetId: 'account_3', confirmed: true }), /igRelationshipChanged/);
    state = await h.send('UI_IG_UNFOLLOW', { runId: state.runId, targetId: 'account_2', confirmed: true });
    assert.equal(state.groups.notFollowingBack.length, 0);
    const writes = h.calls.filter(c => c.operation === 'unfollow');
    assert.equal(writes.length, 1);
    assert.equal(writes[0].targetUsername, 'account_2');
    assert.equal('targetHref' in writes[0], false, 'the stored account link is not reused as account identity');
  } finally { h.cleanup(); }
});

test('Instagram accepts stable list completion when the displayed profile counts lag', async () => {
  const h = harness([profile(2, 2), { users: [account(2)], done: true },
    { users: [account(3)], done: true }, profile(2, 2)]);
  try {
    const initial = await h.send('UI_IG_ATTACH'); await turns();
    const state = await h.send('UI_IG_STATE', { runId: initial.runId });
    assert.equal(state.status, 'complete');
    assert.deepEqual(state.counts, { following: 1, followers: 1 });
    assert.equal(h.calls.filter(call => call.operation === 'list').length, 2);
    const cached = [...h.sessionStore.entries()].find(([key]) => key.startsWith('followListInstagram:result:'))?.[1];
    assert.equal(cached.profileFollowingCount, 2);
    assert.equal(cached.followingCount, 1);
  } finally { h.cleanup(); }
});

test('Instagram retries an incomplete DOM read but never exposes a partial comparison', async () => {
  const recovered = harness([profile(), { error: 'igIncomplete' }, profile(),
    { users: [account(2), account(3)], done: true }, { users: [account(3), account(4)], done: true }, profile()]);
  try {
    const initial = await recovered.send('UI_IG_ATTACH'); await turns();
    const state = await recovered.send('UI_IG_STATE', { runId: initial.runId });
    assert.equal(state.status, 'complete');
    assert.equal(recovered.calls.filter(call => call.operation === 'list').length, 3);
  } finally { recovered.cleanup(); }

  const incomplete = harness([profile(), { error: 'igIncomplete' }, profile(),
    { error: 'igIncomplete' }, profile(), { error: 'igIncomplete' }]);
  try {
    const initial = await incomplete.send('UI_IG_ATTACH'); await turns();
    const state = await incomplete.send('UI_IG_STATE', { runId: initial.runId });
    assert.equal(state.status, 'error'); assert.equal(state.groups, null); assert.equal(state.error, 'igIncomplete');
    assert.equal(incomplete.calls.filter(call => call.operation === 'list').length, 3);
  } finally { incomplete.cleanup(); }

  const denied = harness([profile(), { error: 'igAccessDenied' }]);
  try {
    const initial = await denied.send('UI_IG_ATTACH'); await turns();
    const state = await denied.send('UI_IG_STATE', { runId: initial.runId });
    assert.equal(state.status, 'error'); assert.equal(state.groups, null); assert.equal(state.error, 'igAccessDenied');
    assert.equal(denied.calls.filter(call => call.operation === 'list').length, 1);
  } finally { denied.cleanup(); }
});

test('Instagram restores validated complete results for the browser session and supports scoped clearing', async () => {
  const replies = [...completeReplies(false), profile(2, 2, true)];
  const h = harness(replies);
  try {
    const initial = await h.send('UI_IG_ATTACH'); await turns();
    let state = await h.send('UI_IG_STATE', { runId: initial.runId });
    assert.equal(state.status, 'complete');
    assert.equal([...h.sessionStore.keys()].some(key => key.startsWith('followListInstagram:result:')), true);
    h.navigate('https://www.instagram.com/another/');
    await h.product.handleTabUpdated(7, { url: 'https://www.instagram.com/another/' });
    h.navigate('https://www.instagram.com/example/');
    state = await h.send('UI_IG_ATTACH');
    assert.equal(state.status, 'complete');
    assert.equal(state.ownProfile, true, 'own-profile authority is freshly checked instead of restored from cache');
    assert.equal(h.calls.filter(call => call.operation === 'list').length, 3, 'restoring does not reread either list');
    assert.deepEqual(await h.send('UI_IG_CLEAR_CURRENT', { runId: state.runId }), { cleared: true });
    assert.equal([...h.sessionStore.keys()].some(key => key.startsWith('followListInstagram:result:')), false);
  } finally { h.cleanup(); }
});

test('Instagram can clear every completed browser-session result without touching other session data', async () => {
  const h = harness(completeReplies(false));
  try {
    const initial = await h.send('UI_IG_ATTACH'); await turns();
    const state = await h.send('UI_IG_STATE', { runId: initial.runId });
    h.sessionStore.set('followListInstagram:result:another', { version: 1 });
    h.sessionStore.set('unrelated', { keep: true });
    assert.deepEqual(await h.send('UI_IG_CLEAR_ALL', { runId: state.runId }), { cleared: true });
    assert.equal([...h.sessionStore.keys()].some(key => key.startsWith('followListInstagram:result')), false);
    assert.deepEqual(h.sessionStore.get('unrelated'), { keep: true });
    await assert.rejects(h.send('UI_IG_STATE', { runId: state.runId }), /igSessionEnded/);
  } finally { h.cleanup(); }
});

test('Instagram panel closure leaves reading active and reopening attaches to the same run', async () => {
  let resolve, disconnected;
  const h = harness([profile(), () => new Promise(done => { resolve = done; }), { users: [account(3), account(4)], done: true }, profile()]);
  try {
    const port = { name: 'follow-list-instagram:7', sender: { url: panel }, onMessage: { addListener() {} }, onDisconnect: { addListener(fn) { disconnected = fn; } }, postMessage() {} };
    h.product.connect(port);
    const initial = await h.send('UI_IG_ATTACH'); await turns();
    disconnected();
    assert.equal((await h.send('UI_IG_ATTACH')).runId, initial.runId);
    resolve({ users: [account(2), account(3)], done: true }); await turns();
    const state = await h.send('UI_IG_ATTACH');
    assert.equal(state.status, 'complete'); assert.equal(state.runId, initial.runId);
    assert.equal(h.calls.filter(c => c.operation === 'profile').length, 2);
  } finally { h.cleanup(); }
});

test('Instagram stops in-flight work on explicit stop and discards it on source navigation', async () => {
  let resolve;
  const h = harness([profile(), () => new Promise(done => { resolve = done; })]);
  try {
    const initial = await h.send('UI_IG_ATTACH'); await turns();
    await h.send('UI_IG_STOP', { runId: initial.runId });
    resolve({ users: [account(2), account(3)], done: true }); await turns();
    assert.equal((await h.send('UI_IG_STATE', { runId: initial.runId })).status, 'stopped');
    h.navigate('https://www.instagram.com/another/');
    await h.product.handleTabUpdated(7, { url: 'https://www.instagram.com/another/' });
    await assert.rejects(h.send('UI_IG_STATE', { runId: initial.runId }), /igSessionEnded/);
  } finally { h.cleanup(); }
});

test('Instagram stop also cancels a start still waiting for its source tab', async () => {
  const h = harness([]);
  try {
    let resolve;
    chrome.tabs.get = () => new Promise(done => { resolve = done; });
    const beginning = h.send('UI_IG_ATTACH');
    await turns();
    await h.send('UI_IG_STOP');
    resolve({ id: 7, url: 'https://www.instagram.com/example/', incognito: false });
    await assert.rejects(beginning, /igStopped/);
    assert.equal(h.calls.length, 0);
  } finally { h.cleanup(); }
});

test('Instagram panel commands reject wrong senders and never authorize unfollowing from another profile', async () => {
  const h = harness(completeReplies(false));
  try {
    await assert.rejects(h.send('UI_IG_BEGIN', {}, 'https://www.instagram.com/example/'), /igUnavailable/);
    await assert.rejects(h.send('UI_IG_BEGIN', {}, panel.replace('sourceTab=7', 'sourceTab=8')), /igPageChanged/);
    await assert.rejects(h.send('UI_IG_BEGIN', {}, base + 'popup/index.html'), /igUnavailable/);
    const initial = await h.send('UI_IG_ATTACH'); await turns();
    await assert.rejects(h.send('UI_IG_UNFOLLOW', { runId: initial.runId, targetId: 'account_2', confirmed: true }), /igOwnProfileOnly/);
  } finally { h.cleanup(); }
});

test('Instagram does not replay ambiguous unfollow writes from the same results', async () => {
  const h = harness([...completeReplies(true), { error: 'igUnfollowUncertain' }]);
  try {
    const initial = await h.send('UI_IG_ATTACH'); await turns();
    for (let i = 0; i < 2; i++) await assert.rejects(h.send('UI_IG_UNFOLLOW', { runId: initial.runId, targetId: 'account_2', confirmed: true }), /igUnfollowUncertain/);
    assert.equal(h.calls.filter(c => c.operation === 'unfollow').length, 1);
  } finally { h.cleanup(); }
});

function unfollowDomHarness({ own = true, confirmColor = 'rgb(238, 81, 94)', cancelColor = 'rgb(30, 30, 30)',
  actionBackground = 'rgb(31, 34, 35)', extraConfirmButton = false } = {}) {
  let listOpen = false, confirmOpen = false, unfollowed = false, actionClicks = 0, confirmClicks = 0;
  const matches = (element, selector) => selector.split(',').some(rawSelector => {
    const value = rawSelector.trim();
    const tag = value.match(/^[a-z][a-z0-9]*/i)?.[0]?.toUpperCase();
    if (tag && element.tagName !== tag) return false;
    if (value === '[role="heading"]') return element.attributes.role === 'heading';
    if (value === '[role="button"]') return element.attributes.role === 'button';
    const attribute = value.match(/\[([^=*\]]+)(?:([*]?=)"([^"]*)")?\]/);
    if (attribute) {
      const actual = element.getAttribute(attribute[1]);
      if (actual === null) return false;
      if (attribute[2] === '=' && actual !== attribute[3]) return false;
      if (attribute[2] === '*=' && !actual.includes(attribute[3])) return false;
    }
    return !tag && !attribute ? false : true;
  });
  const node = (tag = 'div', props = {}) => {
    const element = {
      tagName: tag.toUpperCase(), attributes: {}, children: [], parentElement: null,
      isConnected: true, disabled: false, type: '', textContent: '', color: 'rgb(30, 30, 30)',
      backgroundColor: 'rgba(0, 0, 0, 0)',
      append(...children) { for (const child of children) { child.parentElement = this; this.children.push(child); } },
      get firstElementChild() { return this.children[0] || null; },
      getClientRects() { return this.isConnected ? [{}] : []; },
      getAttribute(name) { return this.attributes[name] ?? null; },
      contains(child) { return this === child || this.children.some(item => item.contains(child)); },
      querySelectorAll(selector) {
        const result = [];
        for (const child of this.children) {
          if (matches(child, selector)) result.push(child);
          result.push(...child.querySelectorAll(selector));
        }
        return result;
      },
      querySelector(selector) { return this.querySelectorAll(selector)[0] || null; },
      dispatchEvent() {}, click() {}, ...props
    };
    return element;
  };
  const span = text => node('span', { textContent: String(text) });
  const followerLink = node('a', { attributes: { href: '/example/followers/' } }); followerLink.append(span('3'));
  const followingCount = span('2');
  const followingLink = node('a', { attributes: { href: '/example/following/' }, click() { listOpen = true; } });
  followingLink.append(followingCount);
  const heading = node('h1', { textContent: 'example' });
  const edit = node('a', { attributes: { href: '/accounts/edit/' }, href: 'https://www.instagram.com/accounts/edit/' });
  const main = node('main'); main.append(heading, followerLink, followingLink, ...(own ? [edit] : []));

  const closeButton = node('button', { click() { listOpen = false; } }); closeButton.append(node('svg'));
  const listHeading = node('h1', { textContent: '关注', attributes: { role: 'heading' } });
  const header = node('div'); header.append(listHeading, closeButton);
  const search = node('input', { type: 'text', value: '', dispatchEvent() {} });
  const avatarLink = node('a', { attributes: { href: '/account_2/' } }); avatarLink.append(node('img'));
  const avatarButton = node('button'); avatarButton.append(avatarLink);
  const targetLink = node('a', { attributes: { href: '/account_2/' }, textContent: 'account_2' });
  const identity = node('div'); identity.append(targetLink);
  const action = node('button', { textContent: '已关注', backgroundColor: actionBackground,
    click() { actionClicks += 1; confirmOpen = true; } });
  const row = node('div'); row.append(avatarButton, identity, action);
  const listDialog = node('div', { attributes: { role: 'dialog' } }); listDialog.append(header, search, row);

  const confirmLink = node('a', { attributes: { href: '/account_2/' } }); confirmLink.append(node('img'));
  const confirm = node('button', { textContent: '取消关注', color: confirmColor, click() {
    confirmClicks += 1; confirmOpen = false; unfollowed = true; targetLink.isConnected = false;
    followingCount.textContent = '1';
  } });
  const cancel = node('button', { textContent: '取消', color: cancelColor, click() { confirmOpen = false; } });
  const confirmDialog = node('div', { attributes: { role: 'dialog' } });
  confirmDialog.append(confirmLink, confirm, cancel, ...(extraConfirmButton ? [node('button')] : []));
  const env = {
    location: new URL('https://www.instagram.com/example/'),
    document: {
      querySelector: selector => selector === 'main' ? main : null,
      querySelectorAll: selector => selector === '[role="dialog"]'
        ? [listOpen ? listDialog : null, confirmOpen ? confirmDialog : null].filter(Boolean) : []
    },
    getComputedStyle: element => ({ visibility: 'visible', overflowY: element.overflowY,
      color: element.color, backgroundColor: element.backgroundColor }),
    setTimeout(callback) { callback(); },
    Event: class { constructor(type) { this.type = type; } }
  };
  return {
    env,
    run: extra => instagramDomRead({ operation: 'unfollow', runId: 'unfollow-test', username: 'example',
      targetUsername: 'account_2', confirmed: true, ...extra }, env),
    effects: () => ({ actionClicks, confirmClicks, unfollowed, listOpen, confirmOpen })
  };
}

test('Instagram unfollow uses the visible Following search and native confirmation without translated labels', async () => {
  // Appearance rewriting can make Cancel red and the requested action neutral;
  // native dialog order, not computed color, remains authoritative.
  const h = unfollowDomHarness({ confirmColor: 'rgb(30, 30, 30)', cancelColor: 'rgb(238, 81, 94)' });
  assert.deepEqual(await instagramDomRead({ operation: 'profile', runId: 'profile-test', username: 'example' }, h.env), {
    profile: { id: 'example', username: 'example', name: '', followers: 3, following: 2 }, ownProfile: true
  });
  await instagramDomRead({ operation: 'cancel', runId: 'profile-test' }, h.env);
  assert.deepEqual(await h.run(), { unfollowed: true });
  assert.deepEqual(h.effects(), { actionClicks: 1, confirmClicks: 1, unfollowed: true, listOpen: false, confirmOpen: false });
  assert.equal(h.env.__cosmicGeminiInstagramLists, undefined);
});

test('Instagram DOM unfollow refuses other profiles and ambiguous confirmation controls before writing', async () => {
  const other = unfollowDomHarness({ own: false });
  assert.equal((await other.run()).error, 'igOwnProfileOnly');
  assert.equal(other.effects().confirmClicks, 0);
  const ambiguous = unfollowDomHarness({ extraConfirmButton: true });
  assert.equal((await ambiguous.run()).error, 'igUnavailable');
  assert.equal(ambiguous.effects().confirmClicks, 0);
  const reversed = unfollowDomHarness({ actionBackground: 'rgb(0, 149, 246)' });
  assert.equal((await reversed.run()).error, 'igRelationshipChanged');
  assert.equal(reversed.effects().actionClicks, 0);
});

test('Instagram DOM reading skips non-scrolling auto-overflow wrappers, reads later rows and excludes suggestions', async () => {
  const node = (props = {}) => ({ isConnected: true, children: [], clientHeight: 0, scrollHeight: 0,
    overflowY: 'visible', getClientRects: () => [{}], querySelector: () => null,
    querySelectorAll: () => [], getAttribute: () => null, ...props });
  const links = [];
  const rows = node({ querySelectorAll: selector => selector === 'a[href]' ? links : [] });
  let closed = false, scrolled = false, mounted = false, verificationWaits = 0, bottomHeightChanges = 0;
  const close = node({ click() { closed = true; mounted = false; }, querySelector: () => ({}) });
  const header = node({ querySelectorAll: () => [close] });
  const heading = node({ parentElement: header });
  const dialog = node({ querySelector: selector => selector.includes('heading') ? heading : null,
    querySelectorAll: selector => selector === 'a[href]' ? links : [] });
  header.parentElement = dialog;
  const outer = node({ clientHeight: 400, scrollHeight: 400, overflowY: 'auto', parentElement: dialog });
  const scroller = node({ clientHeight: 309, scrollHeight: 786, overflowY: 'scroll', parentElement: outer });
  const wrapper = node({ clientHeight: 720, scrollHeight: 720, overflowY: 'auto', parentElement: scroller,
    children: [rows], firstElementChild: rows, querySelectorAll: () => links });
  rows.parentElement = wrapper;
  rows.children = [node(), node(), node()];
  const add = (id, visibleText = `account_${id}`, destination = visibleText, verified = false) => {
    const link = node({ textContent: visibleText + (verified ? 'Verified' : ''), innerText: visibleText,
      getAttribute: () => `/${destination}/` });
    const name = node({ textContent: `自定义名称 ${id}`, contains: () => false, matches: () => true });
    const hiddenVerificationLabel = node({ textContent: 'Verified', contains: () => false, matches: () => true,
      getClientRects: () => [] });
    const badge = node({
      getAttribute: attribute => ({ fill: 'rgb(0, 149, 246)', width: '12', height: '12' })[attribute] ?? null,
      querySelectorAll: () => []
    });
    link.parentElement = node({ parentElement: rows, children: [link, hiddenVerificationLabel, name],
      querySelectorAll: selector => selector === 'svg' && verified ? [badge] : [] });
    if (verified) {
      const avatar = node({ textContent: '', getAttribute: () => `/${destination}/` });
      avatar.parentElement = node({ parentElement: rows, children: [avatar], querySelectorAll: () => [] });
      links.push(avatar);
    }
    links.push(link); return link;
  };
  add(1); add(2, 'account_2', 'account_2', true); add(3);
  rows.querySelector = () => links[0];
  const suggestion = node({ querySelectorAll: () => [node({ textContent: 'unrelated', getAttribute: () => '/unrelated/' })] });
  scroller.children = [wrapper, suggestion];
  let scrollTop = 0;
  Object.defineProperty(scroller, 'scrollTop', { get: () => scrollTop, set: value => {
    scrollTop = Math.max(0, Math.min(scroller.scrollHeight - scroller.clientHeight, Number(value) || 0));
    scrolled ||= scrollTop > 0;
  } });
  const count = node({ textContent: '6' });
  const countLink = node({ querySelectorAll: () => [count], click() { mounted = true; } });
  const main = node({ querySelector: () => countLink,
    querySelectorAll: selector => selector === 'h1,h2' ? [{ textContent: 'example' }] : [] });
  const env = {
    location: new URL('https://www.instagram.com/example/'),
    document: { querySelector: () => main, querySelectorAll: () => mounted ? [dialog] : [] },
    getComputedStyle: element => ({ visibility: 'visible', overflowY: element.overflowY }),
    setTimeout(callback, delay) {
      if (delay === 1200 && scrolled && links.length === 4) { add(4); add(5, 'different_visible_text', 'account_5'); }
      if (delay === 80) verificationWaits += 1;
      if (verificationWaits > 0 && (delay === 80 || delay === 1200)
        && scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2) {
        scroller.scrollHeight += 1;
        scrollTop += 1;
        bottomHeightChanges += 1;
      }
      callback();
    }
  };
  const result = await readDomUntilDone({ operation: 'list', runId: 'test', username: 'example',
    kind: 'following' }, env);
  assert.equal(result.error, undefined);
  assert.equal(scrolled, true);
  assert.equal(result.done, true);
  assert.equal(result.users.length, 5, 'stable bottom completion does not require the stale displayed count of six');
  assert.equal(result.users[0].name, '自定义名称 1');
  const separated = result.users.find(account => account.username === 'account_5');
  assert.equal(separated?.id, 'account_5', 'the validated profile path is authoritative for account identity');
  assert.equal(Object.hasOwn(separated, 'href'), false, 'scan results do not duplicate a destination derived from the handler');
  assert.equal(result.users.some(account => account.username === 'unrelated'), false);
  assert.equal(result.users.find(account => account.username === 'account_2')?.verified, true);
  assert.equal(result.users.find(account => account.username === 'account_3')?.verified, false);
  assert.equal(verificationWaits > 0, true, 'retained rows receive the same complete fast audit as virtualized rows');
  assert.equal(bottomHeightChanges > 1, true,
    'bottom completion tolerates virtual-row pixel-height changes after the account set is stable');
  assert.equal(closed, true);
  await instagramDomRead({ operation: 'cancel', runId: 'test' }, env);
  assert.equal(env.__cosmicGeminiInstagramLists, undefined);
});

test('Instagram DOM rapidly remounts virtualized rows and recovers a skipped account before bottom completion', async () => {
  const node = (props = {}) => ({ isConnected: true, children: [], clientHeight: 0, scrollHeight: 0,
    overflowY: 'visible', textContent: '', getClientRects: () => [{}], querySelector: () => null,
    querySelectorAll: () => [], getAttribute: () => null, matches: () => false,
    contains(child) { return this === child || this.children.some(item => item.contains?.(child)); }, ...props });
  const accountLink = id => {
    const link = node({ textContent: `account_${id}`, getAttribute: () => `/account_${id}/` });
    link.parentElement = null;
    return link;
  };
  const top = [accountLink(1), accountLink(2)];
  const topWithSkipped = [accountLink(1), accountLink(2), accountLink(3)];
  const bottom = [accountLink(4), accountLink(5)];
  let links = top;
  const rows = node({ children: [node(), node()], querySelectorAll: selector => selector === 'a[href]' ? links : [],
    querySelector: selector => selector === 'a[href]' ? links[0] : null });
  const attachRows = values => { links = values; for (const link of links) link.parentElement = rows; };
  attachRows(top);
  let scrollTop = 0;
  const scroller = node({ clientHeight: 300, scrollHeight: 450, overflowY: 'scroll', children: [rows],
    querySelectorAll: selector => selector === 'a[href]' ? links : [] });
  rows.parentElement = scroller;
  Object.defineProperty(scroller, 'scrollTop', {
    get: () => scrollTop,
    set: value => { scrollTop = Math.max(0, Math.min(150, Number(value) || 0)); }
  });
  const close = node({ click() { mounted = false; }, querySelector: () => ({}) });
  const header = node({ querySelectorAll: selector => selector === 'button' ? [close] : [] });
  const dialogHeading = node({ parentElement: header });
  let mounted = false;
  const dialog = node({ querySelector: selector => selector.includes('heading') ? dialogHeading : null,
    querySelectorAll: selector => selector === 'a[href]' ? links : [] });
  header.parentElement = dialog; scroller.parentElement = dialog;
  const followerCount = node({ textContent: '0' });
  const followingCount = node({ textContent: '4' });
  const followerLink = node({ querySelectorAll: () => [followerCount] });
  const followingLink = node({ querySelectorAll: () => [followingCount], click() { mounted = true; } });
  const main = node({
    querySelector(selector) {
      if (selector.includes('/followers/')) return followerLink;
      if (selector.includes('/following/')) return followingLink;
      return null;
    },
    querySelectorAll: selector => selector === 'h1,h2' ? [{ textContent: 'example' }] : []
  });
  let verificationWaits = 0, verificationTopPasses = 0, verificationWasAtTop = false;
  const env = {
    location: new URL('https://www.instagram.com/example/'),
    document: { querySelector: selector => selector === 'main' ? main : null,
      querySelectorAll: selector => selector === '[role="dialog"]' && mounted ? [dialog] : [] },
    getComputedStyle: element => ({ visibility: 'visible', overflowY: element.overflowY }),
    setTimeout(callback, delay) {
      if (delay === 1200 && scrollTop > 0) attachRows(bottom);
      if (delay === 80) {
        verificationWaits += 1;
        const atTop = scrollTop === 0;
        if (atTop && !verificationWasAtTop) verificationTopPasses += 1;
        verificationWasAtTop = atTop;
        // Simulate a slower React remount: the missing visible row does not
        // reach the DOM on the first settling tick after the viewport moves.
        if (scrollTop === 0 && verificationWaits >= 2) attachRows(topWithSkipped);
      }
      callback();
    }
  };
  const result = await readDomUntilDone({ operation: 'list', runId: 'verification-test', username: 'example',
    kind: 'following' }, env);
  assert.equal(result.done, true);
  assert.deepEqual(result.users.map(account => account.id).sort(),
    ['account_1', 'account_2', 'account_3', 'account_4', 'account_5']);
  assert.equal(verificationWaits > 1, true,
    'virtualized rows are sampled until a delayed remount settles, then audited again with overlapping viewports');
  assert.equal(verificationTopPasses, 2, 'every list receives two complete top-to-bottom audits');
  assert.equal(mounted, false);
});
