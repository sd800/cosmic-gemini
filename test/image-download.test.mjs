import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canonicalImageFamilyKey,
  groupImageCandidates,
  imageContentLength,
  imageExtension,
  imageLayout,
  imageMimeFromHeaders,
  limitImageCandidatesForSession,
  normalizeImageCandidate,
  sanitizeImageFilename
} from '../extension/core/image-download.js';
import { imagePageQuickDiscovery } from '../extension/core/image-page.js';
import { createImageDownloadProduct } from '../extension/background/products/customs/image-download.js';

test('responsive variants form one family and prefer the strongest original candidate', () => {
  const groups = groupImageCandidates([
    { url: 'https://cdn.example/photo-320x180.jpg?w=320', familyKey: 'hero', width: 320, height: 180, source: 'image' },
    { url: 'https://cdn.example/photo.jpg?w=1920', familyKey: 'hero', width: 1920, height: 1080, source: 'srcset', descriptorWidth: 1920 },
    { url: 'https://cdn.example/photo-original.jpg', familyKey: 'hero', width: 2400, height: 1350, source: 'original-attribute', originalHint: 8 }
  ]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].candidates.length, 3);
  assert.equal(groups[0].recommended.url, 'https://cdn.example/photo-original.jpg');
});

test('candidate normalization rejects non-image MIME responses and unsupported schemes', () => {
  assert.equal(normalizeImageCandidate({ url: 'javascript:alert(1)' }), null);
  assert.equal(normalizeImageCandidate({ url: 'https://example.com/page', mime: 'text/html' }), null);
  assert.equal(normalizeImageCandidate({ url: `https://example.com/${'a'.repeat(32_000)}.jpg` }), null);
  assert.equal(normalizeImageCandidate({ url: 'https://example.com/image?id=1', mime: 'image/webp' }).extension, 'webp');
});

test('image sessions stay bounded without dropping local capture artifacts', () => {
  const artifact = { id: 'capture', artifactId: 'video-1-capture.png', url: 'blob:local' };
  const candidates = [
    { id: 'large', url: 'https://example.com/large.jpg', label: 'x'.repeat(200) },
    artifact,
    { id: 'small', url: 'https://example.com/small.jpg' }
  ];
  assert.deepEqual(limitImageCandidatesForSession(candidates, 2, 100), [artifact]);
});

test('family keys ignore common thumbnail sizing parameters', () => {
  assert.equal(
    canonicalImageFamilyKey('https://cdn.example/photo-320x180.jpg?w=320&quality=70&id=8'),
    canonicalImageFamilyKey('https://cdn.example/photo.jpg?w=1920&quality=95&id=8')
  );
});

test('image metadata uses response totals and portable filenames', () => {
  const headers = [
    { name: 'Content-Type', value: 'image/avif; charset=binary' },
    { name: 'Content-Range', value: 'bytes 0-1023/8192' }
  ];
  assert.equal(imageMimeFromHeaders(headers), 'image/avif');
  assert.equal(imageContentLength(headers), 8192);
  assert.equal(imageExtension('https://example.com/no-extension', 'image/avif'), 'avif');
  assert.equal(sanitizeImageFilename('A <photo>: title? ', 'PNG'), 'A photo title.png');
});

test('image layouts distinguish square, wide, tall, and unknown dimensions', () => {
  assert.equal(imageLayout(1000, 950), 'square');
  assert.equal(imageLayout(1600, 900), 'wide');
  assert.equal(imageLayout(900, 1600), 'tall');
  assert.equal(imageLayout(0, 0), 'unknown');
});

test('Image Download reclaims its side-panel path and never closes another product’s panel', async () => {
  const previous = globalThis.chrome;
  let options = {}, configured = 0, closed = 0;
  globalThis.chrome = { sidePanel: {
    setOptions: async value => { configured += 1; options = { ...options, ...value }; },
    getOptions: async () => options,
    open: async () => {}, close: async () => { closed += 1; }
  } };
  try {
    const product = createImageDownloadProduct({}, {}, {});
    await product.prepareWorkspace(7);
    const imagePath = options.path;
    await product.prepareWorkspace(7);
    assert.equal(configured, 1);
    options = { ...options, path: 'workspaces/other-tool/panel.html' };
    assert.equal((await product.handleMessage({ type: 'UI_IMAGE_CLOSE_SIDE_PANEL', tabId: 7 }, { sender: {} })).closed, false);
    assert.equal(closed, 0);
    assert.equal(options.enabled, true);
    await product.prepareWorkspace(7);
    assert.equal(options.path, imagePath);
    assert.equal(configured, 2);
    assert.equal((await product.handleMessage({ type: 'UI_IMAGE_CLOSE_SIDE_PANEL', tabId: 7 }, { sender: {} })).closed, true);
    assert.equal(closed, 1);
  } finally { globalThis.chrome = previous; }
});

