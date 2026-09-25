import test from 'node:test';
import assert from 'node:assert/strict';
import { bindSettingsButton } from '../extension/popup/settings-button.js';

function fixture(reloadTask = async () => {}) {
  const timers = new Map(); let timerId = 0, opens = 0, reloads = 0;
  const target = () => ({
    listeners: {},
    addEventListener(type, handler) { this.listeners[type] = handler; },
    fire(type, data = {}) { return this.listeners[type]?.({ button: 0, pointerId: 1, isPrimary: true,
      clientX: 10, clientY: 10, detail: 1, preventDefault() { this.prevented = true; }, ...data }); }
  });
  const window = { ...target(), setTimeout(fn) { timers.set(++timerId, fn); return timerId; }, clearTimeout(id) { timers.delete(id); } };
  const document = { ...target(), defaultView: window };
  const button = { ...target(), ownerDocument: document, innerHTML: '<svg></svg>', dataset: {},
    contains(node) { return node === this; }, setAttribute() {}, setPointerCapture() {} };
  const control = bindSettingsButton(button, { settingsTitle: 'Settings', reloadTitle: 'Reload extension',
    async openSettings() { opens++; }, async reloadExtension() { reloads++; await reloadTask(); } });
  return { button, document, window, control, counts: () => [opens, reloads],
    hold() { for (const [id, fn] of [...timers]) { timers.delete(id); fn(); } },
    async click() { button.fire('pointerdown'); button.fire('pointerup'); await button.fire('click'); } };
}

test('short click opens settings; long press arms reload without confirming on release', async () => {
  const f = fixture();
  await f.click(); assert.deepEqual(f.counts(), [1, 0]);
  f.button.fire('pointerdown'); f.hold();
  assert.equal(f.button.textContent, 'Reload');
  assert.equal(f.button.dataset.reloadArmed, 'true');
  f.control.setLabels('打开全部设置', '重新加载扩展');
  assert.equal(f.button.textContent, 'Reload');
  assert.equal(f.button.title, '重新加载扩展');
  f.button.fire('pointerup'); f.button.fire('lostpointercapture');
  await f.button.fire('click'); assert.deepEqual(f.counts(), [1, 0]);
  await f.click(); assert.deepEqual(f.counts(), [1, 1]);
});

test('dragging and cancelled pointers never turn the original gesture into an action', async () => {
  for (const cancel of ['pointermove', 'pointercancel']) {
    const f = fixture(); f.button.fire('pointerdown');
    f.button.fire(cancel, { clientX: 40 }); f.hold();
    await f.button.fire('click');
    assert.equal(f.button.dataset.reloadArmed, 'false');
    assert.deepEqual(f.counts(), [0, 0]);
  }
  const f = fixture(); f.button.fire('pointerdown', { button: 2 }); f.hold();
  assert.equal(f.button.dataset.reloadArmed, 'false');
});

test('escape, outside activation and popup lifecycle clear the temporary confirmation', async () => {
  for (const cancel of [f => f.document.fire('keydown', { key: 'Escape' }),
    f => f.document.fire('pointerdown', { target: {} }), f => f.window.fire('blur'), f => f.window.fire('pagehide')]) {
    const f = fixture(); f.button.fire('pointerdown'); f.hold(); cancel(f);
    assert.equal(f.button.dataset.reloadArmed, 'false');
    assert.equal(f.button.innerHTML, '<svg></svg>');
    await f.click(); assert.deepEqual(f.counts(), [1, 0]);
  }
});

test('keyboard confirmation and duplicate-click protection retain an explicit second action', async () => {
  let finish; const f = fixture(() => new Promise(resolve => { finish = resolve; }));
  f.button.fire('pointerdown'); f.hold(); f.button.fire('pointerup');
  await f.button.fire('click');
  const confirming = f.button.fire('click', { detail: 0 });
  assert.equal(f.button.disabled, true);
  await f.button.fire('click', { detail: 0 });
  assert.deepEqual(f.counts(), [0, 1]);
  finish(); await confirming;
  assert.equal(f.button.disabled, false);
});
