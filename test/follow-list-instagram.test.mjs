import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { instagramRoute, compareInstagramLists } from '../extension/core/follow-list-instagram.js';
import { instagramPageRequest } from '../extension/content/follow-list-instagram-request.js';
import { instagramDomRead } from '../extension/content/follow-list-instagram-dom.js';
import { createFollowListInstagramProduct } from '../extension/background/products/operations/follow-list-instagram.js';

const account = id => ({ id: `account_${id}`, username: `account_${id}`, name: `名称 ${id}` });
const raw = (id, username = `account_${id}`) => ({ pk: String(id), username });
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

function pageHarness(replies, cookie = 'csrftoken=test-csrf; ds_user_id=1') {
  const calls = [];
  const context = vm.createContext({ URL, URLSearchParams, AbortController, setTimeout, clearTimeout,
    location: new URL('https://www.instagram.com/example/?hl=ja'), document: { cookie },
    fetch: async (url, options) => {
      calls.push({ url, options }); const value = replies.shift(); assert.ok(value, 'No unexpected requests');
      return { status: value.http || 200, ok: !value.http, json: async () => value };
    }
  });
  const run = vm.runInContext(`(${instagramPageRequest.toString()})`, context);
  return { run: extra => run({ username: 'example', runId: 'run', operation: 'unfollow', targetUsername: 'account_2', confirmed: true, ...extra }), calls };
}

test('Instagram unfollow checks the authenticated viewer, selected username and live relationship before one mutation', async () => {
  const h = pageHarness([{ status: 'ok', user: raw(1, 'example') }, { status: 'ok', data: { user: raw(2) } }, { status: 'ok', following: true, followed_by: false }, { status: 'ok' }, { status: 'ok', following: false, followed_by: false }]);
  assert.equal((await h.run()).unfollowed, true);
  const writes = h.calls.filter(c => c.options.method === 'POST'); assert.equal(writes.length, 1);
  assert.match(writes[0].url, /\/web\/friendships\/2\/unfollow\/$/);
  assert.equal(writes[0].options.headers['X-CSRFToken'], 'test-csrf');
  assert.ok(h.calls.every(c => c.options.credentials === 'include' && new URL(c.url).origin === 'https://www.instagram.com'));
  for (const identity of [raw(99, 'example'), raw(1, 'different')]) {
    const switched = pageHarness([{ status: 'ok', user: identity }]);
    assert.equal((await switched.run()).error, 'igOwnProfileOnly'); assert.equal(switched.calls.length, 1);
  }
  const mutual = pageHarness([{ status: 'ok', user: raw(1, 'example') }, { status: 'ok', data: { user: raw(2) } }, { status: 'ok', following: true, followed_by: true }]);
  assert.equal((await mutual.run()).error, 'igRelationshipChanged');
  assert.equal(mutual.calls.filter(c => c.options.method === 'POST').length, 0);
});

test('Instagram respects login, rate-limit and challenge responses without repeated requests', async () => {
  for (const [reply, error] of [[{ http: 401 }, 'igLoginRequired'], [{ http: 429 }, 'igRateLimited'], [{ status: 'fail', challenge: {} }, 'igAccessDenied']]) {
    const h = pageHarness([reply]); assert.equal((await h.run()).error, error); assert.equal(h.calls.length, 1);
  }
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
