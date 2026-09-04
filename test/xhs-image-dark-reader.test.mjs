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

async function runtimeFixture() {
  const context = {
    window: new SimpleEventTarget(),
    document: {},
    CustomEvent: class { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } },
    Uint8Array, Map, Set, Symbol, JSON, Number, String, Math, Object, Promise,
    crypto: { getRandomValues: values => { values.fill(11); return values; } }
  };
  vm.createContext(context);
  const source = await readFile(new URL('../extension/content/xhs-image-dark-reader-runtime.js', import.meta.url), 'utf8');
  vm.runInContext(source, context);
  return context[Symbol.for('cosmic-gemini.xhs-image-dark-reader.runtime')];
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

test('XHS Image Dark Reader adapts documents while preserving photographs', async () => {
  const runtime = await runtimeFixture();
  assert.equal(runtime.classifySample(documentPixels(), 64, 64).kind, 'text');
  assert.equal(runtime.classifySample(photoPixels(), 64, 64).kind, 'photo');
  const emptyBrightCard = pixels((x, y) => [235 - Math.floor(y / 4), 237 - Math.floor(x / 4), 230]);
  assert.equal(runtime.classifySample(emptyBrightCard, 64, 64).kind, 'photo');
});

test('XHS Image Dark Reader adapts only document tiles in mixed images', async () => {
  const runtime = await runtimeFixture();
  const document = documentPixels();
  const photo = photoPixels();
  const mixed = new Uint8ClampedArray(document.length);
  const rowBytes = 64 * 4;
  mixed.set(photo.subarray(0, rowBytes * 32), 0);
  mixed.set(document.subarray(rowBytes * 32), rowBytes * 32);
  const result = runtime.classifySample(mixed, 64, 64);
  assert.equal(result.kind, 'mixed');
  assert.equal(result.mask.slice(0, 32).some(Boolean), false);
  assert.equal(result.mask.slice(32).filter(Boolean).length >= 24, true);
});

test('face detection is a local veto rather than the image classifier', async () => {
  const runtime = await runtimeFixture();
  const result = runtime.classifySample(documentPixels(), 64, 64);
  const protectedResult = runtime.protectFaces(result, [
    { boundingBox: { x: 24, y: 8, width: 10, height: 10 } }
  ], 64, 64);
  assert.equal(protectedResult.kind, 'mixed');
  assert.equal(protectedResult.mask[1 * 8 + 3], false);
  assert.equal(protectedResult.mask[6 * 8 + 6], true);
});
