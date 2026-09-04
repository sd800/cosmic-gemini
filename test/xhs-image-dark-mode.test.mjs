import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

class SimpleEventTarget {
  constructor() { this.listeners = new Map(); }
  addEventListener(type, listener) {
    this.listeners.set(type, [...(this.listeners.get(type) || []), listener]);
  }
  removeEventListener(type, listener) {
    this.listeners.set(type, (this.listeners.get(type) || []).filter(item => item !== listener));
  }
  dispatchEvent(event) {
    for (const listener of this.listeners.get(event.type) || []) listener.call(this, event);
  }
}

async function runtimeFixture(document = {}, globals = {}) {
  const context = {
    window: new SimpleEventTarget(),
    document,
    location: { hostname: 'www.xiaohongshu.com' },
    CustomEvent: class { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } },
    Uint8Array, Map, Set, Symbol, JSON, Number, String, Math, Object, Promise,
    crypto: { getRandomValues: values => { values.fill(11); return values; } },
    ...globals
  };
  vm.createContext(context);
  const source = await readFile(new URL('../extension/content/xhs-image-dark-mode-runtime.js', import.meta.url), 'utf8');
  vm.runInContext(source, context);
  return context[Symbol.for('cosmic-gemini.xhs-image-dark-mode.runtime')];
}

function themeElement(attributes = {}, className = '') {
  return {
    className,
    getAttribute(name) { return attributes[name] ?? null; }
  };
}

function pixels(fill) {
  const data = new Uint8ClampedArray(64 * 64 * 4);
  for (let y = 0; y < 64; y += 1) {
    for (let x = 0; x < 64; x += 1) {
      const [r, g, b] = fill(x, y);
      const offset = (y * 64 + x) * 4;
      data.set([r, g, b, 255], offset);
    }
  }
  return data;
}

function documentPixels() {
  return pixels((x, y) => {
    const line = y % 8 >= 3 && y % 8 <= 4 && x > 3 && x < 60;
    return line ? [35, 35, 35] : [246, 243, 224];
  });
}

function photoPixels() {
  return pixels((x, y) => [
    35 + x * 3,
    45 + y * 3,
    190 - Math.floor((x + y) * 1.2)
  ]);
}

test('XHS Image Dark Mode adapts documents while preserving photographs', async () => {
  const runtime = await runtimeFixture();
  assert.equal(runtime.classifySample(documentPixels(), 64, 64).kind, 'light-theme');
  assert.equal(runtime.classifySample(photoPixels(), 64, 64).kind, 'photo');
  const emptyBrightCard = pixels((x, y) => [235 - Math.floor(y / 4), 237 - Math.floor(x / 4), 230]);
  assert.equal(runtime.classifySample(emptyBrightCard, 64, 64).kind, 'photo');
});

test('XHS Image Dark Mode leaves mixed photo and document images unchanged', async () => {
  const runtime = await runtimeFixture();
  const document = documentPixels();
  const photo = photoPixels();
  const mixed = new Uint8ClampedArray(document.length);
  const rowBytes = 64 * 4;
  mixed.set(photo.subarray(0, rowBytes * 32), 0);
  mixed.set(document.subarray(rowBytes * 32), rowBytes * 32);
  const result = runtime.classifySample(mixed, 64, 64);
  assert.equal(result.kind, 'photo');
});

test('XHS Image Dark Mode recognizes text cards with stable frames of different colors', async () => {
  const runtime = await runtimeFixture();
  for (const frame of [
    [245, 191, 221],
    [42, 96, 184],
    [45, 137, 91],
    [232, 164, 24],
    [121, 39, 74]
  ]) {
    const framedCard = pixels((x, y) => {
      const inside = x >= 7 && x <= 56 && y >= 11 && y <= 58;
      const text = inside && y >= 25 && y <= 42 && x >= 13 && x <= 49
        && ((y % 6 <= 1 && x % 5 !== 0) || (x % 11 <= 1 && y % 5 !== 0));
      if (text) return [38, 36, 34];
      return inside ? [252, 248, 244] : frame;
    });
    const result = runtime.classifySample(framedCard, 64, 64);
    assert.equal(result.kind, 'light-theme', JSON.stringify({ frame, result }));
    assert.equal(result.frameDetected, true);
    assert.equal(result.surfaceCount >= 2, true);
  }
});

