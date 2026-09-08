import assert from 'node:assert/strict';
import test from 'node:test';
import { twitterPostContext, twitterSyndicationUrl, twitterVideoCandidates, twitterVideoControlTarget } from '../extension/core/twitter-video.js';
import { classifyVideoResource, groupVideoCandidates, knownVideoFileSize, readVideoFileSize, videoSessionKey } from '../extension/core/video-download.js';
import { createVideoDownloadProduct } from '../extension/background/products/customs/video-download.js';

function tweet(id = '123', count = 2) {
  return { id_str: id, text: 'A short test clip', user: { screen_name: 'example' }, mediaDetails: [
    { type: 'photo', media_url_https: 'https://pbs.twimg.com/media/photo.jpg' },
    ...Array.from({ length: count }, (_, index) => ({ type: 'video',
      media_url_https: `https://pbs.twimg.com/ext_tw_video_thumb/${id}-${index}.jpg`,
      video_info: { duration_millis: 12500 + index * 1000, variants: [
        { content_type: 'application/x-mpegURL', url: `https://video.twimg.com/${id}/${index}/master.m3u8` },
        ...[360, 720].map(height => ({ content_type: 'video/mp4', bitrate: height * 1000,
          url: `https://video.twimg.com/ext_tw_video/${id}/${index}/vid/${height * 16 / 9}x${height}/clip.mp4` }))
      ] }
    }))
  ] };
}

test('X routes distinguish feeds, statuses and explicitly selected attachments', () => {
  assert.equal(twitterPostContext('https://x.com/home').isTwitter, true);
  assert.equal(twitterPostContext('https://x.com/home').postId, '');
  assert.equal(twitterPostContext('https://twitter.com/user/status/123/video/2').mediaIndex, 1);
  assert.equal(twitterPostContext('https://x.com/i/web/status/123').postId, '123');
  for (const url of ['https://x.com.evil.test/u/status/123', 'https://example.com/u/status/123', 'file:///u/status/123']) {
    assert.equal(twitterPostContext(url).isTwitter, false);
  }
  assert.equal(twitterSyndicationUrl('not-an-id'), '');
  assert.equal(new URL(twitterSyndicationUrl('719944021058060289')).searchParams.get('id'), '719944021058060289');
});

test('a status lists every own video with separate quality groups, not replies or quoted videos', () => {
  const main = { ...tweet(), quoted_status: tweet('777') };
  const context = twitterPostContext('https://x.com/example/status/123');
  const candidates = twitterVideoCandidates({ entries: [tweet('999'), main] }, context);
  assert.equal(candidates.length, 4);
  assert.equal(new Set(candidates.map(item => item.mediaKey)).size, 2);
  assert.equal(groupVideoCandidates(candidates.map(classifyVideoResource)).length, 2);
  assert.deepEqual([...new Set(candidates.map(item => item.qualityLabel))], ['360p', '720p']);
  assert.equal(candidates[0].duration, 12.5);
  assert.match(candidates[0].thumbnailUrl, /123-0/);
  assert.ok(candidates.every(item => item.kind === 'direct' && item.url.includes('/123/')));
  assert.deepEqual(twitterVideoCandidates({ ...tweet('999'), quoted_status: tweet() }, context), []);
});

test('click selection distinguishes a video index from an attachment index that includes photos', () => {
  const context = twitterPostContext('https://x.com/example/status/123');
  const selected = twitterVideoCandidates(tweet(), { ...context, videoIndex: 1 });
  assert.equal(selected.length, 2);
  assert.ok(selected.every(item => item.url.includes('/123/1/')));
  assert.equal(twitterVideoCandidates(tweet(), twitterPostContext('https://x.com/example/status/123/photo/1')).length, 0);
  assert.ok(twitterVideoCandidates(tweet(), twitterPostContext('https://x.com/example/status/123/video/2'))
    .every(item => item.url.includes('/123/0/')));
  const untrusted = tweet();
  untrusted.mediaDetails[1].video_info.variants = [{ content_type: 'video/mp4', url: 'https://evil.test/video.mp4' }];
  assert.deepEqual(twitterVideoCandidates(untrusted, { ...context, videoIndex: 0 }), []);
});

