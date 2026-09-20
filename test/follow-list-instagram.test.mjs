import assert from 'node:assert/strict';
import test from 'node:test';
import { instagramRoute, compareInstagramLists } from '../extension/core/follow-list-instagram.js';
import { instagramDomRead } from '../extension/content/follow-list-instagram-dom.js';
import { createFollowListInstagramProduct } from '../extension/background/products/operations/follow-list-instagram.js';

const account = id => ({ id: `account_${id}`, username: `account_${id}`, name: `名称 ${id}` });
const profile = (following = 2, followers = 2, ownProfile = true) => ({ profile: { id: 'example', username: 'example', following, followers }, ownProfile });
const base = 'chrome-extension://test/';
const panel = base + 'workspaces/follow-list-instagram/follow-list-instagram.html?sourceTab=7';
const turns = async () => { for (let i = 0; i < 150; i++) await Promise.resolve(); };
function harness(replies) {
  let url = 'https://www.instagram.com/example/';
  const calls = []; let now = 0; const originalNow = Date.now;
  Date.now = () => (now += 5000);
  globalThis.chrome = {
    runtime: { getURL: path => base + path },
    tabs: { get: async () => ({ id: 7, url, incognito: false }) },
    scripting: { executeScript: async options => {
      const input = options.args[0]; calls.push(input);
      if (input.operation === 'cancel') return [{ result: { ok: true } }];
      const reply = replies.shift(); assert.notEqual(reply, undefined, `Unexpected ${input.operation}`);
      return [{ result: typeof reply === 'function' ? await reply(input) : reply }];
    } }
  };
  const product = createFollowListInstagramProduct({ isIncognitoContext: () => false });
  const send = (type, extra = {}, sender = panel) => product.handleMessage({ type, tabId: 7, ...extra }, { sender: { url: sender } });
  return { product, send, calls, navigate: value => { url = value; }, cleanup: () => { Date.now = originalNow; } };
}
const completeReplies = own => [profile(2, 2, own), { users: [account(2)], done: false }, { users: [account(2), account(3)], done: true }, { users: [account(3), account(4)], done: true }, profile(2, 2, own)];

test('Instagram profile routing ignores interface language and rejects unrelated routes and lookalike hosts', () => {
  for (const value of ['https://www.instagram.com/Example/?hl=zh-cn', 'https://instagram.com/example/tagged/', 'https://www.instagram.com/example/reels/']) assert.equal(instagramRoute(value).username, 'example');
  for (const path of ['', 'p/ABC/', 'reel/ABC/', 'direct/inbox/', 'accounts/', 'example/p/ABC/']) assert.equal(instagramRoute('https://www.instagram.com/' + path).username, '');
  for (const value of ['https://instagram.com.evil.test/example/', 'http://instagram.com/example/', 'https://api.instagram.com/example/', 'invalid']) assert.equal(instagramRoute(value).supported, false);
});

test('Instagram comparison deduplicates accounts and separates all three relationship groups', () => {
  const groups = compareInstagramLists([account(2), account(2), account(3)], [account(3), account(4)]);
  assert.deepEqual(Object.fromEntries(Object.entries(groups).map(([key, list]) => [key, list.map(a => a.id)])), {
    notFollowingBack: ['account_2'], mutual: ['account_3'], followersOnly: ['account_4']
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
    assert.equal(h.calls.filter(c => c.operation === 'unfollow').length, 1);
  } finally { h.cleanup(); }
});

test('Instagram incomplete lists and access errors never become false non-follower results', async () => {
  for (const result of [{ users: [account(2)], done: true }, { error: 'igAccessDenied' }]) {
    const h = harness([profile(), result]);
    try {
      const initial = await h.send('UI_IG_ATTACH'); await turns();
      const state = await h.send('UI_IG_STATE', { runId: initial.runId });
      assert.equal(state.status, 'error'); assert.equal(state.groups, null);
      assert.equal(state.error, result.error || 'igIncomplete');
      assert.equal(h.calls.filter(c => c.operation === 'list').length, 1);
    } finally { h.cleanup(); }
  }
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

function unfollowDomHarness({ own = true, dangerColor = 'rgb(238, 81, 94)', actionBackground = 'rgb(31, 34, 35)' } = {}) {
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
  const danger = node('button', { textContent: '取消关注', color: dangerColor, click() {
    confirmClicks += 1; confirmOpen = false; unfollowed = true; targetLink.isConnected = false;
    followingCount.textContent = '1';
  } });
  const cancel = node('button', { textContent: '取消', click() { confirmOpen = false; } });
  const confirmDialog = node('div', { attributes: { role: 'dialog' } }); confirmDialog.append(confirmLink, danger, cancel);
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
  const h = unfollowDomHarness();
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
  const ambiguous = unfollowDomHarness({ dangerColor: 'rgb(30, 30, 30)' });
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
  let closed = false, scrolled = false, mounted = false;
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
  const add = id => {
    const link = node({ textContent: `account_${id}`,
      getAttribute: () => `/account_${id}/` });
    const name = node({ textContent: `自定义名称 ${id}`, contains: () => false, matches: () => true });
    link.parentElement = node({ parentElement: rows, children: [link, name] });
    links.push(link); return link;
  };
  add(1); add(2); add(3);
  rows.querySelector = () => links[0];
  const suggestion = node({ querySelectorAll: () => [node({ textContent: 'unrelated', getAttribute: () => '/unrelated/' })] });
  scroller.children = [wrapper, suggestion];
  Object.defineProperty(scroller, 'scrollTop', { get: () => 0, set: value => { scrolled = value > 0; } });
  const count = node({ textContent: '5' });
  const countLink = node({ querySelectorAll: () => [count], click() { mounted = true; } });
  const main = node({ querySelector: () => countLink,
    querySelectorAll: selector => selector === 'h1,h2' ? [{ textContent: 'example' }] : [] });
  const env = {
    location: new URL('https://www.instagram.com/example/'),
    document: { querySelector: () => main, querySelectorAll: () => mounted ? [dialog] : [] },
    getComputedStyle: element => ({ visibility: 'visible', overflowY: element.overflowY }),
    setTimeout(callback, delay) {
      if (delay === 900 && scrolled && links.length === 3) { add(4); add(5); }
      callback();
    }
  };
  const result = await instagramDomRead({ operation: 'list', runId: 'test', username: 'example', kind: 'following', expected: 5 }, env);
  assert.equal(result.error, undefined);
  assert.equal(scrolled, true);
  assert.equal(result.done, true);
  assert.equal(result.users.length, 5);
  assert.equal(result.users[0].name, '自定义名称 1');
  assert.equal(result.users.some(account => account.username === 'unrelated'), false);
  assert.equal(closed, true);
  await instagramDomRead({ operation: 'cancel', runId: 'test' }, env);
  assert.equal(env.__cosmicGeminiInstagramLists, undefined);
});