test('uniform gray text cards use the black-background contrast treatment', async () => {
  const runtime = await runtimeFixture();
  const grayCard = pixels((x, y) => {
    const text = y >= 18 && y <= 47 && x >= 10 && x <= 52
      && ((y % 8 <= 2 && x % 6 !== 0) || (x % 13 <= 1 && y % 5 !== 0));
    const highlight = x >= 34 && x <= 45 && y >= 25 && y <= 31;
    if (highlight) return [82, 196, 46];
    return text ? [248, 248, 246] : [112, 112, 112];
  });
  const result = runtime.classifySample(grayCard, 64, 64);
  assert.equal(result.kind, 'gray-theme');
  const classes = new Set();
  const record = {
    image: { classList: { toggle(name, active) { active ? classes.add(name) : classes.delete(name); } } },
    button: null,
    result,
    darkened: true
  };
  runtime.updateRecordVisual(record);
  assert.equal(classes.has('cg-xhs-image-dark-mode-gray'), true);
  assert.equal(classes.has('cg-xhs-image-dark-mode'), false);
});

test('a stable frame does not make a photograph look like a text card', async () => {
  const runtime = await runtimeFixture();
  const framedPhoto = pixels((x, y) => {
    if (x < 6 || x > 57 || y < 6 || y > 57) return [48, 105, 186];
    return [
      24 + Math.round((x - 6) * 3.9),
      42 + Math.round((y - 6) * 3.6),
      202 - Math.round((x + y - 12) * 1.35)
    ];
  });
  assert.equal(runtime.classifySample(framedPhoto, 64, 64).kind, 'photo');
});

test('large foreground regions prevent light-background portraits from being transformed', async () => {
  const runtime = await runtimeFixture();
  const portrait = pixels((x, y) => (
    x >= 22 && x <= 42 && y >= 7 && y <= 57 ? [74, 52, 42] : [244, 242, 235]
  ));
  const result = runtime.classifySample(portrait, 64, 64);
  assert.equal(result.kind, 'photo');
  assert.equal(result.largestForegroundShare > 0.16, true);
});

test('each transformed image can switch independently between dark and light', async () => {
  const runtime = await runtimeFixture();
  const classes = new Set();
  const record = {
    image: { classList: { toggle(name, active) { active ? classes.add(name) : classes.delete(name); } } },
    button: null,
    darkened: true
  };
  runtime.updateRecordVisual(record);
  assert.equal(classes.has('cg-xhs-image-dark-mode'), true);
  record.darkened = false;
  runtime.updateRecordVisual(record);
  assert.equal(classes.has('cg-xhs-image-dark-mode'), false);
});

test('per-image controls are created only for images in an expanded post viewer', async () => {
  const runtime = await runtimeFixture();
  runtime.processing = true;
  runtime.clearVisual = () => {};
  runtime.updateRecordVisual = () => {};
  runtime.scheduleControlPositions = () => {};
  let created = 0;
  runtime.createControl = () => { created += 1; };
  const record = { image: { isConnected: true }, result: { kind: 'photo' }, darkened: true };
  runtime.viewerForImage = () => null;
  runtime.applyResult(record);
  assert.equal(created, 0);
  assert.equal(record.darkened, false);
  runtime.viewerForImage = () => ({});
  runtime.applyResult(record);
  assert.equal(created, 1);
});

test('the active expanded image control is positioned immediately left of the page count', async () => {
  const runtime = await runtimeFixture({}, { innerWidth: 1200, innerHeight: 800 });
  const fraction = { getBoundingClientRect: () => ({ left: 930, right: 974, top: 48, width: 44, height: 24 }) };
  const viewer = {
    querySelector(selector) {
      if (selector === '.fraction') return fraction;
      if (selector === '.note-slider, .media-container') return {};
      return null;
    }
  };
  const slide = { classList: { contains: name => name === 'swiper-slide-active' } };
  const image = {
    closest(selector) {
      if (selector === '#noteContainer') return viewer;
      if (selector === '.swiper-slide') return slide;
      return null;
    },
    getBoundingClientRect: () => ({ left: 250, top: 30, right: 980, bottom: 760 })
  };
  const placement = runtime.controlPlacement({ image });
  assert.equal(placement.left, 875);
  assert.equal(placement.top, 46.5);
  fraction.getBoundingClientRect = () => ({ left: 916, right: 974, top: 48, width: 58, height: 24 });
  assert.equal(runtime.controlPlacement({ image }).left, 875);
  slide.classList.contains = () => false;
  assert.equal(runtime.controlPlacement({ image }), null);
});

