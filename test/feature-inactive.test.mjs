import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createContext, runInContext } from 'node:vm';

for (const key of ['translate', 'stay']) for (const scope of ['regular', 'incognito', 'tool']) {
  test(`${key} ${scope} activation rejects an authorization reply superseded by shutdown`, async () => {
    let resolve, activations = 0;
    const file = scope === 'tool' ? `website-fixer-tool-${key}.js` : `website-fixer-${key}-${scope}.js`;
    const source = await readFile(new URL(`../extension/content/website-fixer/${file}`, import.meta.url), 'utf8');
    const context = createContext({ chrome: { extension: { inIncognitoContext: scope === 'incognito' },
      runtime: { sendMessage() { return new Promise(done => { resolve = done; }); } } } });
    context.activate = () => { activations++; };
    runInContext(`globalThis[Symbol.for('cosmic-gemini.website-fixer.${key}-activate')] = activate`, context);
    runInContext(source, context);
    runInContext(`globalThis[Symbol.for('cosmic-gemini.website-fixer.${key}-pending')].revision++`, context);
    resolve({ ok: true, result: { active: true } });
    await new Promise(done => setImmediate(done));
    assert.equal(activations, 0);
    runInContext(source, context);
    resolve({ ok: true, result: { active: true } });
    await new Promise(done => setImmediate(done));
    assert.equal(activations, 1, 'a later deliberate activation is still allowed');
  });
}

test('Stay context-menu shutdown removes listeners, cancels pending reports, and reactivates once', async () => {
  const listeners = new Map(), timers = new Map(); let nextTimer = 0, sent = 0;
  const window = { addEventListener(type, callback) {
    if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(callback);
  }, removeEventListener(type, callback) { listeners.get(type)?.delete(callback); },
  dispatchEvent() {}, getSelection() { return ''; } };
  const context = createContext({ window, document: { activeElement: {} }, URL,
    CustomEvent: class { constructor(type) { this.type = type; } },
    setTimeout(callback) { timers.set(++nextTimer, callback); return nextTimer; }, clearTimeout(id) { timers.delete(id); },
    chrome: { runtime: { sendMessage() { sent++; return Promise.resolve(); } } } });
  runInContext(await readFile(new URL('../extension/content/website-fixer/website-fixer-stay-browser-menu.js', import.meta.url), 'utf8'), context);
  runInContext(`globalThis[Symbol.for('cosmic-gemini.website-fixer.stay-activate')]()`, context);
  const menu = runInContext(`globalThis[Symbol.for('cosmic-gemini.website-fixer.stay-menu')]`, context);
  const handler = [...listeners.get('contextmenu')][0];
  handler({ isTrusted: true, composedPath() { return []; } });
  const late = [...timers.values()][0];
  assert.equal(timers.size, 1);
  menu.dispose(); late(); handler({ isTrusted: true });
  assert.equal(timers.size, 0); assert.equal(sent, 0);
  assert.equal(listeners.get('contextmenu').size, 0); assert.equal(listeners.get('cosmic-gemini:website-fixer:stay:ready').size, 0);
  menu.activate(); menu.activate();
  assert.equal(listeners.get('contextmenu').size, 1);
  handler({ isTrusted: true, composedPath() { return []; } });
  [...timers.values()][0](); assert.equal(sent, 1);
  menu.dispose();
});