test('quoted videos without a permalink resolve only through matching own media metadata', t => {
  const previous = { location: globalThis.location, document: globalThis.document };
  t.after(() => Object.assign(globalThis, previous));
  globalThis.location = { href: 'https://x.com/home', origin: 'https://x.com' };
  const data = tweet('777');
  const player = { __reactProps$test: { tweet: data }, parentElement: null,
    querySelector: () => ({ poster: data.mediaDetails[2].media_url_https }) };
  globalThis.document = { querySelector: () => player };
  assert.deepEqual(twitterVideoControlTarget(location.href, 'video-abc-1'), {
    postUrl: 'https://x.com/i/web/status/777/video/3', videoIndex: 0
  });
  player.querySelector = () => ({ poster: 'https://pbs.twimg.com/unrelated.jpg' });
  assert.equal(twitterVideoControlTarget(location.href, 'video-abc-1'), null);
  assert.equal(twitterVideoControlTarget('https://x.com/previous', 'video-abc-1'), null);
});

test('file sizes use metadata only, exclude manifests, and never consume response bodies', async () => {
  const candidate = { kind: 'direct', url: 'https://video.twimg.com/file.mp4' };
  let calls = 0;
  const size = await readVideoFileSize(candidate, async (_url, options) => {
    calls += 1;
    assert.equal(options.method, 'HEAD');
    return { ok: true, status: 200, headers: new Headers({ 'content-type': 'video/mp4', 'content-length': '98765' }),
      arrayBuffer() { assert.fail('must not download a body'); } };
  });
  assert.equal(size, 98765);
  assert.equal(await readVideoFileSize({ ...candidate, contentLength: 123 }, () => assert.fail()), 123);
  for (const kind of ['hls', 'dash', 'muxed']) {
    assert.equal(knownVideoFileSize({ kind, contentLength: 1234 }), 0);
    assert.equal(await readVideoFileSize({ ...candidate, kind }, () => assert.fail()), 0);
  }
  for (const [status, headers] of [[200, { 'content-type': 'text/html' }], [206, {}], [200, { 'content-encoding': 'gzip' }]]) {
    assert.equal(await readVideoFileSize(candidate, async () => ({ ok: true, status,
      headers: new Headers({ 'content-length': '123', ...headers }) })), 0);
  }
  assert.equal(knownVideoFileSize({ ...candidate, source: 'performance', contentLength: 999 }), 0);
  assert.equal(knownVideoFileSize({ kind: 'muxed', outputBytes: 555 }), 555);
  assert.equal(calls, 1);
});

async function fixture(t, url = 'https://x.com/home') {
  const previous = { chrome: globalThis.chrome, fetch: globalThis.fetch };
  const data = {};
  const tab = { id: 61, windowId: 1, active: true, url, title: 'X' };
  const scripts = [], requests = [], collecting = [], messages = [];
  const pageTweets = new Map();
  let popupCount = 0;
  globalThis.chrome = {
    extension: {},
    storage: { session: {
      async get(key) { return structuredClone(key === null ? data : { [key]: data[key] }); },
      async set(values) { Object.assign(data, structuredClone(values)); },
      async remove(key) { delete data[key]; }
    } },
    tabs: { async get() { return { ...tab }; }, async query() { return [{ ...tab }]; } },
    alarms: { async clear() {}, async create() {} },
    action: { async openPopup() { popupCount += 1; } },
    scripting: { async executeScript(options) {
      scripts.push(options);
      if (options.func?.name === 'twitterVideoPageContext') {
        return [{ frameId: 0, result: { pageUrl: options.args[0], tweet: pageTweets.get(options.args[3]) || null } }];
      }
      return [];
    } }
  };
  const network = { get: async () => ({ ok: false }) };
  globalThis.fetch = async (url, options = {}) => {
    requests.push({ url, options });
    if (options.method === 'HEAD') return { ok: true, status: 200,
      headers: new Headers({ 'content-length': '123456', 'content-type': 'video/mp4' }) };
    return network.get(url, options);
  };
  const platform = { readSettings: async () => ({ videoDownload: {} }), getLocale: async () => 'en-US',
    sendTabMessage: async (_id, message) => { messages.push(message); return {}; },
    setFeatureActivity: async () => {}, notifyCentralUi: () => {} };
  const product = createVideoDownloadProduct(platform, { maybeClose: async () => {} }, {
    setCollecting: (...args) => collecting.push(args)
  });
  await product.initialize();
  const send = message => product.handleMessage({ tabId: tab.id, ...message }, {
    sender: { frameId: 0, tab: { ...tab }, url: tab.url }
  });
  t.after(async () => {
    await send({ type: 'UI_VIDEO_STOP' });
    await new Promise(resolve => setImmediate(resolve));
    Object.assign(globalThis, previous);
  });
  return { product, tab, scripts, requests, collecting, messages, pageTweets, network, send,
    state: () => product.state({ videoDownload: {} }, tab.id, tab.url),
    stored: () => data[videoSessionKey(tab.id)], popupCount: () => popupCount };
}

