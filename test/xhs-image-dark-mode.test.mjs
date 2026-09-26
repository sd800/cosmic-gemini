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
  const source = await readFile(new URL('../extension/content/xhs-image-dark-mode/xhs-image-dark-mode-runtime.js', import.meta.url), 'utf8');
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

test('XHS Image Dark Mode recognizes extremely sparse text on a uniform white page', async () => {
  const runtime = await runtimeFixture();
  const textRuns = [
    [9, 8], [18, 8],
    [11, 19], [25, 19],
    [8, 31], [22, 31],
    [12, 45], [29, 45],
    [10, 55], [27, 55]
  ];
  const sparsePage = pixels((x, y) => {
    const text = textRuns.some(([startX, row]) => y === row && x >= startX && x < startX + 3);
    return text ? [20, 20, 20] : [255, 255, 255];
  });
  const result = runtime.classifySample(sparsePage, 64, 64);
  assert.equal(result.kind, 'light-theme', JSON.stringify(result));
  assert.equal(result.sparseTextForeground, true);
});

test('an isolated small subject on white is not treated as sparse text', async () => {
  const runtime = await runtimeFixture();
  const smallSubject = pixels((x, y) => {
    const subject = x >= 29 && x <= 33 && y >= 28 && y <= 33;
    return subject ? [25, 25, 25] : [255, 255, 255];
  });
  assert.equal(runtime.classifySample(smallSubject, 64, 64).kind, 'photo');
});

test('XHS Image Dark Mode recognizes sparse text slides with transparent reading surfaces', async () => {
  const runtime = await runtimeFixture();
  const data = new Uint8ClampedArray(64 * 64 * 4);
  for (let y = 0; y < 64; y += 1) {
    for (let x = 0; x < 64; x += 1) {
      const offset = (y * 64 + x) * 4;
      const text = y >= 9 && y <= 55 && x >= 7 && x <= 57
        && ((y % 11 <= 1 && x % 7 !== 0) || (x % 17 <= 1 && y % 5 !== 0));
      data.set(text ? [28, 28, 27, 255] : [0, 0, 0, 0], offset);
    }
  }
  const result = runtime.classifySample(data, 64, 64);
  assert.equal(result.kind, 'light-theme', JSON.stringify(result));
  assert.equal(result.transparencyShare > 0.5, true);
});

