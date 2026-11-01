import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

function fixture({ dark = true, body = 'rgb(255, 255, 255)' } = {}) {
  let time = 0, next = 0;
  const frames = new Map(), globalEvents = new Map(), events = new Map(), styles = new Map();
  const root = { backgroundColor: 'rgb(24, 26, 27)', getAttribute: () => dark ? 'dark' : null };
  const document = { documentElement: root, body: { backgroundColor: body }, readyState: 'interactive', visibilityState: 'visible',
    addEventListener(type, listener) { events.set(type, listener); }, removeEventListener(type) { events.delete(type); } };
  const surface = { style: { setProperty(name, value) { styles.set(name, value); }, removeProperty(name) { styles.delete(name); } } };
  let observer;
  const context = vm.createContext({ document, performance: { now: () => time },
    getComputedStyle: node => node,
    requestAnimationFrame(fn) { frames.set(++next, fn); return next; }, cancelAnimationFrame(id) { frames.delete(id); },
    addEventListener(type, listener) { globalEvents.set(type, listener); }, removeEventListener(type) { globalEvents.delete(type); },
    MutationObserver: class { constructor(fn) { observer = fn; } observe() {} disconnect() {} }
  });
  vm.runInContext(readFileSync(new URL('../extension/content/shared/dark-transition-guard.js', import.meta.url), 'utf8'), context);
  const guard = new context[Symbol.for('cosmic-gemini.dark-transition-guard')](surface);
  return { guard, document, root, frames, styles, globalEvents, events,
    tick(at) { time = at; const queue = [...frames]; frames.clear(); queue.forEach(([, fn]) => fn()); },
    setDark(value) { dark = value; observer(); } };
}

test('confirmed dark transitions shield a bright body and release as soon as it becomes dark', () => {
  const f = fixture(); f.guard.enable();
  assert.equal(f.styles.get('background-color'), 'rgb(24, 26, 27)');
  assert.equal(f.frames.size, 1);
  f.document.body.backgroundColor = 'rgb(24, 26, 27)'; f.tick(16);
  assert.equal(f.styles.size, 0);
  f.document.readyState = 'complete'; f.tick(351);
  assert.equal(f.frames.size, 0, 'a static page has no recurring frame work');
  f.events.clear(); f.globalEvents.clear(); // document.open retains the runtime but clears listeners.
  f.guard.enable();
  assert.ok(f.events.has('visibilitychange') && f.globalEvents.has('pageshow'));
  assert.equal(f.frames.size, 0, 'reconnecting listeners does not restart an idle guard');
  f.guard.disable(); assert.equal(f.events.size, 0); assert.equal(f.globalEvents.size, 0);
});

test('ordinary light pages never receive a dark shield or a frame loop', () => {
  const f = fixture({dark:false}); f.guard.enable();
  assert.equal(f.frames.size, 0); assert.equal(f.styles.size, 0);
  f.guard.disable();
});

test('visibility return is protected synchronously, and theme disable removes the shield', () => {
  const f = fixture(); f.guard.enable();
  f.document.visibilityState = 'hidden'; f.guard.onLifecycle({type:'visibilitychange',isTrusted:true});
  assert.equal(f.frames.size, 0); assert.equal(f.styles.size, 0);
  f.document.visibilityState = 'visible'; f.guard.onLifecycle({type:'visibilitychange',isTrusted:true});
  assert.equal(f.styles.get('background-color'), 'rgb(24, 26, 27)');
  f.setDark(false); assert.equal(f.frames.size, 0); assert.equal(f.styles.size, 0);
  f.guard.disable();
});

test('protection is bounded, ignores synthetic lifecycle notifications, and preserves source colors', () => {
  const f = fixture(); f.guard.enable(); f.tick(2001);
  assert.equal(f.frames.size, 0); assert.equal(f.styles.size, 0);
  f.guard.onLifecycle({type:'pageshow',isTrusted:false}); assert.equal(f.frames.size, 0);
  f.guard.onLifecycle({type:'load',isTrusted:true,target:{localName:'img'}}); assert.equal(f.frames.size, 0);
  assert.equal(f.root.backgroundColor, 'rgb(24, 26, 27)');
  assert.equal(f.document.body.backgroundColor, 'rgb(255, 255, 255)');
  f.guard.onLifecycle({type:'pageshow',isTrusted:true}); assert.equal(f.frames.size, 1);
  f.guard.disable(); assert.equal(f.frames.size, 0); assert.equal(f.styles.size, 0);
});
