import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createContext, runInContext } from 'node:vm';

test('stopping a selected image capture cancels its pending dispatch; a completed selection still sends once', async () => {
  const source = await readFile(new URL('../extension/content/image-download/image-capture.js', import.meta.url), 'utf8');
  for (const cancel of [true, false]) {
    const timers = new Map(), elements = [], sent = [];
    const root = { append() {} };
    const context = createContext({ navigator: { languages: ['en'] }, innerWidth: 1000, innerHeight: 800,
      document: { documentElement: root, createElement() {
        const listeners = new Map();
        const element = { dataset: {}, style: {}, append() {}, remove() {}, setPointerCapture() {},
          addEventListener(type, callback) { listeners.set(type, callback); }, listeners };
        elements.push(element); return element;
      } }, addEventListener() {}, removeEventListener() {},
      setTimeout(callback) { timers.set(1, callback); return 1; }, clearTimeout(id) { timers.delete(id); },
      chrome: { runtime: { sendMessage(message) { sent.push(message); return Promise.resolve(); } } } });
    runInContext(source, context);
    const event = { clientX: 10, clientY: 10, pointerId: 1, preventDefault() {}, stopImmediatePropagation() {} };
    elements[0].listeners.get('pointerdown')(event);
    elements[0].listeners.get('pointerup')({ ...event, clientX: 100, clientY: 100 });
    const callback = timers.get(1);
    assert.ok(callback);
    assert.ok(runInContext("globalThis[Symbol.for('cosmic-gemini.image-capture')]", context));
    if (cancel) runInContext("globalThis[Symbol.for('cosmic-gemini.image-capture')].dispose()", context);
    callback();
    assert.equal(sent.length, cancel ? 0 : 1);
    assert.equal(runInContext("globalThis[Symbol.for('cosmic-gemini.image-capture')]", context), undefined);
  }
});