test('cross-origin XHS images are sampled through a CORS-enabled copy when the rendered image taints canvas', async () => {
  const runtime = await runtimeFixture();
  const rendered = {
    currentSrc: 'https://sns-webpic-qc.xhscdn.com/example.webp',
    naturalWidth: 640,
    naturalHeight: 853,
    referrerPolicy: ''
  };
  const corsCopy = { naturalWidth: 640, naturalHeight: 853 };
  const sample = { data: new Uint8ClampedArray(32 * 24 * 4), width: 24, height: 32 };
  const attempted = [];
  runtime.drawSample = image => {
    attempted.push(image);
    return image === corsCopy ? sample : null;
  };
  runtime.loadCorsImage = async (source, reference) => {
    assert.equal(source, rendered.currentSrc);
    assert.equal(reference, rendered);
    return corsCopy;
  };
  assert.equal(await runtime.sampleImage(rendered), sample);
  assert.deepEqual(attempted, [rendered, corsCopy]);
});

test('XHS CDN display variants share cached classification before an expanded image paints', async () => {
  const runtime = await runtimeFixture({}, { URL });
  const feed = 'https://sns-webpic-qc.xhscdn.com/hash/1040g2sg324example!nc_n_webp_mw_1';
  const expanded = 'https://sns-webpic-qc.xhscdn.com/another-hash/1040g2sg324example!nd_dft_wlteh_webp_3';
  assert.equal(runtime.cacheKey(feed), runtime.cacheKey(expanded));
  const result = { kind: 'light-theme' };
  runtime.cacheResult(feed, result);
  runtime.processing = true;
  let applied = false;
  runtime.applyResult = record => { applied = record.result === result; };
  const record = { image: { currentSrc: expanded }, source: '', result: null };
  assert.equal(runtime.applyCachedResult(record), true);
  assert.equal(record.source, expanded);
  assert.equal(applied, true);
});

test('feed and expanded images share classification through the post identity', async () => {
  const postId = '6a94ddaa000000000f03a800';
  const runtime = await runtimeFixture({}, {
    URL,
    location: {
      hostname: 'www.xiaohongshu.com',
      href: 'https://www.xiaohongshu.com/explore'
    }
  });
  runtime.openingPostId = postId;
  const anchor = { href: `https://www.xiaohongshu.com/explore/${postId}` };
  const feedImage = {
    closest(selector) { return selector.startsWith('a[') ? anchor : null; }
  };
  const slide = {
    getAttribute(name) { return name === 'data-swiper-slide-index' ? '0' : null; }
  };
  const expandedImage = {
    currentSrc: 'https://sns-webpic-qc.xhscdn.com/different/detail-resource!nd_dft_wlteh_webp_3',
    closest(selector) { return selector === '.swiper-slide' ? slide : null; }
  };
  const result = { kind: 'light-theme' };
  runtime.cacheResult('https://sns-webpic-qc.xhscdn.com/feed/cover-resource!nc_n_webp_mw_1', result, feedImage);
  assert.equal(runtime.cachedResult(expandedImage, expandedImage.currentSrc), result);
});

test('expanded images transform the slide background and image as one visual surface', async () => {
  const runtime = await runtimeFixture();
  const imageClasses = new Set();
  const slideClasses = new Set();
  const viewer = { querySelector: () => ({}) };
  const slide = {
    classList: {
      toggle(name, active) { active ? slideClasses.add(name) : slideClasses.delete(name); },
      remove(...names) { names.forEach(name => slideClasses.delete(name)); }
    },
    style: { setProperty() {}, removeProperty() {} }
  };
  const image = {
    closest(selector) {
      if (selector === '#noteContainer') return viewer;
      if (selector === '.swiper-slide') return slide;
      return null;
    },
    classList: {
      toggle(name, active) { active ? imageClasses.add(name) : imageClasses.delete(name); },
      remove(...names) { names.forEach(name => imageClasses.delete(name)); }
    }
  };
  runtime.updateRecordVisual({ image, result: { kind: 'light-theme' }, darkened: true, button: null });
  assert.equal(slideClasses.has('cg-xhs-image-dark-mode'), true);
  assert.equal(imageClasses.has('cg-xhs-image-dark-mode'), false);
});

test('XHS Image Dark Mode recognizes Dark Reader before sampling page colors', async () => {
  const root = themeElement({ 'data-darkreader-mode': 'dynamic', 'data-darkreader-scheme': 'dark' });
  const runtime = await runtimeFixture({
    documentElement: root,
    body: null,
    querySelector() { return null; }
  });
  assert.equal(runtime.explicitDarkMode(), true);
  assert.equal(runtime.detectDarkMode(), true);
});

test('Dark Reader lifecycle markers are authoritative without depending on rendered colors', async () => {
  const attributes = { 'data-darkreader-mode': 'dynamic' };
  const root = themeElement(attributes);
  const marker = { content: 'instance' };
  const document = {
    documentElement: root,
    body: null,
    querySelector(selector) { return selector === 'meta[name="darkreader"]' ? marker : null; },
    querySelectorAll() { return []; }
  };
  const runtime = await runtimeFixture(document);
  assert.equal(runtime.explicitDarkMode(), true);
  attributes['data-darkreader-scheme'] = 'dimmed';
  assert.equal(runtime.explicitDarkMode(), false);
});