test('transparent isolated photo subjects remain unchanged', async () => {
  const runtime = await runtimeFixture();
  const data = new Uint8ClampedArray(64 * 64 * 4);
  for (let y = 0; y < 64; y += 1) {
    for (let x = 0; x < 64; x += 1) {
      const offset = (y * 64 + x) * 4;
      const subject = x >= 20 && x <= 43 && y >= 12 && y <= 53;
      data.set(subject
        ? [80 + x * 2, 45 + y * 2, 155 - Math.floor(y / 2), 255]
        : [0, 0, 0, 0], offset);
    }
  }
  assert.equal(runtime.classifySample(data, 64, 64).kind, 'photo');
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

test('XHS Image Dark Mode recognizes dark text on a lightly textured pastel surface', async () => {
  const runtime = await runtimeFixture();
  const texturedPastelCard = pixels((x, y) => {
    const text = x >= 7 && x <= 48 && y >= 17 && y <= 39
      && ((y % 8 <= 1 && x % 5 !== 0) || (x % 13 <= 1 && y % 4 !== 0));
    if (text) return [18, 54, 137];
    const texture = ((x * 11 + y * 17 + x * y * 3) % 27) - 13;
    return [
      Math.max(138, Math.min(188, 166 + texture)),
      Math.max(174, Math.min(222, 201 + texture)),
      Math.max(216, Math.min(252, 241 + Math.round(texture * 0.55)))
    ];
  });
  const result = runtime.classifySample(texturedPastelCard, 64, 64);
  assert.equal(result.kind, 'light-theme', JSON.stringify(result));
});

test('XHS Image Dark Mode recognizes text on a vivid uniform reading surface', async () => {
  const runtime = await runtimeFixture();
  const vividTextCard = pixels((x, y) => {
    const text = x >= 6 && x <= 55 && y >= 14 && y <= 45
      && ((y % 8 <= 2 && x % 6 !== 0) || (x % 12 <= 1 && y % 5 !== 0));
    const accent = x >= 42 && x <= 53 && y >= 50 && y <= 57 && (x % 5 <= 2 || y >= 55);
    if (text) return [67, 29, 13];
    if (accent) return [244, 126, 225];
    const texture = ((x * 7 + y * 11) % 9) - 4;
    return [250 + texture, 229 + texture, 106 + texture];
  });
  const result = runtime.classifySample(vividTextCard, 64, 64);
  assert.equal(result.kind, 'light-theme', JSON.stringify(result));
  assert.equal(result.foregroundComponentCount >= 3, true);
});

test('XHS Image Dark Mode recognizes light text on a vivid orange reading surface', async () => {
  const runtime = await runtimeFixture();
  const orangeTextCard = pixels((x, y) => {
    const text = [17, 25, 33, 41].some(row => y >= row && y <= row + 1
      && x >= 7 && x <= 56 && x % 9 !== 0);
    const smallHeading = x >= 25 && x <= 42 && y >= 4 && y <= 5 && x % 4 !== 0;
    const quote = y >= 50 && y <= 57
      && ((x >= 39 && x <= 43) || (x >= 48 && x <= 52))
      && (y <= 54 || x % 3 === 0);
    if (text || smallHeading) return [253, 250, 245];
    if (quote) return [247, 137, 225];
    return [255, 126, 76];
  });
  const result = runtime.classifySample(orangeTextCard, 64, 64);
  assert.equal(result.kind, 'light-theme', JSON.stringify(result));
  assert.equal(result.contrastForegroundShare >= 0.006, true);
  assert.equal(result.foregroundComponentCount >= 5, true);
});

test('XHS Image Dark Mode recognizes repeated bright chat bubbles as reading surfaces', async () => {
  const runtime = await runtimeFixture();
  const bubbles = [
    [29, 2, 62, 13],
    [24, 17, 58, 28],
    [30, 32, 62, 43],
    [22, 47, 58, 59]
  ];
  const chatScreenshot = pixels((x, y) => {
    const bubble = bubbles.find(([left, top, right, bottom]) => (
      x >= left && x <= right && y >= top && y <= bottom
    ));
    const whiteBubble = x >= 2 && x <= 24 && y >= 34 && y <= 45;
    const textArea = bubble || (whiteBubble ? [2, 34, 24, 45] : null);
    const text = textArea
      && y >= textArea[1] + 4 && y <= textArea[1] + 7
      && x >= textArea[0] + 4 && x <= textArea[2] - 3
      && x % 5 !== 0;
    if (text) return [24, 27, 25];
    if (bubble) return [143, 236, 94];
    if (whiteBubble) return [255, 255, 255];
    return [238, 238, 238];
  });
  const result = runtime.classifySample(chatScreenshot, 64, 64);
  assert.equal(result.kind, 'light-theme', JSON.stringify(result));
  assert.equal(result.conversationLayout, true);
});

test('a single bright object on a pale surface is not treated as a chat layout', async () => {
  const runtime = await runtimeFixture();
  const productPhoto = pixels((x, y) => {
    const object = x >= 18 && x <= 49 && y >= 10 && y <= 55;
    if (!object) return [238, 238, 238];
    return [143 + (x % 5) * 4, 220 + (y % 7) * 3, 82 + ((x + y) % 6) * 5];
  });
  const result = runtime.classifySample(productPhoto, 64, 64);
  assert.equal(result.kind, 'photo', JSON.stringify(result));
  assert.equal(result.conversationLayout, false);
});

test('an isolated bright subject on a vivid surface remains photographic content', async () => {
  const runtime = await runtimeFixture();
  const vividSubject = pixels((x, y) => {
    const subject = (x - 32) ** 2 + (y - 30) ** 2 <= 9 ** 2;
    return subject ? [250, 248, 242] : [255, 126, 76];
  });
  assert.equal(runtime.classifySample(vividSubject, 64, 64).kind, 'photo');
});

test('a vivid photographic layout is not treated as a text card', async () => {
  const runtime = await runtimeFixture();
  const vividLandscape = pixels((x, y) => {
    if (y < 42) return [244 - Math.floor(y / 8), 210 + Math.floor(x / 12), 62 + Math.floor(y / 3)];
    return [42 + Math.floor(x / 3), 117 + Math.floor((63 - x) / 4), 55 + Math.floor(y / 5)];
  });
  assert.equal(runtime.classifySample(vividLandscape, 64, 64).kind, 'photo');
});

test('XHS Image Dark Mode recognizes white text cards with bounded bright annotations', async () => {
  const runtime = await runtimeFixture();
  const annotatedTextCard = pixels((x, y) => {
    const highlight = x >= 5 && x <= 58 && y >= 7 && y <= 21;
    const text = x >= 8 && x <= 55 && y >= 10 && y <= 49
      && ((y % 8 <= 2 && x % 6 !== 0) || (x % 12 <= 1 && y % 5 !== 0));
    const coloredText = text && highlight && x >= 31 && x <= 44;
    const smallIllustration = x >= 46 && x <= 52 && y >= 43 && y <= 50;
    if (smallIllustration) return [239, 168, 157];
    if (coloredText) return [20, 162, 54];
    if (text) return [27, 27, 25];
    if (highlight) return [250, 231, 69];
    return [251, 250, 251];
  });
  const result = runtime.classifySample(annotatedTextCard, 64, 64);
  assert.equal(result.kind, 'light-theme', JSON.stringify(result));
  assert.equal(result.annotationShare >= 0.03, true);
});

test('a bright product on white remains photographic content', async () => {
  const runtime = await runtimeFixture();
  const productPhoto = pixels((x, y) => {
    const body = x >= 18 && x <= 46 && y >= 16 && y <= 51;
    const handle = x >= 25 && x <= 39 && y >= 9 && y <= 19;
    if (handle) return [55, 42, 22];
    if (body) return [246, 215 + Math.floor(x / 8), 54 + Math.floor(y / 5)];
    return [250, 250, 248];
  });
  assert.equal(runtime.classifySample(productPhoto, 64, 64).kind, 'photo');
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
  runtime.processing = true;
  runtime.clearVisual = () => {};
  runtime.viewerForImage = () => null;
  runtime.scheduleControlPositions = () => {};
  runtime.updateRecordVisual = () => {};
  const automaticRecord = { image: { isConnected: true }, result };
  runtime.applyResult(automaticRecord);
  assert.equal(automaticRecord.darkened, true);
});

test('split light and dark document panels are treated as one text layout', async () => {
  const runtime = await runtimeFixture();
  const splitDocument = pixels((x, y) => {
    const darkPanel = y >= 23 && y <= 46;
    const title = darkPanel && y >= 29 && y <= 39 && x >= 5 && x <= 58
      && ((y % 5 <= 1 && x % 6 !== 0) || (x % 13 <= 1 && y % 4 !== 0));
    const body = y >= 51 && y <= 57 && x >= 5 && x <= 58
      && ((y % 4 <= 1 && x % 7 !== 0) || x % 17 === 0);
    if (title) return [248, 220, 120];
    if (body) return [72, 72, 70];
    return darkPanel ? [30, 30, 30] : [250, 250, 248];
  });
  const result = runtime.classifySample(splitDocument, 64, 64);
  assert.equal(result.kind, 'light-theme', JSON.stringify(result));
  assert.equal(result.splitToneLayout, true);
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

test('image rendering follows its resolved dark-or-light state', async () => {
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

test('a post-wide long press alternates every image between light and dark modes', async () => {
  const runtime = await runtimeFixture();
  const viewer = {};
  const otherViewer = {};
  const makeRecord = (viewerOwner, kind, darkened) => ({
    image: { viewerOwner },
    button: null,
    result: { kind },
    darkened
  });
  const light = makeRecord(viewer, 'light-theme', true);
  const gray = makeRecord(viewer, 'gray-theme', true);
  const photo = makeRecord(viewer, 'photo', false);
  const feedCover = makeRecord(null, 'light-theme', true);
  feedCover.image.postKey = 'post-1';
  const unrelated = makeRecord(otherViewer, 'light-theme', true);
  for (const record of [light, gray, photo, feedCover, unrelated]) runtime.records.set(record.image, record);
  runtime.viewerForImage = image => image.viewerOwner;
  runtime.viewerPostKey = image => image.postKey || (image.viewerOwner === viewer ? 'post-1' : 'post-2');
  runtime.updateRecordVisual = () => {};
  runtime.syncInterventionStatus = () => {};

  runtime.togglePostOverride(light);
  assert.deepEqual([light.darkened, gray.darkened, photo.darkened, feedCover.darkened], [false, false, false, false]);
  assert.equal(unrelated.darkened, true);
  assert.equal(runtime.postOverride(light)?.postKey, 'post-1');
  assert.equal(runtime.postOverride(light)?.darkened, false);
  const lateImage = makeRecord(viewer, 'light-theme', true);
  lateImage.image.isConnected = true;
  runtime.records.set(lateImage.image, lateImage);
  runtime.processing = true;
  runtime.clearVisual = () => {};
  runtime.createControl = () => {};
  runtime.scheduleControlPositions = () => {};
  runtime.applyResult(lateImage);
  assert.equal(lateImage.darkened, false);

  runtime.togglePostOverride(light);
  assert.deepEqual([light.darkened, gray.darkened, photo.darkened, feedCover.darkened, lateImage.darkened], [true, true, true, true, true]);
  const latePhoto = makeRecord(viewer, 'photo', false);
  latePhoto.image.isConnected = true;
  runtime.records.set(latePhoto.image, latePhoto);
  runtime.applyResult(latePhoto);
  assert.equal(latePhoto.darkened, true);

  const reopenedViewer = {};
  const reopenedImage = makeRecord(reopenedViewer, 'light-theme', true);
  reopenedImage.image.postKey = 'post-1';
  assert.equal(runtime.postOverride(reopenedImage)?.postKey, 'post-1');
  assert.equal(runtime.postOverride(reopenedImage)?.darkened, true);

  runtime.restorePostAutomatic(light);
  assert.deepEqual(
    [light.darkened, gray.darkened, photo.darkened, feedCover.darkened, lateImage.darkened, latePhoto.darkened],
    [true, true, false, true, true, false]
  );
  assert.equal(runtime.postOverride(light), null);
});

test('the image control remains visible while a post-wide mode is active', async () => {
  const runtime = await runtimeFixture();
  runtime.showImageControl = true;
  runtime.postOverride = () => ({ postKey: 'post-1', darkened: true });
  const button = {
    hidden: false,
    style: {},
    setAttribute() {},
    innerHTML: '',
    title: ''
  };
  runtime.updateControl({ button, darkened: true });
  assert.equal(button.hidden, false);
});

test('a profile switch pauses classification and restores every post cover on that profile', async () => {
  const profileId = '669cf72a000000002401e0fc';
  const runtime = await runtimeFixture({}, {
    URL,
    location: {
      hostname: 'www.xiaohongshu.com',
      href: `https://www.xiaohongshu.com/user/profile/${profileId}`
    }
  });
  const cover = { profile: profileId };
  const otherCover = { profile: 'another-profile' };
  const record = { image: cover, profileKey: profileId, result: { kind: 'light-theme' }, darkened: true };
  const unrelated = { image: otherCover, profileKey: 'another-profile', result: { kind: 'light-theme' }, darkened: true };
  runtime.records.set(cover, record);
  runtime.records.set(otherCover, unrelated);
  const unobserved = [];
  const observed = [];
  runtime.intersectionObserver = {
    unobserve(image) { unobserved.push(image); },
    observe(image) { observed.push(image); }
  };
  runtime.removeQueuedImage = () => {};
  runtime.updateRecordVisual = () => {};
  runtime.updateControls = () => {};
  runtime.syncInterventionStatus = () => {};
  runtime.processing = false;

  runtime.toggleProfileDisabled();
  assert.equal(runtime.profileProcessingDisabled(record), true);
  assert.equal(record.darkened, false);
  assert.equal(unrelated.darkened, true);
  assert.deepEqual(unobserved, [cover]);

  runtime.openingProfileKey = profileId;
  runtime.openingPostId = 'post-from-profile';
  runtime.viewerForImage = () => ({});
  runtime.viewerPostKey = () => 'post-from-profile';
  assert.equal(runtime.profileProcessingDisabled({}), true);

  runtime.toggleProfileDisabled();
  assert.equal(runtime.profileProcessingDisabled(record), false);
  assert.equal(record.darkened, true);
  assert.deepEqual(observed, []);
});

test('holding the image control suppresses its following short-click action', async () => {
  let scheduled = null;
  const runtime = await runtimeFixture({}, {
    setTimeout(callback, delay) { scheduled = { callback, delay }; return 1; },
    clearTimeout() { scheduled = null; }
  });
  const button = new SimpleEventTarget();
  const record = { darkened: true };
  let held = 0;
  let clicked = 0;
  runtime.togglePostOverride = () => { held += 1; };
  runtime.activateImageControl = () => { clicked += 1; };
  runtime.bindControlGestures(button, record);
  const event = type => ({
    type,
    isPrimary: true,
    button: 0,
    clientX: 10,
    clientY: 10,
    preventDefault() {},
    stopPropagation() {}
  });
  button.dispatchEvent(event('pointerdown'));
  assert.equal(scheduled.delay, 550);
  scheduled.callback();
  button.dispatchEvent(event('pointerup'));
  button.dispatchEvent(event('click'));
  assert.equal(held, 1);
  assert.equal(clicked, 0);
  assert.equal(record.darkened, true);
  button.dispatchEvent(event('click'));
  assert.equal(clicked, 1);
  assert.equal(record.darkened, true);
});

test('a short click restores automatic recognition for the complete post', async () => {
  const runtime = await runtimeFixture();
  const button = new SimpleEventTarget();
  const record = { darkened: false };
  let restored = 0;
  runtime.postOverride = () => ({ darkened: false });
  runtime.restorePostAutomatic = () => { restored += 1; };
  runtime.bindControlGestures(button, record);
  button.dispatchEvent({
    type: 'click',
    preventDefault() {},
    stopPropagation() {}
  });
  assert.equal(record.darkened, false);
  assert.equal(restored, 1);
});

test('image controls isolate their complete pointer gesture from page carousel handlers', async () => {
  const runtime = await runtimeFixture({}, {
    setTimeout() { return 1; },
    clearTimeout() {}
  });
  const button = new SimpleEventTarget();
  runtime.bindControlGestures(button, { darkened: true });
  for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'contextmenu', 'click']) {
    let prevented = 0;
    let stopped = 0;
    button.dispatchEvent({
      type,
      isPrimary: true,
      button: 0,
      clientX: 10,
      clientY: 10,
      preventDefault() { prevented += 1; },
      stopPropagation() { stopped += 1; }
    });
    assert.equal(prevented > 0, true, type);
    assert.equal(stopped > 0, true, type);
  }
});

test('per-image controls are created for expanded post images and comment previews only', async () => {
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
  runtime.viewerForImage = () => null;
  runtime.commentImageKind = () => 'preview';
  record.commentKind = 'preview';
  runtime.applyResult(record);
  assert.equal(created, 2);
});

test('viewer overlays and banners are not treated as slide media', async () => {
  class FakeImage {}
  const runtime = await runtimeFixture({}, { HTMLImageElement: FakeImage });
  const viewer = { querySelector: () => ({}) };
  const slide = {};
  const mediaRoot = {
    matches: selector => selector === '.note-slider-img',
    querySelector: () => slideImage
  };
  const slideImage = Object.assign(new FakeImage(), {
    currentSrc: 'https://sns-webpic-qc.xhscdn.com/example/slide.webp',
    closest(selector) {
      if (selector === '#noteContainer') return viewer;
      if (selector === '.swiper-slide') return slide;
      if (selector === '.note-slider-img, .img-container') return mediaRoot;
      return null;
    }
  });
  const overlayImage = Object.assign(new FakeImage(), {
    currentSrc: 'https://sns-webpic-qc.xhscdn.com/example/viewer-badge.webp',
    clientWidth: 320,
    clientHeight: 180,
    closest(selector) { return selector === '#noteContainer' ? viewer : null; }
  });
  const nestedOverlayImage = Object.assign(new FakeImage(), {
    currentSrc: 'https://sns-webpic-qc.xhscdn.com/example/slide-notice.webp',
    closest(selector) {
      if (selector === '#noteContainer') return viewer;
      if (selector === '.swiper-slide') return slide;
      if (selector === '.note-slider-img, .img-container') return mediaRoot;
      return null;
    }
  });
  assert.equal(runtime.isContentImage(slideImage), true);
  assert.equal(runtime.viewerForImage(slideImage), viewer);
  assert.equal(runtime.isContentImage(overlayImage), false);
  assert.equal(runtime.viewerForImage(overlayImage), null);
  assert.equal(runtime.isContentImage(nestedOverlayImage), false);
  assert.equal(runtime.viewerForImage(nestedOverlayImage), null);
});

test('comment images become eligible only inside an expanded post', async () => {
  class FakeImage {}
  const runtime = await runtimeFixture({}, {
    HTMLImageElement: FakeImage,
    URL,
    location: {
      hostname: 'www.xiaohongshu.com',
      href: 'https://www.xiaohongshu.com/user/profile/profile-1'
    }
  });
  const note = { querySelector: () => ({}) };
  const comment = {};
  const image = Object.assign(new FakeImage(), {
    currentSrc: 'https://sns-webpic-qc.xhscdn.com/comment/comment-image!nc_n_webp_mw_1',
    clientWidth: 96,
    clientHeight: 96,
    closest(selector) {
      if (selector === '[data-comment-id], [class*="comment"], [id*="comment"]') return comment;
      if (selector === '#noteContainer, .note-container' || selector === '#noteContainer') return note;
      return null;
    }
  });
  assert.equal(runtime.isContentImage(image), true);
  assert.equal(runtime.commentImageKind(image), 'inline');
  assert.equal(runtime.viewerForImage(image), null);
  assert.equal(runtime.viewerPostKey(image), '');
  assert.equal(runtime.profileKeyForImage(image), '');
  image.closest = () => null;
  assert.equal(runtime.isContentImage(image), false);
});

test('comment preview copies are recognized even when they precede the thumbnail in DOM order', async () => {
  class FakeImage {}
  const runtime = await runtimeFixture({}, { HTMLImageElement: FakeImage, URL });
  runtime.processing = true;
  const source = 'https://sns-webpic-qc.xhscdn.com/comment/shared-image!nc_n_webp_mw_1';
  const note = { querySelector: () => ({}) };
  const thumbnail = Object.assign(new FakeImage(), {
    currentSrc: source,
    clientWidth: 88,
    clientHeight: 88,
    closest(selector) {
      if (selector === '[data-comment-id], [class*="comment"], [id*="comment"]') return {};
      if (selector === '#noteContainer, .note-container' || selector === '#noteContainer') return note;
      return null;
    }
  });
  const preview = Object.assign(new FakeImage(), {
    currentSrc: source.replace('!nc_n_webp_mw_1', '!nd_dft_wlteh_webp_3'),
    clientWidth: 720,
    clientHeight: 720,
    closest() { return null; }
  });
  const observed = [];
  runtime.observeImage = image => { observed.push(runtime.commentImageKind(image)); };
  runtime.collectImages({
    querySelectorAll(selector) { return selector === 'img' ? [preview, thumbnail] : []; },
    matches() { return false; },
    querySelector() { return null; }
  });
  assert.deepEqual(observed, ['preview', 'inline']);
  assert.equal(runtime.isContentImage(preview), true);
});

test('clicking a comment thumbnail associates a preview even when its resource URL changes', async () => {
  class FakeImage {}
  let images = [];
  const document = {
    querySelectorAll(selector) { return selector === 'img' ? images : []; }
  };
  const runtime = await runtimeFixture(document, {
    HTMLImageElement: FakeImage,
    URL,
    innerWidth: 1200,
    innerHeight: 800,
    setTimeout() { return 1; },
    clearTimeout() {}
  });
  runtime.processing = true;
  const note = { querySelector: () => ({}) };
  const thumbnail = Object.assign(new FakeImage(), {
    currentSrc: 'https://sns-webpic-qc.xhscdn.com/comment/thumb-source!nc_n_webp_mw_1',
    clientWidth: 150,
    clientHeight: 150,
    getBoundingClientRect: () => ({ left: 730, right: 880, top: 230, bottom: 380, width: 150, height: 150 }),
    closest(selector) {
      if (selector === '[data-comment-id], [class*="comment"], [id*="comment"]') return {};
      if (selector === '#noteContainer, .note-container' || selector === '#noteContainer') return note;
      return null;
    }
  });
  const preview = Object.assign(new FakeImage(), {
    currentSrc: 'blob:https://www.xiaohongshu.com/a-different-preview-resource',
    clientWidth: 640,
    clientHeight: 640,
    getBoundingClientRect: () => ({ left: 260, right: 900, top: 70, bottom: 710, width: 640, height: 640 }),
    closest(selector) { return selector.includes('[data-note-id]') ? {} : null; }
  });
  images = [thumbnail];
  const thumbnailOverlay = {
    matches(selector) { return selector.includes('comment'); },
    querySelectorAll(selector) { return selector === 'img' ? [thumbnail] : []; }
  };
  runtime.onPostActivation({
    clientX: 800,
    clientY: 300,
    composedPath: () => [thumbnailOverlay]
  });
  assert.equal(runtime.findPendingImagePreview(), null);
  images = [thumbnail, preview];
  const observed = [];
  runtime.observeImage = image => { observed.push(image); };
  runtime.scheduleControlPositions = () => {};
  assert.equal(runtime.findPendingImagePreview(), preview);
  assert.deepEqual(observed, [preview]);
  assert.equal(runtime.commentImageKind(preview), 'preview');
  assert.equal(runtime.isContentImage(preview), true);
});

test('an opened comment gallery recognizes a switched image and preloads its neighbors', async () => {
  const runtime = await runtimeFixture({}, { URL, innerWidth: 1200, innerHeight: 800 });
  runtime.processing = true;
  const bounds = { left: 300, right: 700, top: 100, bottom: 700, width: 400, height: 600 };
  const images = ['previous', 'current', 'next', 'later'].map((id, index) => ({
    id,
    src: `https://sns-webpic-qc.xhscdn.com/comment/${id}.webp`,
    naturalWidth: 400,
    naturalHeight: 600,
    visible: index === 1,
    closest() { return null; },
    checkVisibility() { return this.visible; },
    getBoundingClientRect() {
      return this.visible ? bounds
        : { left: 1400, right: 1800, top: 100, bottom: 700, width: 400, height: 600 };
    }
  }));
  const root = {
    isConnected: true,
    contains(image) { return images.includes(image); },
    querySelectorAll(selector) { return selector === 'img' ? images : []; }
  };
  runtime.imagePreviewRoot = root;
  runtime.imagePreviewBounds = bounds;
  runtime.imagePreviewImages.add(images[1]);
  runtime.records.set(images[1], {
    image: images[1], commentKind: 'preview', result: { kind: 'light-theme' },
    requestKey: runtime.imageRequestKey(images[1])
  });
  const queued = [];
  runtime.observeImage = image => {
    if (!runtime.records.has(image)) runtime.records.set(image, {
      image, commentKind: runtime.commentImageKind(image),
      result: null, requestKey: runtime.imageRequestKey(image)
    });
  };
  runtime.waitForImageLoad = (record, priority) => queued.push([record.image.id, priority]);
  runtime.scheduleControlPositions = () => {};

  runtime.scanImagePreviewGallery();
  assert.deepEqual(queued, [['previous', -10], ['next', -10]]);
  assert.equal(runtime.commentImageKind(images[0]), 'preview');
  assert.equal(runtime.commentImageKind(images[2]), 'preview');
  assert.equal(runtime.records.has(images[3]), false);

  images[1].visible = false;
  images[2].visible = true;
  runtime.records.get(images[2]).result = { kind: 'light-theme' };
  runtime.scanImagePreviewGallery();
  assert.deepEqual(queued.at(-1), ['later', -10]);
  assert.equal(runtime.commentImageKind(images[3]), 'preview');
});

test('a hidden image stays black regardless of the page or image mode', async () => {
  const runtime = await runtimeFixture();
  const classes = new Set();
  const target = {
    classList: { toggle(name, active) { active ? classes.add(name) : classes.delete(name); } },
    style: { setProperty() {} }
  };
  runtime.visualTarget = () => target;
  const record = { image: target, profileKey: '', result: { kind: 'light-theme' },
    darkened: false, concealed: true };
  runtime.darkModeDetected = true;
  runtime.updateRecordVisual(record, false);
  assert.equal(classes.has('cg-xhs-image-hidden-dark'), true);

  runtime.darkModeDetected = false;
  record.darkened = true;
  runtime.updateRecordVisual(record, false);
  assert.equal(classes.has('cg-xhs-image-hidden-dark'), true);
});

test('a comment preview control toggles only that preview between dark and light display', async () => {
  const runtime = await runtimeFixture();
  const button = new SimpleEventTarget();
  const image = {};
  const record = { image, result: { kind: 'light-theme' }, darkened: true };
  runtime.commentImageKind = candidate => candidate === image ? 'preview' : '';
  let updates = 0;
  runtime.updateRecordVisual = updated => {
    assert.equal(updated, record);
    updates += 1;
  };
  runtime.bindCommentControl(button, record);
  const click = () => button.dispatchEvent({
    type: 'click',
    preventDefault() {},
    stopPropagation() {}
  });
  click();
  assert.equal(record.darkened, false);
  click();
  assert.equal(record.darkened, true);
  assert.equal(updates, 2);
});

test('a comment preview shows its own control while the post image control stays hidden', async () => {
  let frame = null;
  const runtime = await runtimeFixture({}, {
    URL,
    innerWidth: 1200,
    innerHeight: 800,
    requestAnimationFrame(callback) { frame = callback; return 1; }
  });
  runtime.processing = true;
  const source = 'https://sns-webpic-qc.xhscdn.com/comment/preview-image!nc_n_webp_mw_1';
  runtime.commentImageKeys.add(runtime.cacheKey(source));
  const preview = {
    currentSrc: source,
    clientWidth: 640,
    clientHeight: 640,
    isConnected: true,
    closest() { return null; },
    getBoundingClientRect() {
      return { left: 250, right: 890, top: 60, bottom: 700, width: 640, height: 640 };
    }
  };
  const viewer = {};
  const mainImage = { isConnected: true };
  const controlled = { image: mainImage, commentKind: '', button: { style: {} } };
  const previewControl = {
    image: preview,
    commentKind: 'preview',
    result: { kind: 'photo' },
    button: { style: {} }
  };
  runtime.records.set(preview, previewControl);
  runtime.imagePreviewRecords.add(previewControl);
  runtime.viewerForImage = image => image === mainImage ? viewer : null;
  runtime.controlPlacement = record => record.image === preview
    ? { left: 850, top: 70 }
    : { left: 100, top: 40 };
  runtime.controlRecords.add(controlled);
  runtime.controlRecords.add(previewControl);
  runtime.scheduleControlPositions();
  frame();
  assert.equal(controlled.button.style.display, 'none');
  assert.equal(previewControl.button.style.display, 'grid');
  preview.isConnected = false;
  runtime.scheduleControlPositions();
  frame();
  assert.equal(controlled.button.style.display, 'grid');
  assert.equal(previewControl.button.style.display, 'none');
  preview.isConnected = true;
  preview.checkVisibility = () => false;
  runtime.scheduleControlPositions();
  frame();
  assert.equal(controlled.button.style.display, 'grid');
  assert.equal(previewControl.button.style.display, 'none');
});

test('ordinary control clicks never search the complete page for comment images', async () => {
  const runtime = await runtimeFixture({}, {
    URL, location: { href: 'https://www.xiaohongshu.com/explore/current-post' }
  });
  runtime.openingPostId = 'current-post';
  let suspensions = 0;
  runtime.suspendControlPositions = () => { suspensions += 1; };
  const ordinaryAncestor = {
    matches() { return false; },
    querySelectorAll() { throw new Error('ordinary ancestors must not be scanned'); }
  };
  runtime.onPostActivation({
    clientX: 100,
    clientY: 40,
    composedPath: () => [ordinaryAncestor]
  });
  assert.equal(suspensions, 0, 'a background click must not start the post-opening hide interval');
  assert.equal(runtime.openingPostId, 'current-post');
  for (const missing of [undefined, null, '', '   ']) assert.equal(runtime.noteId(missing), '');
  assert.equal(runtime.noteCacheKey({}), '', 'unrelated images must not inherit a fabricated post ID');
  assert.equal(runtime.noteId('/explore/another-post'), 'another-post');
});

test('a comment preview control is positioned inside the preview image corner', async () => {
  const runtime = await runtimeFixture({}, { URL, innerWidth: 1200, innerHeight: 800 });
  const source = 'https://sns-webpic-qc.xhscdn.com/comment/control-preview!nd_dft_wlteh_webp_3';
  runtime.commentImageKeys.add(runtime.cacheKey(source));
  const image = {
    currentSrc: source,
    clientWidth: 640,
    clientHeight: 640,
    closest() { return null; },
    getBoundingClientRect: () => ({ left: 250, right: 890, top: 60, bottom: 700, width: 640, height: 640 })
  };
  const placement = runtime.controlPlacement({ image });
  assert.equal(placement.left, 853);
  assert.equal(placement.top, 70);
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
  const mediaRoot = { matches: () => true, querySelector: () => image };
  const image = {
    closest(selector) {
      if (selector === '#noteContainer') return viewer;
      if (selector === '.swiper-slide') return slide;
      if (selector === '.note-slider-img, .img-container') return mediaRoot;
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

test('a low-detail CDN variant cannot suppress analysis of a sharper variant', async () => {
  const runtime = await runtimeFixture({}, { URL });
  const preview = 'https://sns-webpic-qc.xhscdn.com/hash/1040g2sg324example!nc_n_webp_mw_1';
  const expanded = 'https://sns-webpic-qc.xhscdn.com/hash/1040g2sg324example!nd_dft_wlteh_webp_3';
  runtime.cacheResult(preview, { kind: 'photo' });
  assert.equal(runtime.cachedResult(null, preview)?.kind, 'photo');
  assert.equal(runtime.cachedResult(null, expanded), null);
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

test('a negative feed-cover result never suppresses independent viewer analysis', async () => {
  const postId = '6a97d678000000001001f028';
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
  runtime.cacheResult('https://sns-webpic-qc.xhscdn.com/feed/cropped-cover!nc_n_webp_mw_1', {
    kind: 'photo'
  }, feedImage);
  const firstSlide = {
    getAttribute(name) { return name === 'data-swiper-slide-index' ? '0' : null; }
  };
  const expandedImage = {
    currentSrc: 'https://sns-webpic-qc.xhscdn.com/detail/full-first-slide!nd_dft_wlteh_webp_3',
    closest(selector) { return selector === '.swiper-slide' ? firstSlide : null; }
  };
  assert.equal(runtime.cachedResult(expandedImage, expandedImage.currentSrc), null);
});

test('a positive viewer result supersedes a stale exact feed-cover photo result', async () => {
  const postId = '6a97d678000000001001f028';
  const runtime = await runtimeFixture({}, {
    URL,
    location: {
      hostname: 'www.xiaohongshu.com',
      href: `https://www.xiaohongshu.com/explore/${postId}`
    }
  });
  const anchor = { href: `https://www.xiaohongshu.com/explore/${postId}` };
  const feedImage = {
    currentSrc: 'https://sns-webpic-qc.xhscdn.com/feed/cropped-cover!nc_n_webp_mw_1',
    closest(selector) { return selector.startsWith('a[') ? anchor : null; }
  };
  const slide = {
    getAttribute(name) { return name === 'data-swiper-slide-index' ? '0' : null; }
  };
  const expandedImage = {
    currentSrc: 'https://sns-webpic-qc.xhscdn.com/detail/full-first-slide!nd_dft_wlteh_webp_3',
    closest(selector) { return selector === '.swiper-slide' ? slide : null; }
  };
  runtime.cacheResult(feedImage.currentSrc, { kind: 'photo' }, feedImage);
  runtime.cacheResult(expandedImage.currentSrc, { kind: 'light-theme' }, expandedImage);
  assert.equal(runtime.cachedResult(feedImage, feedImage.currentSrc).kind, 'light-theme');
});

test('a positive first-slide viewer result refreshes an already mounted feed cover', async () => {
  const postId = '6aa1ff5a000000002b000927';
  const anchor = {
    href: `https://www.xiaohongshu.com/explore/${postId}`,
    matches: () => false,
    querySelectorAll: () => [feedImage]
  };
  const document = { querySelectorAll: () => [anchor] };
  const runtime = await runtimeFixture(document, {
    URL,
    location: {
      hostname: 'www.xiaohongshu.com',
      href: `https://www.xiaohongshu.com/explore/${postId}`
    }
  });
  const feedImage = {
    currentSrc: 'https://sns-webpic-qc.xhscdn.com/feed/cropped-cover!nc_n_webp_mw_1',
    isConnected: true,
    closest(selector) { return selector.startsWith('a[') ? anchor : null; }
  };
  const slide = {
    getAttribute(name) { return name === 'data-swiper-slide-index' ? '0' : null; }
  };
  const expandedImage = {
    currentSrc: 'https://sns-webpic-qc.xhscdn.com/detail/full-first-slide!nd_dft_wlteh_webp_3',
    closest(selector) { return selector === '.swiper-slide' ? slide : null; }
  };
  runtime.processing = true;
  runtime.isContentImage = () => true;
  runtime.viewerForImage = image => image === expandedImage ? {} : null;
  runtime.cacheResult(feedImage.currentSrc, { kind: 'photo' }, feedImage);
  let applied = null;
  runtime.applyResult = record => { applied = record; };
  const result = { kind: 'light-theme' };
  runtime.cacheResult(expandedImage.currentSrc, result, expandedImage);
  assert.equal(applied?.image, feedImage);
  assert.equal(applied?.result, result);
});

test('viewer classifications remain isolated between slide indexes', async () => {
  const postId = '6a97d678000000001001f028';
  const runtime = await runtimeFixture({}, {
    URL,
    location: {
      hostname: 'www.xiaohongshu.com',
      href: `https://www.xiaohongshu.com/explore/${postId}`
    }
  });
  const imageForSlide = index => ({
    currentSrc: `https://sns-webpic-qc.xhscdn.com/detail/slide-${index}!nd_dft_wlteh_webp_3`,
    closest(selector) {
      return selector === '.swiper-slide'
        ? { getAttribute: name => name === 'data-swiper-slide-index' ? String(index) : null }
        : null;
    }
  });
  const first = imageForSlide(0);
  const second = imageForSlide(1);
  runtime.cacheResult(first.currentSrc, { kind: 'photo' }, first);
  assert.equal(runtime.cachedResult(second, second.currentSrc), null);
  runtime.cacheResult(second.currentSrc, { kind: 'light-theme' }, second);
  assert.equal(runtime.cachedResult(second, second.currentSrc).kind, 'light-theme');
});

test('lazy images wait for load without occupying an analysis slot', async () => {
  const runtime = await runtimeFixture({}, { performance: { now: () => 10 } });
  runtime.processing = true;
  runtime.isContentImage = () => true;
  runtime.schedulePump = () => {};
  let onLoad = null;
  const image = {
    currentSrc: 'https://sns-webpic-qc.xhscdn.com/lazy/image!nc_n_webp_mw_1',
    complete: false,
    naturalWidth: 0,
    addEventListener(type, listener) {
      if (type === 'load') onLoad = listener;
    }
  };
  const record = {
    image,
    source: '',
    result: null,
    loadSource: '',
    loadPriority: Number.POSITIVE_INFINITY,
    loadGeneration: 0
  };
  runtime.records.set(image, record);
  runtime.queueImage(image, -15);
  assert.equal(runtime.queue.length, 0);
  assert.equal(runtime.running, 0);
  assert.equal(typeof onLoad, 'function');
  image.complete = true;
  image.naturalWidth = 640;
  onLoad();
  assert.equal(runtime.queue.length, 1);
  assert.equal(runtime.queue[0].priority, -15);
});

test('decoded images inserted by the expanded viewer are queued immediately', async () => {
  class FakeImage {}
  const runtime = await runtimeFixture({}, {
    HTMLImageElement: FakeImage,
    performance: { now: () => 11 }
  });
  runtime.processing = true;
  runtime.isContentImage = () => true;
  runtime.viewerForImage = () => ({});
  runtime.applyCachedResult = () => false;
  runtime.schedulePump = () => {};
  const image = new FakeImage();
  Object.assign(image, {
    currentSrc: 'https://sns-webpic-qc.xhscdn.com/detail/decoded-slide',
    src: 'https://sns-webpic-qc.xhscdn.com/detail/decoded-slide',
    srcset: '',
    complete: true,
    naturalWidth: 1080,
    naturalHeight: 1620,
    getAttribute(name) { return name === 'src' ? this.src : ''; }
  });
  runtime.observeImage(image);
  assert.equal(runtime.queue.length, 1);
  assert.equal(runtime.queue[0].image, image);
  assert.equal(runtime.queue[0].priority, -20);
});

test('responsive source mutations are routed back to their owning viewer image', async () => {
  const runtime = await runtimeFixture();
  runtime.processing = true;
  runtime.viewerForImage = () => ({});
  runtime.scheduleControlPositions = () => {};
  runtime.scheduleCleanup = () => {};
  runtime.applyCachedResult = () => false;
  let waited = null;
  runtime.waitForImageLoad = (record, priority) => { waited = { record, priority }; };
  const source = {
    value: 'slide-2 1080w',
    matches(selector) { return selector === 'source'; },
    getAttribute(name) { return name === 'srcset' ? this.value : ''; }
  };
  const picture = {
    matches(selector) { return selector === 'picture'; },
    querySelector(selector) { return selector === 'img' ? image : null; },
    querySelectorAll(selector) { return selector === 'source' ? [source] : []; }
  };
  source.closest = selector => selector === 'picture' ? picture : null;
  const image = {
    currentSrc: 'https://sns-webpic-qc.xhscdn.com/detail/slide-1',
    src: 'https://sns-webpic-qc.xhscdn.com/detail/slide-1',
    srcset: '',
    parentElement: picture,
    classList: { remove() {} },
    getAttribute(name) { return name === 'src' ? this.src : ''; }
  };
  const record = {
    image,
    requestKey: runtime.imageRequestKey(image),
    source: image.currentSrc,
    result: { kind: 'photo' },
    loadGeneration: 0,
    loadPriority: Number.POSITIVE_INFINITY,
    loadSource: '',
    button: null,
    visualTarget: null
  };
  runtime.records.set(image, record);
  source.value = 'slide-3 1080w';
  runtime.onPageMutations([{ type: 'attributes', target: source, attributeName: 'srcset' }]);
  assert.equal(waited?.record, record);
  assert.equal(waited?.priority, -20);
  assert.equal(record.source, image.currentSrc);
  assert.equal(record.result?.kind, 'photo');
});

test('an intersecting image can move ahead in the pending analysis queue', async () => {
  const runtime = await runtimeFixture({}, { performance: { now: () => 20 } });
  runtime.processing = true;
  runtime.isContentImage = () => true;
  runtime.schedulePump = () => {};
  const image = {
    currentSrc: 'https://sns-webpic-qc.xhscdn.com/loaded/image!nc_n_webp_mw_1',
    complete: true,
    naturalWidth: 640
  };
  runtime.records.set(image, { image, source: '', result: null });
  runtime.queueImage(image, 6);
  runtime.queueImage(image, -15);
  assert.equal(runtime.queue.length, 1);
  assert.equal(runtime.queue[0].priority, -15);
});

test('viewer source changes are followed even while currentSrc still reports the previous slide', async () => {
  const runtime = await runtimeFixture();
  runtime.processing = true;
  runtime.scheduleControlPositions = () => {};
  runtime.scheduleCleanup = () => {};
  runtime.applyCachedResult = () => false;
  runtime.viewerForImage = () => ({});
  const queued = [];
  runtime.queueImage = (image, priority) => queued.push({ image, priority });
  let sourceAttribute = 'https://sns-webpic-qc.xhscdn.com/detail/slide-1';
  let onLoad = null;
  const image = {
    currentSrc: 'https://sns-webpic-qc.xhscdn.com/detail/slide-1',
    src: sourceAttribute,
    srcset: '',
    complete: true,
    naturalWidth: 640,
    classList: { remove() {} },
    getAttribute(name) { return name === 'src' ? sourceAttribute : ''; },
    addEventListener(type, listener) { if (type === 'load') onLoad = listener; }
  };
  const record = {
    image,
    requestKey: runtime.imageRequestKey(image),
    source: image.currentSrc,
    result: { kind: 'photo' },
    loadGeneration: 0,
    loadPriority: Number.POSITIVE_INFINITY,
    loadSource: '',
    button: null,
    visualTarget: null
  };
  runtime.records.set(image, record);
  sourceAttribute = 'https://sns-webpic-qc.xhscdn.com/detail/slide-2';
  image.src = sourceAttribute;
  runtime.onPageMutations([{ type: 'attributes', target: image, attributeName: 'src' }]);
  assert.equal(typeof onLoad, 'function');
  assert.equal(queued.length, 0);
  image.currentSrc = sourceAttribute;
  onLoad();
  assert.equal(queued.some(task => task.image === image && task.priority === -20), true);
});

test('completed feed photographs release their record and intersection observation', async () => {
  const runtime = await runtimeFixture();
  runtime.processing = true;
  const unobserved = [];
  runtime.intersectionObserver = { unobserve: image => unobserved.push(image) };
  runtime.viewerForImage = () => null;
  runtime.scheduleControlPositions = () => {};
  const classes = new Set();
  const image = {
    isConnected: true,
    closest: () => null,
    classList: {
      toggle(name, enabled) { enabled ? classes.add(name) : classes.delete(name); },
      remove(...names) { names.forEach(name => classes.delete(name)); }
    },
    style: { setProperty() {}, removeProperty() {} }
  };
  const record = {
    image,
    button: null,
    darkened: false,
    result: { kind: 'photo' },
    loadGeneration: 0,
    loadHandler: null,
    visualTarget: null
  };
  runtime.records.set(image, record);
  runtime.applyResult(record);
  assert.equal(runtime.records.has(image), false);
  assert.equal(unobserved.includes(image), true);
  assert.equal(classes.size, 0);
});

test('control positioning visits only records that own viewer controls', async () => {
  let frame = null;
  const runtime = await runtimeFixture({}, {
    requestAnimationFrame(callback) { frame = callback; return 1; }
  });
  runtime.processing = true;
  let placements = 0;
  runtime.viewerForImage = () => ({});
  runtime.controlPlacement = () => { placements += 1; return null; };
  const passive = { image: { isConnected: true }, button: null };
  const controlled = {
    image: { isConnected: true },
    button: { style: {} }
  };
  runtime.records.set(passive.image, passive);
  runtime.records.set(controlled.image, controlled);
  runtime.controlRecords.add(controlled);
  runtime.scheduleControlPositions();
  frame();
  assert.equal(placements, 1);
});

test('feed additions do not schedule a full record cleanup until nodes are removed', async () => {
  const runtime = await runtimeFixture({}, { Node: { ELEMENT_NODE: 1 } });
  runtime.processing = true;
  runtime.collectImages = () => {};
  let cleanups = 0;
  runtime.scheduleCleanup = () => { cleanups += 1; };
  runtime.onPageMutations([{
    type: 'childList',
    addedNodes: [{ nodeType: 1 }],
    removedNodes: []
  }]);
  assert.equal(cleanups, 0);
  runtime.onPageMutations([{
    type: 'childList',
    addedNodes: [],
    removedNodes: [{}]
  }]);
  assert.equal(cleanups, 1);
});

test('comment pre-registration stays scoped to expanded post content', async () => {
  class FakeImage {}
  const runtime = await runtimeFixture({}, { HTMLImageElement: FakeImage });
  runtime.processing = true;
  const image = Object.assign(new FakeImage(), { closest: () => null });
  let remembered = 0;
  runtime.rememberCommentImage = () => { remembered += 1; };
  runtime.observeImage = () => {};
  const root = {
    matches: () => false,
    closest: () => null,
    querySelector: () => null,
    querySelectorAll: selector => selector === 'img' ? [image] : []
  };
  runtime.collectImages(root);
  assert.equal(remembered, 0);
  root.matches = selector => selector === '#noteContainer, .note-container';
  runtime.collectImages(root);
  assert.equal(remembered, 1);
});

test('image registration computes comment context only once', async () => {
  class FakeImage {}
  const runtime = await runtimeFixture({}, { HTMLImageElement: FakeImage, URL });
  runtime.processing = true;
  runtime.applyCachedResult = () => true;
  let classifications = 0;
  runtime.commentImageKind = () => { classifications += 1; return ''; };
  const image = Object.assign(new FakeImage(), {
    currentSrc: 'https://sns-webpic-qc.xhscdn.com/feed/performance-cover',
    src: 'https://sns-webpic-qc.xhscdn.com/feed/performance-cover',
    srcset: '',
    sizes: '',
    closest: () => null,
    hasAttribute: name => name === 'data-xhs-img',
    getAttribute(name) { return name === 'src' ? this.src : ''; }
  });
  runtime.observeImage(image);
  assert.equal(classifications, 1);
  assert.equal(runtime.records.get(image)?.commentKind, '');
});

test('comment-preview lookup uses its dedicated record index', async () => {
  const runtime = await runtimeFixture();
  runtime.commentImageKind = () => { throw new Error('all image records must not be reclassified'); };
  runtime.visibleImageRect = () => ({ width: 320, height: 320 });
  for (let index = 0; index < 3; index += 1) {
    const image = { isConnected: true };
    runtime.records.set(image, { image, commentKind: '' });
  }
  const preview = { image: { isConnected: true }, commentKind: 'preview' };
  runtime.records.set(preview.image, preview);
  runtime.imagePreviewRecords.add(preview);
  assert.equal(runtime.activeImagePreviewRecord(), preview);
});

test('profile controls are not rewritten for unrelated mutations on the same profile', async () => {
  const location = {
    hostname: 'www.xiaohongshu.com',
    href: 'https://www.xiaohongshu.com/user/profile/profile-one'
  };
  const runtime = await runtimeFixture({}, { URL, location });
  runtime.controlLayer = {};
  runtime.profileControl = { isConnected: true };
  runtime.profileControlKey = 'profile-one';
  runtime.profileControlUrl = location.href;
  let updates = 0;
  runtime.updateProfileControl = () => { updates += 1; };
  runtime.syncProfileControl();
  assert.equal(updates, 0);
  location.href = 'https://www.xiaohongshu.com/user/profile/profile-two';
  runtime.syncProfileControl();
  assert.equal(updates, 1);
  assert.equal(runtime.profileControlKey, 'profile-two');
});

test('records with an empty stored profile key avoid repeated profile discovery', async () => {
  const runtime = await runtimeFixture();
  runtime.profileKeyForImage = () => { throw new Error('stored record metadata should be used'); };
  assert.equal(runtime.profileProcessingDisabled({ image: {}, profileKey: '' }), false);
});

test('only one image control is displayed for a viewer at a time', async () => {
  let frame = null;
  const runtime = await runtimeFixture({}, {
    requestAnimationFrame(callback) { frame = callback; return 1; }
  });
  runtime.processing = true;
  const viewer = {};
  runtime.viewerForImage = () => viewer;
  runtime.controlPlacement = () => ({ left: 100, top: 40 });
  const first = { image: { isConnected: true }, button: { style: {} } };
  const second = { image: { isConnected: true }, button: { style: {} } };
  runtime.controlRecords.add(first);
  runtime.controlRecords.add(second);
  runtime.scheduleControlPositions();
  frame();
  assert.equal(first.button.style.display, 'grid');
  assert.equal(second.button.style.display, 'none');
});

test('feed scrolling has no viewport listener until an expanded-view control needs positioning', async () => {
  const windowTarget = new SimpleEventTarget();
  const documentTarget = new SimpleEventTarget();
  const runtime = await runtimeFixture(documentTarget, { window: windowTarget });
  assert.equal(windowTarget.listeners.get('scroll')?.length || 0, 0);
  assert.equal(windowTarget.listeners.get('resize')?.length || 0, 0);
  assert.equal(documentTarget.listeners.get('transitionrun')?.length || 0, 0);
  runtime.startControlPositionTracking();
  assert.equal(windowTarget.listeners.get('scroll')?.length, 1);
  assert.equal(windowTarget.listeners.get('resize')?.length, 1);
  assert.equal(documentTarget.listeners.get('transitionrun')?.length, 1);
  runtime.stopControlPositionTracking();
  assert.equal(windowTarget.listeners.get('scroll')?.length, 0);
  assert.equal(windowTarget.listeners.get('resize')?.length, 0);
  assert.equal(documentTarget.listeners.get('transitionrun')?.length, 0);
});

test('unrelated viewer animations do not hide or cancel the image control', async () => {
  const runtime = await runtimeFixture();
  runtime.processing = true;
  runtime.viewerRoot = {};
  let suspensions = 0;
  let positions = 0;
  runtime.suspendControlPositions = () => { suspensions += 1; };
  runtime.scheduleControlPositions = () => { positions += 1; };
  const image = { isConnected: true };
  const control = { image, button: { style: { display: 'grid' } } };
  runtime.controlRecords.add(control);
  const inactiveImage = { isConnected: true };
  runtime.controlRecords.add({ image: inactiveImage, button: { style: { display: 'none' } } });
  const unrelated = { contains: () => false };
  const ancestor = { contains: node => node === image };
  runtime.onControlMotion({ type: 'transitionrun', propertyName: 'transform', target: unrelated });
  runtime.onControlMotion({ type: 'transitionrun', propertyName: 'transform', target: inactiveImage });
  runtime.onControlMotion({ type: 'transitionrun', propertyName: 'opacity', target: ancestor });
  ancestor.getAnimations = () => [{ playState: 'running', effect: {
    getTiming: () => ({ iterations: Infinity }), getKeyframes: () => [{ transform: 'scale(1.1)' }]
  } }];
  runtime.onControlMotion({ type: 'animationstart', target: ancestor });
  assert.equal(suspensions, 0);
  runtime.onControlMotion({ type: 'transitionrun', propertyName: 'transform', target: ancestor });
  assert.equal(suspensions, 1, 'a real image-position transition is still concealed');
  control.button.style.display = 'none';
  runtime.onControlMotion({ type: 'transitionend', propertyName: 'transform', target: ancestor });
  assert.equal(positions, 1, 'transition completion repositions even when the control was hidden');
});

test('inactive image resizes and perpetual or opacity animations do not unset a usable control', async () => {
  const runtime = await runtimeFixture({ body: {} });
  let suspensions = 0;
  let positions = 0;
  runtime.suspendControlPositions = () => { suspensions += 1; };
  runtime.scheduleControlPositions = () => { positions += 1; };
  const image = { isConnected: true };
  const record = { image, button: { style: { display: 'none' } }, controlImageSize: { width: 200, height: 200 } };
  runtime.records.set(image, record);
  runtime.onControlResize([{ target: image, contentRect: { width: 240, height: 240 } }]);
  assert.equal(suspensions, 0);
  assert.equal(positions, 1);
  record.button.style.display = 'grid';
  runtime.onControlResize([{ target: image, contentRect: { width: 250, height: 250 } }]);
  assert.equal(suspensions, 1);
  const animation = (frames, iterations = 1) => ({
    playState: 'running', effect: { getTiming: () => ({ iterations }), getKeyframes: () => frames }
  });
  image.getAnimations = () => [animation([{ opacity: 0 }, { opacity: 1 }]),
    animation([{ transform: 'scale(1)' }, { transform: 'scale(1.1)' }], Infinity)];
  assert.equal(runtime.hasControlMotion(record), false);
  image.getAnimations = () => [animation([{ transform: 'scale(1)' }, { transform: 'scale(1.1)' }])];
  assert.equal(runtime.hasControlMotion(record), true);
});

test('expanded images transform the slide background and image as one visual surface', async () => {
  const runtime = await runtimeFixture();
  const imageClasses = new Set();
  const slideClasses = new Set();
  const viewer = { querySelector: () => ({}) };
  const mediaRoot = { matches: () => true, querySelector: () => image };
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
      if (selector === '.note-slider-img, .img-container') return mediaRoot;
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

test('Xiaohongshu native dark marker is recognized as page-wide dark mode', async () => {
  const root = {
    ...themeElement(),
    hasAttribute(name) { return name === 'dark'; }
  };
  const runtime = await runtimeFixture({
    documentElement: root,
    body: null,
    querySelector() { return null; },
    querySelectorAll() { return []; }
  });
  assert.equal(runtime.explicitDarkMode(), true);
  assert.equal(runtime.detectDarkMode(), true);
});

test('profile post covers are accepted before their initial layout has dimensions', async () => {
  class FakeImage {}
  const runtime = await runtimeFixture({}, { HTMLImageElement: FakeImage });
  const image = new FakeImage();
  Object.assign(image, {
    currentSrc: 'https://sns-webpic-qc.xhscdn.com/example/post-cover!nc_n_nwebp_mw_1',
    clientWidth: 0,
    clientHeight: 0,
    naturalWidth: 0,
    naturalHeight: 0,
    matches() { return false; },
    hasAttribute(name) { return name === 'data-xhs-img'; },
    getAttribute(name) { return name === 'elementtiming' ? 'card-exposed' : null; },
    closest(selector) {
      if (selector === '[class*="avatar"], a[href^="/user/profile/"]') return { className: 'profile-link' };
      if (selector.includes('section.note-item')) return {};
      return null;
    }
  });
  assert.equal(runtime.isContentImage(image), true);
});

test('runtime status reports carry a monotonic sequence', async () => {
  const windowTarget = new SimpleEventTarget();
  const reports = [];
  windowTarget.addEventListener('cosmic-gemini:xhs-image-dark-mode:status', event => {
    reports.push(JSON.parse(event.detail).status);
  });
  const runtime = await runtimeFixture({}, { window: windowTarget });
  runtime.active = true;
  runtime.processing = true;
  runtime.intervened = true;
  runtime.darkModeDetected = true;
  runtime.reportStatus();
  runtime.processing = false;
  runtime.reportStatus();
  assert.deepEqual(reports.map(report => report.sequence), [1, 2]);
  assert.equal(reports[0].processing, true);
  assert.equal(reports[0].intervened, true);
  assert.equal(reports[1].processing, false);
  assert.equal(reports[1].intervened, false);
});

test('runtime intervention status follows transformed images rather than eligibility alone', async () => {
  const windowTarget = new SimpleEventTarget();
  const reports = [];
  windowTarget.addEventListener('cosmic-gemini:xhs-image-dark-mode:status', event => {
    reports.push(JSON.parse(event.detail).status);
  });
  const runtime = await runtimeFixture({}, { window: windowTarget });
  runtime.active = true;
  runtime.processing = true;
  const classes = new Set();
  const record = {
    image: {
      classList: { toggle(name, active) { active ? classes.add(name) : classes.delete(name); } },
      style: { setProperty() {} }
    },
    button: null,
    result: { kind: 'light-theme' },
    darkened: true
  };
  runtime.updateRecordVisual(record);
  assert.equal(runtime.intervened, true);
  assert.equal(reports.at(-1).intervened, true);
  record.darkened = false;
  runtime.updateRecordVisual(record);
  assert.equal(runtime.intervened, false);
  assert.equal(reports.at(-1).intervened, false);
  record.result = { kind: 'photo' };
  record.darkened = true;
  runtime.updateRecordVisual(record);
  assert.equal(runtime.intervened, true);
  assert.equal(reports.at(-1).intervened, true);
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

test('image choices survive late classification while all-post commands reset individual choices', async () => {
  const runtime = await runtimeFixture();
  runtime.processing = true;
  runtime.viewerPostKey = image => image.post;
  runtime.viewerForImage = () => ({});
  runtime.createControl = runtime.clearVisual = runtime.updateRecordVisual = runtime.scheduleControlPositions = () => {};
  const image = { post: 'one', isConnected: true };
  const record = { image, darkened: false, result: { kind: 'light-theme' } };
  runtime.records.set(image, record);
  runtime.setPostMode(record, 'light');
  runtime.setImageMode(record, 'dark');
  runtime.applyResult(record);
  assert.equal(record.darkened, true);
  runtime.setImageMode(record, 'auto');
  assert.equal(record.darkened, true);
  runtime.setPostMode(record, 'light');
  assert.equal(record.imageMode, null);
  assert.equal(record.darkened, false);
  runtime.activateImageControl(record);
  assert.equal(runtime.postOverride(record), null);
  assert.equal(record.darkened, true);
  runtime.activateImageControl(record);
  assert.equal(record.darkened, false);
  runtime.applyResult(record);
  assert.equal(record.darkened, false);
});

test('all-image hiding follows the post identity, excludes comments, and is restored by mode commands', async () => {
  const runtime = await runtimeFixture();
  runtime.viewerPostKey = image => image.post || '';
  runtime.updateRecordVisual = runtime.syncInterventionStatus = () => {};
  const current = { image: { post: 'one' }, darkened: true };
  const cover = { image: { post: 'one' }, darkened: false };
  const other = { image: { post: 'two' }, darkened: false };
  const comment = { image: {}, commentKind: 'preview', darkened: false };
  for (const record of [current, cover, other, comment]) runtime.records.set(record.image, record);
  runtime.concealPost(current);
  assert.equal(runtime.resolvedConcealed(current), true);
  assert.equal(runtime.resolvedConcealed(cover), true);
  assert.equal(runtime.resolvedConcealed(other), false);
  assert.equal(runtime.resolvedConcealed(comment), false);
  assert.equal(runtime.resolvedConcealed({ image: { post: 'one' } }), true, 'reopened post inherits hiding');
  runtime.setImageMode(current, 'light');
  assert.equal(runtime.resolvedConcealed(current), false);
  assert.equal(runtime.resolvedConcealed(cover), true);
  runtime.setPostMode(current, 'auto');
  assert.equal(runtime.resolvedConcealed(cover), false);
});

test('a hidden image uses the switch icon and a click restores only the hidden scope', async () => {
  const runtime = await runtimeFixture();
  runtime.viewerPostKey = image => image.post || '';
  runtime.viewerForImage = image => image.post ? {} : null;
  runtime.updateRecordVisual = runtime.syncInterventionStatus = () => {};
  const button = { style: {}, innerHTML: '', title: '', setAttribute() {} };
  const current = { image: { post: 'one', isConnected: true }, button, commentKind: '',
    result: { kind: 'light-theme' }, darkened: true };
  const other = { image: { post: 'one', isConnected: true }, commentKind: '',
    result: { kind: 'light-theme' }, darkened: true };
  runtime.records.set(current.image, current);
  runtime.records.set(other.image, other);
  runtime.postOverrides.set('one', true);

  runtime.concealPost(current);
  runtime.updateControl(current);
  assert.match(button.innerHTML, /<rect x="3" y="7"/);
  assert.match(button.title, /restore every image/);
  runtime.activateImageControl(current);
  assert.equal(runtime.resolvedConcealed(current), false);
  assert.equal(runtime.resolvedConcealed(other), false);
  assert.equal(runtime.postOverride(current)?.darkened, true);
  runtime.updateControl(current);
  assert.doesNotMatch(button.innerHTML, /<rect x="3" y="7"/);

  runtime.concealImage(current);
  runtime.updateControl(current);
  assert.match(button.innerHTML, /<rect x="3" y="7"/);
  assert.match(button.title, /restore this image/);
  other.concealed = true;
  runtime.activateImageControl(current);
  assert.equal(runtime.resolvedConcealed(current), false);
  assert.equal(runtime.resolvedConcealed(other), true);
  assert.equal(runtime.postOverride(current)?.darkened, true);
});

test('menus group image and all actions but omit all for single-image posts and comment previews', async () => {
  let total = '1 / 8';
  const runtime = await runtimeFixture();
  runtime.viewerForImage = () => ({ querySelector: () => ({ textContent: total }) });
  const record = { image: {}, darkened: false };
  let groups = runtime.controlMenuGroups(record);
  assert.equal(groups.length, 2);
  assert.deepEqual(Array.from(groups, group => group.title), ['Image', 'All']);
  assert.deepEqual(Array.from(groups[0].items, item => item.label), ['Hide', 'Auto', 'Dark', 'Light', 'Original']);
  assert.deepEqual(Array.from(groups[1].items, item => item.label), ['Hide', 'Auto', 'Dark', 'Light', 'Original']);
  total = '1 / 1';
  assert.equal(runtime.controlMenuGroups(record).length, 1);
  total = '1 / 8';
  record.commentKind = 'preview';
  assert.equal(runtime.controlMenuGroups(record).length, 1);
  runtime.locale = 'zh-CN';
  assert.equal(runtime.controlMenuGroups(record)[0].items[0].label, '隐藏');
});

test('Original bypasses image adjustment independently for an image or its entire post', async () => {
  const runtime = await runtimeFixture();
  runtime.viewerPostKey = image => image.post || '';
  runtime.viewerForImage = () => ({ querySelector: () => ({ textContent: '1 / 2' }) });
  runtime.updateRecordVisual = runtime.syncInterventionStatus = () => {};
  const first = { image: { post: 'one', isConnected: true }, darkened: true, result: { kind: 'light-theme' } };
  const second = { image: { post: 'one', isConnected: true }, darkened: true, result: { kind: 'light-theme' } };
  const other = { image: { post: 'two', isConnected: true }, darkened: true, result: { kind: 'light-theme' } };
  for (const record of [first, second, other]) runtime.records.set(record.image, record);
  runtime.controlMenuGroups(first)[0].items.at(-1).run();
  assert.equal(first.imageMode, 'original');
  assert.equal(first.darkened, false);
  assert.equal(second.darkened, true);
  runtime.concealPost(first);
  assert.equal(runtime.resolvedConcealed(second), true);
  runtime.controlMenuGroups(first)[1].items.at(-1).run();
  assert.equal(runtime.postOverride(first)?.mode, 'original');
  assert.equal(first.imageMode, null);
  assert.equal(first.darkened, false);
  assert.equal(second.darkened, false);
  assert.equal(runtime.resolvedConcealed(second), false);
  assert.equal(other.darkened, true);
  assert.equal(runtime.resolvedDarkened({ image: { post: 'one' }, result: { kind: 'light-theme' } }), false,
    'later images inherit the post-wide Original choice');
  assert.equal(runtime.controlMenuGroups(first)[1].items.at(-1).selected, true);
  runtime.setPostMode(first, 'auto');
  assert.equal(first.darkened, true);
  assert.equal(second.darkened, true);
});

test('explicit Original choices use the switch icon without changing Light or Auto icons', async () => {
  const runtime = await runtimeFixture();
  runtime.viewerPostKey = () => 'post';
  const record = { image: {}, button: { style: {}, setAttribute() {} }, commentKind: '', darkened: false };
  const icon = () => { runtime.updateControl(record); return record.button.innerHTML; };
  const switchPattern = /<rect x="3" y="7"/;
  assert.doesNotMatch(icon(), switchPattern, 'unmodified automatic photos keep the normal toggle');
  runtime.postOverrides.set('post', 'original');
  assert.match(icon(), switchPattern);
  record.imageMode = 'light';
  assert.doesNotMatch(icon(), switchPattern, 'per-image Light outranks a post Original choice');
  record.imageMode = 'auto';
  assert.doesNotMatch(icon(), switchPattern);
  record.imageMode = 'original';
  runtime.postOverrides.set('post', true);
  assert.match(icon(), switchPattern, 'per-image Original outranks a post Dark choice');
  record.commentKind = 'preview';
  assert.match(icon(), switchPattern, 'comment Original also uses the switch');
});

test('a held gesture without a browser click cannot swallow the next independent tap', async () => {
  let hold;
  const runtime = await runtimeFixture({}, { setTimeout(callback) { hold = callback; return 1; }, clearTimeout() {} });
  const button = new SimpleEventTarget();
  let holds = 0;
  let taps = 0;
  runtime.togglePostOverride = () => { holds += 1; };
  runtime.activateImageControl = () => { taps += 1; };
  runtime.bindControlGestures(button, {});
  const send = (type, extra = {}) => button.dispatchEvent({ type, pointerId: 2, button: 0, detail: 1, clientX: 10, clientY: 10, ...extra });
  send('pointerdown'); hold(); send('pointerup');
  send('pointerdown'); send('pointerup'); send('click');
  assert.equal(holds, 1);
  assert.equal(taps, 1);
  send('pointerdown'); send('pointermove', { clientX: 40 }); send('pointerup'); send('click');
  send('pointerdown'); send('pointercancel'); send('click');
  assert.equal(taps, 1, 'drag and cancelled presses do not toggle');
  send('click', { detail: 0 });
  assert.equal(taps, 2, 'keyboard activation still works');
});

test('context menus and source replacement cancel pending holds without activating a new image', async () => {
  let hold;
  const runtime = await runtimeFixture({}, { setTimeout(callback) { hold = callback; return 1; }, clearTimeout() {} });
  const button = new SimpleEventTarget();
  const record = { source: 'old', imageMode: 'dark', concealed: true };
  let holds = 0;
  let menus = 0;
  runtime.togglePostOverride = () => { holds += 1; };
  runtime.openControlMenu = () => { menus += 1; };
  runtime.bindControlGestures(button, record);
  button.dispatchEvent({ type: 'pointerdown', button: 0 });
  const oldHold = hold;
  runtime.adoptSource(record, 'new'); oldHold();
  assert.equal(holds, 0);
  assert.equal(record.imageMode, null);
  assert.equal(record.concealed, null);
  button.dispatchEvent({ type: 'contextmenu', pointerType: 'touch' });
  assert.equal(menus, 0);
  button.dispatchEvent({ type: 'contextmenu', pointerType: 'mouse' });
  assert.equal(menus, 1);
});

test('own filter mutations do not rescan a carousel, but slide changes do', async () => {
  let frames = 0;
  const runtime = await runtimeFixture({}, { requestAnimationFrame() { frames += 1; return 1; } });
  runtime.processing = true;
  runtime.onViewerMutations([{ type: 'attributes', oldValue: 'swiper-slide swiper-slide-active',
    target: { getAttribute: () => 'swiper-slide swiper-slide-active cg-xhs-image-dark-mode cg-xhs-image-hidden-dark' } }]);
  assert.equal(frames, 0);
  runtime.onViewerMutations([{ type: 'attributes', oldValue: 'swiper-slide swiper-slide-active cg-xhs-image-dark-mode',
    target: { getAttribute: () => 'swiper-slide' } }]);
  assert.equal(frames, 1);
});

test('unrelated feed images cannot inherit the currently open post identity', async () => {
  const runtime = await runtimeFixture({}, { URL, location: { href: 'https://www.xiaohongshu.com/explore/open-post' } });
  runtime.commentImageKind = () => '';
  runtime.noteCacheKey = () => '';
  runtime.viewerForImage = () => null;
  assert.equal(runtime.viewerPostKey({}), '');
  runtime.viewerForImage = () => ({});
  assert.equal(runtime.viewerPostKey({}), 'open-post');
});

test('sampling stays within its pixel budget, including extreme aspect ratios', async () => {
  const runtime = await runtimeFixture();
  const sizes = [];
  runtime.drawSample = (_image, width, height) => { sizes.push([width, height]); return {}; };
  for (const [naturalWidth, naturalHeight] of [[700, 1200], [100000, 1], [1, 100000], [20, 10]]) {
    await runtime.sampleImage({ naturalWidth, naturalHeight });
  }
  for (const [width, height] of sizes) assert.ok(width * height <= 1024 && width >= 1 && height >= 1);
  assert.deepEqual(sizes.at(-1), [20, 10]);
});

test('in-flight image samples cannot occupy a second analysis slot', async () => {
  const runtime = await runtimeFixture();
  runtime.processing = true;
  runtime.processingGeneration = 1;
  runtime.isContentImage = () => true;
  runtime.schedulePump = () => { throw new Error('must not enqueue the same pending source'); };
  const image = { currentSrc: 'pending-image', complete: true, naturalWidth: 400 };
  runtime.records.set(image, { image, source: '', result: null });
  runtime.inFlight.set(image, { source: image.currentSrc, generation: 1 });
  runtime.queueImage(image, -20);
  assert.equal(runtime.queue.length, 0);
});

async function expandedImageFixture(kind = 'comment', result = { kind: 'light-theme' }) {
  class Image {}
  let images = [];
  const timers = new Map();
  const document = { querySelectorAll: () => images };
  const runtime = await runtimeFixture(document, {
    HTMLImageElement: Image, URL, Node: { ELEMENT_NODE: 1 }, innerWidth: 1200, innerHeight: 800,
    setTimeout(fn) { const id = timers.size + 1; timers.set(id, fn); return id; },
    clearTimeout(id) { timers.delete(id); }
  });
  const image = (src, width) => {
    const classes = new Set();
    return Object.assign(new Image(), {
      src, complete: true, isConnected: true, nodeType: 1,
      naturalWidth: 600, naturalHeight: 800,
      classList: {
        add: name => classes.add(name), contains: name => classes.has(name),
        remove: name => classes.delete(name), toggle(name, on) { on ? classes.add(name) : classes.delete(name); }
      },
      style: { setProperty() {}, removeProperty() {} }, closest: () => null,
      getBoundingClientRect: () => ({ left: 200, top: 0, right: 200 + width, bottom: width,
        width, height: width })
    });
  };
  const thumbnail = image('https://sns-webpic-qc.xhscdn.com/test/original!thumb', 150);
  const preview = image('blob:https://www.xiaohongshu.com/full-size', 600);
  const viewer = { querySelector: () => ({ textContent: '1 / 3' }) };
  images = [thumbnail];
  runtime.processing = true;
  runtime.inlineCommentImage = candidate => kind === 'comment' && candidate === thumbnail;
  runtime.carouselImageContext = candidate => kind === 'post' && candidate === thumbnail
    ? { viewer, slide: null, mediaRoot: thumbnail } : null;
  runtime.scheduleControlPositions = () => {};
  runtime.syncProfileControl = () => {};
  runtime.createControl = () => {};
  const sourceRecord = runtime.createRecord(thumbnail, kind === 'comment' ? 'inline' : '', '');
  Object.assign(sourceRecord, { source: thumbnail.src, result, darkened: result?.kind === 'light-theme' });
  runtime.openingPostId = 'post-a';
  runtime.onPostActivation({ composedPath: () => [thumbnail] });
  images.push(preview);
  const queued = [];
  runtime.waitForImageLoad = (record, priority) => queued.push([record.image, priority]);
  return { runtime, document, thumbnail, preview, sourceRecord, queued, timers, image };
}

test('comment preview inherits the clicked thumbnail before asynchronous probes or analysis', async () => {
  const { runtime, preview, queued } = await expandedImageFixture();
  runtime.onPageMutations([{ type: 'childList', addedNodes: [preview] }]);
  assert.equal(runtime.records.get(preview).commentKind, 'preview');
  assert.equal(preview.classList.contains('cg-xhs-image-dark-mode'), true);
  assert.equal(queued.length, 0);
  assert.equal(preview.classList.contains('cg-xhs-image-pending'), false);
});

test('matching CDN preview is recognized even before it has opening-animation dimensions', async () => {
  const { runtime, preview, thumbnail } = await expandedImageFixture();
  preview.src = thumbnail.src.replace('!thumb', '!full');
  preview.getBoundingClientRect = () => ({ width: 0, height: 0 });
  preview.naturalWidth = 0;
  runtime.observeImage(preview);
  assert.equal(runtime.records.get(preview)?.darkened, true);
  assert.equal(preview.classList.contains('cg-xhs-image-dark-mode'), true);
});

test('post fullscreen copies keep post ownership and manual choices, independently of comments', async () => {
  const { runtime, preview, sourceRecord } = await expandedImageFixture('post');
  sourceRecord.imageMode = 'original';
  sourceRecord.concealed = true;
  runtime.observeImage(preview);
  const record = runtime.records.get(preview);
  assert.equal(record.commentKind, '');
  assert.equal(runtime.viewerPostKey(preview), 'post-a');
  assert.equal(runtime.postImageCount(record), 3);
  assert.equal(record.imageMode, 'original');
  assert.equal(record.darkened, false);
  assert.equal(preview.classList.contains('cg-xhs-image-hidden-dark'), true);
  assert.equal(runtime.imagePreviewRecords.has(record), true);
  assert.equal(runtime.commentImageKeys.has(runtime.cacheKey(preview.src)), false);

  preview.src = 'blob:https://www.xiaohongshu.com/other-image';
  assert.equal(runtime.cachedResult(preview, preview.src), null, 'do not inherit the prior slide result');
  runtime.onPageMutations([{ type: 'attributes', target: preview, attributeName: 'src' }]);
  assert.equal(record.imageMode, null);
  assert.equal(record.concealed, null);
  assert.equal(record.darkened, false);
});

test('unknown previews wait briefly without displaying white and always release the hold', async () => {
  const { runtime, preview, queued, timers } = await expandedImageFixture('comment', { kind: 'photo' });
  runtime.observeImage(preview);
  const record = runtime.records.get(preview);
  assert.equal(record.result, null, 'a thumbnail photo verdict cannot skip sharper-image analysis');
  assert.equal(preview.classList.contains('cg-xhs-image-pending'), true);
  assert.equal(queued[0][1], -20);
  record.imageMode = 'original';
  runtime.observeImage(preview);
  assert.equal(record.imageMode, 'original', 'repeat discovery must not undo a new manual choice');
  timers.get(record.previewHoldTimer)();
  assert.equal(preview.classList.contains('cg-xhs-image-pending'), false);
  runtime.holdUnclassifiedPreview(record);
  runtime.clearRecord(record);
  assert.equal(record.previewHoldTimer, 0);
  assert.equal(preview.classList.contains('cg-xhs-image-pending'), false);
});

test('cached images relocate their filter when moved and when entering native fullscreen', async () => {
  const { runtime, document, thumbnail, sourceRecord, image } = await expandedImageFixture('post');
  const slide = image('', 600);
  const viewer = {};
  runtime.carouselImageContext = () => ({ viewer, slide });
  runtime.updateRecordVisual(sourceRecord);
  assert.equal(slide.classList.contains('cg-xhs-image-dark-mode'), true);
  document.fullscreenElement = thumbnail;
  assert.equal(runtime.visualTarget(thumbnail), thumbnail);
  document.fullscreenElement = { contains: node => node === thumbnail };
  assert.equal(runtime.visualTarget(thumbnail), thumbnail);
  document.fullscreenElement = null;
  assert.equal(runtime.visualTarget(thumbnail), slide);
  runtime.carouselImageContext = () => null;
  assert.equal(runtime.applyCachedResult(sourceRecord), true);
  assert.equal(slide.classList.contains('cg-xhs-image-dark-mode'), false);
  assert.equal(thumbnail.classList.contains('cg-xhs-image-dark-mode'), true);

  runtime.carouselImageContext = () => ({ viewer, slide });
  assert.equal(runtime.applyCachedResult(sourceRecord), true);
  assert.equal(thumbnail.classList.contains('cg-xhs-image-dark-mode'), false);
  assert.equal(slide.classList.contains('cg-xhs-image-dark-mode'), true);
});


test('hung decoding and failed analysis release XHS worker slots', async () => {
  let timeout, scheduled = 0;
  const runtime = await runtimeFixture({}, { setTimeout(fn) { timeout = fn; return 1; }, clearTimeout() {} });
  const image = { isConnected: true, src: 'pending', decode: () => new Promise(() => {}) };
  runtime.processing = true; runtime.processingGeneration = 1;
  runtime.records.set(image, { image });
  runtime.isContentImage = () => true; runtime.profileProcessingDisabled = () => false;
  runtime.cachedResult = () => null; runtime.sampleImage = () => { throw Error('unexpected sample'); };
  runtime.schedulePump = () => { scheduled++; };
  runtime.queue.push({ image }); runtime.pump();
  assert.equal(runtime.running, 1); timeout();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(runtime.running, 0); assert.equal(runtime.inFlight.has(image), false);
  runtime.analyze = async () => { throw Error('canvas disappeared'); };
  runtime.queue.push({ image }); runtime.pump();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(runtime.running, 0); assert.equal(scheduled, 2);
});