async function until(predicate) {
  for (let i = 0; i < 100; i += 1) {
    if (await predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 1));
  }
  assert.fail('asynchronous discovery did not settle');
}

test('feed activation installs controls without fetching videos; click opens exactly one selection once', async t => {
  const f = await fixture(t);
  assert.equal((await f.send({ type: 'CG_VIDEO_TWITTER_CONTROLS_STATE', pageUrl: f.tab.url })).active, false);
  await f.send({ type: 'UI_VIDEO_OPEN' });
  assert.equal((await f.state()).status, 'twitter-open-post');
  assert.equal(f.requests.length, 0);
  assert.equal(f.collecting.length, 0);
  assert.deepEqual(f.scripts.flatMap(item => item.files || []), ['content/twitter-video-controls.js']);
  f.pageTweets.set('123', tweet());
  assert.equal((await f.send({ type: 'CG_VIDEO_TWITTER_CONTROLS_STATE', pageUrl: f.tab.url })).active, true);
  const selected = await f.send({ type: 'CG_VIDEO_SELECT_TWITTER', pageUrl: f.tab.url,
    postUrl: 'https://x.com/example/status/123', videoIndex: 1 });
  assert.equal(selected.popupOpened, true);
  await until(async () => (await f.state()).candidates.length === 2);
  assert.ok((await f.state()).candidates.every(item => item.url.includes('/123/1/')));
  assert.equal(f.popupCount(), 1);
  assert.equal((await f.send({ type: 'UI_VIDEO_CONSUME_OPEN_REQUEST' })).open, true);
  assert.equal((await f.send({ type: 'UI_VIDEO_CONSUME_OPEN_REQUEST' })).open, false);
  await f.send({ type: 'UI_VIDEO_STOP' });
  assert.ok(f.messages.some(item => item.type === 'CG_VIDEO_STOP'));
  await assert.rejects(f.send({ type: 'CG_VIDEO_SELECT_TWITTER', pageUrl: f.tab.url,
    postUrl: 'https://x.com/example/status/123', videoIndex: 0 }), /no longer/);
});

test('status activation lists own multiple videos, and a reply arrow replaces the list', async t => {
  const f = await fixture(t, 'https://x.com/example/status/123');
  f.pageTweets.set('123', tweet());
  f.pageTweets.set('999', tweet('999', 1));
  await f.send({ type: 'UI_VIDEO_OPEN' });
  await until(async () => (await f.state()).candidates.length === 4);
  assert.equal(groupVideoCandidates((await f.state()).candidates).length, 2);
  assert.ok(f.scripts.some(item => item.files?.includes('content/twitter-video-controls.js')));
  await f.send({ type: 'CG_VIDEO_SELECT_TWITTER', pageUrl: f.tab.url,
    postUrl: 'https://x.com/reply/status/999', videoIndex: 0 });
  await until(async () => (await f.state()).candidates.some(item => item.url.includes('/999/')));
  assert.ok((await f.state()).candidates.every(item => item.url.includes('/999/')));
  await f.product.handleAlarm({ name: 'downloadScanPause:videoDownload:61' });
  assert.equal((await f.send({ type: 'CG_VIDEO_TWITTER_CONTROLS_STATE', pageUrl: f.tab.url })).active, false);
});

test('a late result cannot repopulate a stopped and restarted session at the same URL', async t => {
  const f = await fixture(t, 'https://x.com/example/status/123');
  let release;
  f.network.get = async () => new Promise(resolve => { release = resolve; });
  await f.send({ type: 'UI_VIDEO_OPEN' });
  await until(() => !!release);
  const oldId = f.stored().discoveryId;
  await f.send({ type: 'UI_VIDEO_STOP' });
  f.pageTweets.set('123', tweet('123', 1));
  await f.send({ type: 'UI_VIDEO_OPEN' });
  assert.notEqual(f.stored().discoveryId, oldId);
  await until(async () => (await f.state()).candidates.length === 2);
  release({ ok: true, json: async () => tweet('123', 2) });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal((await f.state()).candidates.length, 2);
  f.tab.url = 'https://x.com/home';
  await f.product.handleTabUpdated(f.tab.id, { url: f.tab.url }, f.tab);
  assert.equal((await f.state()).status, 'twitter-open-post');
  assert.deepEqual((await f.state()).candidates, []);
  assert.equal(f.collecting.length, 0);
});