test('rendered dark surfaces are detected through transparent page layers', async () => {
  const root = { ...themeElement(), parentElement: null, computed: { backgroundColor: 'rgb(18 19 22)', colorScheme: 'normal' } };
  const body = { ...themeElement(), parentElement: root, computed: { backgroundColor: 'rgba(0 0 0 / 0)', colorScheme: 'normal' } };
  const surface = {
    ...themeElement(),
    parentElement: body,
    computed: { backgroundColor: 'rgba(0 0 0 / 10%)', colorScheme: 'normal' },
    matches() { return false; }
  };
  const document = {
    documentElement: root,
    body,
    querySelector() { return null; },
    querySelectorAll() { return []; },
    elementsFromPoint() { return [surface]; }
  };
  const runtime = await runtimeFixture(document, {
    innerWidth: 1200,
    innerHeight: 800,
    getComputedStyle: element => element.computed
  });
  assert.equal(runtime.detectDarkMode(), true);
});

test('actual dark viewport surfaces take priority over conflicting theme metadata', async () => {
  const root = {
    ...themeElement({ 'data-darkreader-scheme': 'light' }),
    parentElement: null,
    computed: { backgroundColor: 'rgb(14 15 17)', colorScheme: 'normal', filter: 'none' }
  };
  const surface = {
    ...themeElement(),
    parentElement: root,
    computed: { backgroundColor: 'rgba(0 0 0 / 0)', colorScheme: 'normal', filter: 'none' },
    matches() { return false; }
  };
  const document = {
    documentElement: root,
    body: null,
    querySelector() { return null; },
    querySelectorAll() { return []; },
    elementsFromPoint() { return [surface]; }
  };
  const runtime = await runtimeFixture(document, {
    innerWidth: 1200,
    innerHeight: 800,
    getComputedStyle: element => element.computed
  });
  assert.equal(runtime.renderedPageWideDarkMode(), true);
  assert.equal(runtime.detectDarkMode(), true);
});

test('a page-wide inversion filter is treated as rendered dark mode', async () => {
  const root = {
    ...themeElement(),
    parentElement: null,
    computed: {
      backgroundColor: 'rgb(255 255 255)',
      colorScheme: 'normal',
      filter: 'invert(100%) hue-rotate(180deg)'
    }
  };
  const document = {
    documentElement: root,
    body: null,
    querySelector() { return null; },
    querySelectorAll() { return []; }
  };
  const runtime = await runtimeFixture(document, { getComputedStyle: element => element.computed });
  assert.equal(runtime.pageWideFilterDarkMode(), true);
  assert.equal(runtime.detectDarkMode(), true);
});

test('Dark Reader filter and static style engines are recognized', async () => {
  for (const mode of ['filter', 'static']) {
    const root = themeElement({ 'data-darkreader-mode': mode });
    const style = { disabled: false, media: 'screen' };
    const document = {
      documentElement: root,
      body: null,
      querySelector() { return null; },
      querySelectorAll() { return [style]; }
    };
    const runtime = await runtimeFixture(document);
    assert.equal(runtime.explicitDarkMode(), true);
  }
});

test('a dark color-scheme hint alone does not classify a light page as dark', async () => {
  const root = {
    ...themeElement(),
    parentElement: null,
    style: {},
    computed: { backgroundColor: 'rgb(250 250 250)', colorScheme: 'dark light' }
  };
  const document = {
    documentElement: root,
    body: null,
    querySelector() { return null; },
    querySelectorAll() { return []; }
  };
  const runtime = await runtimeFixture(document, { getComputedStyle: element => element.computed });
  assert.equal(runtime.detectDarkMode(), false);
});

test('the manual theme override starts image processing without a dark-page signal', async () => {
  const runtime = await runtimeFixture();
  let started = false;
  runtime.detectDarkMode = () => false;
  runtime.installThemeObserver = () => {};
  runtime.startProcessing = function startProcessing() {
    this.processing = true;
    started = true;
  };
  runtime.scheduleInitialThemeChecks = () => {};
  runtime.reportStatus = () => {};
  runtime.onConfigure({
    detail: JSON.stringify({
      token: runtime.token,
      config: { active: true, overrideDarkMode: true, showImageControl: true, controlOpacity: 0.5 }
    })
  });
  assert.equal(runtime.active, true);
  assert.equal(runtime.overrideDarkMode, true);
  assert.equal(runtime.darkModeDetected, false);
  assert.equal(runtime.processing, true);
  assert.equal(started, true);
});
