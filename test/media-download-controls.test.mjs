import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { bindDisplayButton } from '../extension/popup/display-button.js';

const source = readFileSync(new URL('../extension/popup/popup.js', import.meta.url), 'utf8');
function extract(from, to) { return source.slice(source.indexOf(from), source.indexOf(to, source.indexOf(from))); }

function fixture(featureId, feature) {
  const timers = new Map(), listeners = new Map(), messages = [], actions = [];
  let timerId = 0;
  const view = { setTimeout(fn) { timers.set(++timerId, fn); return timerId; },
    clearTimeout(id) { timers.delete(id); }, addEventListener() {} };
  const button = { ownerDocument: { defaultView: view }, setPointerCapture() {},
    addEventListener(name, callback) { listeners.set(name, callback); } };
  const tasks = [];
  const context = vm.createContext({ bindDisplayButton, state: { [featureId]: feature }, currentTab: { id: 7 },
    document: { querySelector(selector) { assert.equal(selector, '#' + featureId + '-status'); return button; } },
    send: async message => messages.push({ ...message }),
    reloadAfterAction: async selectInitial => { assert.equal(selectInitial, false); actions.push('refresh'); },
    perform: task => { const pending = task(); tasks.push(pending); return pending; },
    open: () => actions.push('open')
  });
  vm.runInContext(`${extract('function mediaDownloadRunning(', 'function renderDownloadControlState(')}
    ${extract('function bindMediaDownloadControl(', "bindMediaDownloadControl('videoDownload'")}
    bindMediaDownloadControl('${featureId}', '${featureId === 'imageDownload' ? 'UI_IMAGE_STOP' : 'UI_VIDEO_STOP'}', async () => open());`,
  context);
  return { button, messages, actions,
    fire(type, values = {}) { listeners.get(type)?.({ button: 0, pointerId: 1, isPrimary: true,
      clientX: 0, clientY: 0, detail: 1, preventDefault() {}, ...values }); },
    hold() { for (const [id, task] of [...timers]) { timers.delete(id); task(); } },
    settle: () => Promise.all(tasks)
  };
}

for (const featureId of ['imageDownload', 'videoDownload']) {
  test(`${featureId} holds stop every highlighted state once without reopening on release`, async () => {
    for (const feature of [{ active: true, scanState: 'active' }, { active: true, scanState: 'grace' },
      { active: false, scanState: 'grace' }, { active: true, scanState: 'paused' }]) {
      const f = fixture(featureId, feature);
      f.fire('pointerdown'); f.hold(); f.hold(); f.fire('pointerup'); f.fire('click'); await f.settle();
      assert.deepEqual(f.messages, [{ type: featureId === 'imageDownload' ? 'UI_IMAGE_STOP' : 'UI_VIDEO_STOP', tabId: 7 }]);
      assert.deepEqual(f.actions, ['refresh']);
    }
  });

  test(`${featureId} keeps clicks, ignores inactive holds, and cancels moved holds`, async () => {
    const f = fixture(featureId, { active: false, scanState: 'paused' });
    f.fire('pointerdown'); f.hold(); f.fire('pointerup'); f.fire('click'); await f.settle();
    assert.deepEqual(f.messages, []); assert.deepEqual(f.actions, []);
    f.fire('pointerdown'); f.fire('pointerup'); f.fire('click'); await f.settle();
    assert.deepEqual(f.actions, ['open']);
    const moved = fixture(featureId, { active: true });
    moved.fire('pointerdown'); moved.fire('pointermove', { clientX: 30 }); moved.hold();
    moved.fire('pointerup'); moved.fire('click'); await moved.settle();
    assert.deepEqual(moved.messages, []); assert.deepEqual(moved.actions, []);
  });
}
