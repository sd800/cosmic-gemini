import assert from 'node:assert/strict';
import test from 'node:test';
import { bindDisplayButton } from '../extension/popup/display-button.js';

function fixture() {
  const timers = new Map(), listeners = new Map(), views = new Map(), actions = [];
  let id = 0;
  const view = { setTimeout(fn) { timers.set(++id, fn); return id; }, clearTimeout(id) { timers.delete(id); },
    addEventListener(type, fn) { views.set(type, fn); } };
  const button = { ownerDocument: { defaultView: view }, disabled: false, setPointerCapture() {},
    addEventListener(type, fn) { listeners.set(type, fn); } };
  const fire = (type, values = {}) => listeners.get(type)?.({ button: 0, isPrimary: true, pointerId: 1,
    clientX: 2, clientY: 3, detail: 1, preventDefault() {}, ...values });
  bindDisplayButton(button, scope => actions.push(scope));
  return { actions, button, fire, views, timers,
    hold() { const tasks = [...timers.values()]; timers.clear(); tasks.forEach(fn => fn()); } };
}

test('display controls separate clicks from one-shot global holds', () => {
  const f = fixture();
  f.fire('pointerdown'); f.fire('pointerup'); f.fire('click');
  assert.deepEqual(f.actions, ['site']);
  f.fire('pointerdown'); f.hold(); f.hold(); f.fire('pointerup'); f.fire('click');
  assert.deepEqual(f.actions, ['site', 'global']);
  f.fire('pointerdown'); f.fire('pointerup'); f.fire('click');
  f.fire('click', { detail: 0 });
  assert.deepEqual(f.actions, ['site', 'global', 'site', 'site']);
});

test('display holds cancel on movement, cancellation, context menu, blur, and page exit', () => {
  for (const cancel of ['pointercancel', 'lostpointercapture', 'contextmenu', 'blur', 'pagehide', 'pointermove']) {
    const f = fixture(); f.fire('pointerdown');
    if (['blur', 'pagehide'].includes(cancel)) f.views.get(cancel)();
    else f.fire(cancel, { clientX: 30 });
    f.hold(); assert.deepEqual(f.actions, [], cancel);
    assert.equal(f.timers.size, 0);
  }
  const f = fixture(); f.button.disabled = true;
  f.fire('pointerdown'); f.hold(); assert.deepEqual(f.actions, []);
});