test('Image Download does not open a workspace after its source tab disappears', async () => {
  const previous = globalThis.chrome;
  let queried = 0, opened = 0;
  globalThis.chrome = {
    tabs: {
      async get() { throw new Error('Tab closed'); },
      async query() { queried += 1; return []; },
      async create() { opened += 1; return { id: 41 }; }
    },
    runtime: { getURL: path => `chrome-extension://test/${path}` }
  };
  try {
    const product = createImageDownloadProduct({}, {}, {});
    await assert.rejects(product.handleMessage({ type: 'UI_IMAGE_OPEN', tabId: 7,
      workspaceMode: 'page' }, { sender: {} }), /Tab closed/);
    assert.equal(queried, 0);
    assert.equal(opened, 0);
  } finally { globalThis.chrome = previous; }
});

test('Image Download cleans up a side panel opened during source-tab validation', async () => {
  const previous = globalThis.chrome;
  const calls = [];
  let options = {};
  globalThis.chrome = {
    tabs: { async get() { calls.push('get'); throw new Error('Tab closed'); } },
    sidePanel: {
      async setOptions(value) { calls.push(`enabled:${value.enabled}`); options = { ...options, ...value }; },
      async getOptions() { return options; },
      async open() { calls.push('open'); }
    }
  };
  try {
    const product = createImageDownloadProduct({}, {}, {});
    await assert.rejects(product.handleMessage({ type: 'UI_IMAGE_OPEN', tabId: 7 },
      { sender: {} }), /Tab closed/);
    assert.equal(calls[0], 'enabled:true', 'Side Panel setup starts before the tab read settles');
    assert.ok(calls.includes('open'));
    assert.equal(calls.at(-1), 'enabled:false');
  } finally { globalThis.chrome = previous; }
});

test('Image Download cleans up only a workspace it created when opening fails', async () => {
  const previous = globalThis.chrome;
  const url = 'chrome-extension://test/workspaces/image-download/image-download.html?sourceTab=7&view=page';
  let reuse = true;
  const removed = [];
  globalThis.chrome = {
    tabs: {
      async get() { return { id: 7, url: 'chrome://settings' }; },
      async query() { return reuse ? [{ id: 40, url }] : []; },
      async update() {},
      async create() { return { id: 41 }; },
      async remove(id) { removed.push(id); }
    },
    runtime: { getURL: path => `chrome-extension://test/${path}` }
  };
  try {
    const product = createImageDownloadProduct({}, {}, {});
    const message = { type: 'UI_IMAGE_OPEN', tabId: 7, workspaceMode: 'page' };
    await assert.rejects(product.handleMessage(message, { sender: {} }), /unavailable on this page/);
    assert.deepEqual(removed, [], 'a reused workspace belongs to the user');
    reuse = false;
    await assert.rejects(product.handleMessage(message, { sender: {} }), /unavailable on this page/);
    assert.deepEqual(removed, [41], 'only the newly created workspace is removed');
  } finally { globalThis.chrome = previous; }
});

test('Image Download does not create a page workspace for an ended session', async () => {
  const previous = globalThis.chrome;
  let opened = 0;
  globalThis.chrome = {
    storage: { session: { async get() { return {}; } } },
    tabs: {
      async query() { return []; },
      async create() { opened += 1; return { id: 50 }; }
    },
    runtime: { getURL: path => `chrome-extension://test/${path}` }
  };
  try {
    const product = createImageDownloadProduct({}, { async maybeClose() {} }, {});
    await product.initialize();
    await assert.rejects(product.handleMessage({ type: 'UI_IMAGE_OPEN_PAGE', tabId: 7 },
      { sender: {} }), /not active/);
    assert.equal(opened, 0);
  } finally { globalThis.chrome = previous; }
});

test('quick page discovery returns direct image sources before source enrichment', () => {
  const priorDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const priorLocation = Object.getOwnPropertyDescriptor(globalThis, 'location');
  const image = {
    currentSrc: 'https://cdn.example/hero-1600.jpg',
    src: 'https://cdn.example/hero-800.jpg',
    srcset: 'https://cdn.example/hero-800.jpg 800w, https://cdn.example/hero-1600.jpg 1600w',
    naturalWidth: 1600,
    naturalHeight: 900,
    clientWidth: 800,
    clientHeight: 450,
    alt: 'Hero',
    title: '',
    getAttribute: () => ''
  };
  Object.defineProperty(globalThis, 'location', {
    configurable: true,
    value: { href: 'https://example.com/article', origin: 'https://example.com', pathname: '/article' }
  });
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      baseURI: 'https://example.com/article',
      title: 'Article',
      images: [image],
      querySelectorAll: selector => selector.startsWith('meta[')
        ? [{ content: 'https://cdn.example/social.jpg' }]
        : []
    }
  });
  try {
    const result = imagePageQuickDiscovery();
    assert.equal(result.pageTitle, 'Article');
    assert.ok(result.candidates.some(candidate => candidate.url === 'https://cdn.example/hero-1600.jpg'));
    assert.ok(result.candidates.some(candidate => candidate.url === 'https://cdn.example/social.jpg'));
  } finally {
    if (priorDocument) Object.defineProperty(globalThis, 'document', priorDocument);
    else delete globalThis.document;
    if (priorLocation) Object.defineProperty(globalThis, 'location', priorLocation);
    else delete globalThis.location;
  }
});
