import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

class EventTarget {
  constructor() { this.listeners = new Map(); }
  addEventListener(type, listener) {
    this.listeners.set(type, [...(this.listeners.get(type) || []), listener]);
  }
  removeEventListener(type, listener) {
    this.listeners.set(type, (this.listeners.get(type) || []).filter(value => value !== listener));
  }
  dispatchEvent(event) {
    for (const listener of this.listeners.get(event.type) || []) listener(event);
    return event.defaultPrevented !== true;
  }
}

async function fixture({ scope = null } = {}) {
  const window = new EventTarget();
  const document = new EventTarget();
  const root = { scrollTop: 0, scrollHeight: 2400, clientHeight: 600,
    scrollLeft: 0, scrollWidth: 600, clientWidth: 600 };
  document.documentElement = root;
  document.body = {};
  document.scrollingElement = root;
  document.activeElement = null;
  document.querySelectorAll = () => scope ? [scope] : [];
  let vertical = null;
  window.scrollY = 0;
  window.scrollX = 0;
  window.scrollBy = options => { vertical = options; };
  const context = {
    window, document, location: { hostname: 'www.xiaohongshu.com' },
    innerWidth: 1200, innerHeight: 800,
    getComputedStyle: element => element.style || { overflowX: 'visible', overflowY: 'visible' },
    KeyboardEvent: class {
      constructor(type, init = {}) { Object.assign(this, init, { type, defaultPrevented: false }); }
      preventDefault() { this.defaultPrevented = true; }
    },
    CustomEvent: class { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } },
    Symbol, JSON, Number, String, Object, Math
  };
  vm.createContext(context);
  const source = await readFile(new URL('../extension/content/xhs-navigation/xhs-navigation-runtime.js', import.meta.url), 'utf8');
  vm.runInContext(source, context);
  const runtime = context[Symbol.for('cosmic-gemini.xhs-navigation.runtime')];
  window.dispatchEvent(new context.CustomEvent('cosmic-gemini:xhs-image-dark-mode:configure', {
    detail: JSON.stringify({ token: 'token', config: { keyboardNavigationEnabled: true } })
  }));
  return { runtime, window, document, root, vertical: () => vertical };
}

function keyEvent(code, path = []) {
  return {
    type: 'keydown', code, key: '',
    defaultPrevented: false,
    composedPath: () => path,
    preventDefault() { this.defaultPrevented = true; },
    stopImmediatePropagation() { this.stopped = true; }
  };
}

test('W and S dispatch ArrowUp and ArrowDown with native scrolling fallback', async () => {
  const { document, vertical } = await fixture();
  const target = new EventTarget();
  let translated = null;
  target.addEventListener('keydown', event => { translated = event; });
  const down = { ...keyEvent('KeyS'), target };
  document.dispatchEvent(down);
  assert.equal(translated.key, 'ArrowDown');
  assert.equal(translated.code, 'ArrowDown');
  assert.equal(translated.keyCode, 40);
  assert.equal(vertical().top, 40);
  assert.equal(vertical().behavior, 'smooth');
  assert.equal(down.defaultPrevented, true);
  assert.equal(down.stopped, true);

  const before = vertical();
  const input = { matches: selector => selector.includes('input') };
  const typing = keyEvent('KeyW', [input]);
  document.dispatchEvent(typing);
  assert.equal(vertical(), before);
  assert.equal(typing.defaultPrevented, false);
});

test('A and D dispatch ArrowLeft and ArrowRight and stop after disposal', async () => {
  const { window, document } = await fixture();
  const target = new EventTarget();
  const arrows = [];
  target.addEventListener('keydown', event => { arrows.push(event.key); });
  const next = { ...keyEvent('KeyD'), target };
  document.dispatchEvent(next);
  assert.deepEqual(arrows, ['ArrowRight']);
  assert.equal(next.defaultPrevented, true);

  window.dispatchEvent({ type: 'cosmic-gemini:xhs-image-dark-mode:dispose', detail: 'token' });
  document.dispatchEvent({ ...keyEvent('KeyA'), target });
  assert.deepEqual(arrows, ['ArrowRight']);
});
