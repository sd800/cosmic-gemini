import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { WHITE_TONES } from '../extension/core/config.js';

const source = await readFile(new URL('../extension/content/crash-page-warden/white-softer.js', import.meta.url), 'utf8');
function fixture({ privateContext = false, initial = { enabled: true, tone: 'warm-minus-1' }, deferred = false } = {}) {
  const state = { started: true, ready: false }, properties = new Map(), listeners = new Set(), messages = new Set(), events = new Map(), layers = [];
  const printMedia = { matches: false, addEventListener(_type, callback) { this.onChange = callback; } };
  let saved = initial, resolveRead, reads = 0, ordinaryDisposals = 0;
  const root = { style: {
    getPropertyValue: key => properties.get(key) || '',
    setProperty: (key, value) => properties.set(key, value), removeProperty: key => properties.delete(key)
  } };
  const scope = {
    state, document: { documentElement: root, addEventListener() {} },
    matchMedia: () => printMedia,
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options?.detail; } },
    addEventListener(type, callback) { events.set(type, callback); },
    window: { dispatchEvent() {} },
    chrome: { extension: { inIncognitoContext: privateContext },
      storage: { onChanged: { addListener: callback => listeners.add(callback), removeListener: callback => listeners.delete(callback) } },
      runtime: { onMessage: { addListener: callback => messages.add(callback), removeListener: callback => messages.delete(callback) }, async sendMessage(message) {
        assert.equal(message.type, 'CG_PAGE_STATE'); assert.equal(message.featureId, 'whiteSofter'); reads++;
        if (deferred && reads === 1) return new Promise(resolve => { resolveRead = resolve; });
        return { ok: true, result: { whiteSofter: saved } };
      } }
    }
  };
  scope[Symbol.for('cosmic-gemini.crash-page-warden.static')] = state;
  scope[Symbol.for('cosmic-gemini.white-tones')] = WHITE_TONES;
  scope[Symbol.for('cosmic-gemini.white-softer.bridge')] = { dispose() { ordinaryDisposals++; } };
  scope[Symbol.for('cosmic-gemini.white-cap-layer')] = class {
    constructor(attribute, options) { this.attribute = attribute; this.options = options; layers.push(this); }
    enable(tone) { this.active = true; this.tone = tone; this.host = { matches: () => this.active }; }
    disable() { this.active = false; this.host = null; }
  };
  runInNewContext(source, scope);
  state.whiteSofter.start();
  return { state, properties, layers, listeners, events, printMedia, ordinaryDisposals: () => ordinaryDisposals,
    async notify(message) { for (const callback of messages) callback(message); await new Promise(resolve => setImmediate(resolve)); },
    completeRead: feature => resolveRead({ ok: true, result: { whiteSofter: feature } }),
    async show() { state.ready = true; state.whiteSofter.render(); },
    async change(feature, area = privateContext ? 'session' : 'local') {
      const previous = saved; saved = feature;
      const key = privateContext ? 'cosmicGeminiIncognitoSettings' : 'cosmicGeminiSettings';
      for (const callback of listeners) callback({ [key]: { oldValue: { whiteSofter: previous }, newValue: { whiteSofter: feature } } }, area);
    }
  };
}

test('the reader follows live palette preferences and owns one reusable white cap', async () => {
  const f = fixture(); await f.state.whiteSofter.ready;
  assert.equal(f.ordinaryDisposals(), 1);
  assert.equal(f.properties.get('--cg-warden-white'), '236 235 233');
  assert.equal(f.layers.length, 0, 'the cap is not painted before the reading surface exists');
  await f.show(); assert.equal(f.layers.length, 1);
  assert.equal(f.properties.get('--cg-warden-render-white'), '255 255 255', 'native whites enter the curve once');
  assert.equal(f.layers[0].attribute, 'data-cg-warden-white-softer');
  assert.equal(f.layers[0].options, undefined, 'the reader supplies its own transition background');
  for (const tone of WHITE_TONES.tones) {
    await f.change({ enabled: true, tone: tone.id });
    assert.equal(f.properties.get('--cg-warden-white'), tone.rgb);
    assert.equal(f.layers[0].tone, tone.id); assert.equal(f.layers[0].active, true);
  }
  await f.change({ enabled: false, tone: 'cool' });
  assert.equal(f.properties.has('--cg-warden-white'), false); assert.equal(f.layers[0].active, false);
  await f.change({ enabled: true, tone: 'warm' });
  assert.equal(f.layers.length, 1); assert.equal(f.layers[0].active, true);
  await f.change(undefined); assert.equal(f.layers[0].active, false);
});

test('a late initial response cannot overwrite a newer saved palette', async () => {
  const f = fixture({ deferred: true });
  await f.change({ enabled: true, tone: 'cool' });
  f.completeRead({ enabled: true, tone: 'warm' }); await f.state.whiteSofter.ready;
  assert.equal(f.properties.get('--cg-warden-white'), '206 224 242');
});

test('private preferences stay scoped and a cached reader refreshes on return', async () => {
  const f = fixture({ privateContext: true }); await f.state.whiteSofter.ready; await f.show();
  await f.change({ enabled: false }, 'local');
  assert.equal(f.layers[0].active, true, 'ordinary preference events do not change private reading');
  f.events.get('pagehide')({}); assert.equal(f.listeners.size, 0);
  assert.equal(f.layers[0].active, true, 'leaving retains the last painted surface');
  await f.change({ enabled: false });
  f.events.get('pageshow')({ persisted: true }); await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.listeners.size, 1); assert.equal(f.layers[0].active, false);
});

test('private refresh messages apply confirmed preferences even without a storage event', async () => {
  const f = fixture({ privateContext: true }); await f.state.whiteSofter.ready; await f.show();
  await f.change({ enabled: false }, 'unavailable-to-content');
  await f.notify({ type: 'CG_STOP_CENTRAL_FEATURE', featureId: 'whiteSofter' });
  assert.equal(f.layers[0].active, false);
  await f.change({ enabled: true, tone: 'cool' }, 'unavailable-to-content');
  await f.notify({ type: 'CG_REFRESH_FEATURE_CONFIG', featureId: 'whiteSofter' });
  assert.equal(f.layers[0].active, true); assert.equal(f.layers[0].tone, 'cool');
});

test('printing suspends the composited cap and resumes it without changing the saved tone', async () => {
  const f = fixture(); await f.state.whiteSofter.ready; await f.show();
  f.printMedia.matches = true; f.printMedia.onChange();
  assert.equal(f.layers[0].active, false);
  f.printMedia.matches = false; f.printMedia.onChange();
  assert.equal(f.layers[0].active, true); assert.equal(f.layers.length, 1);
  assert.equal(f.properties.get('--cg-warden-white'), '236 235 233');
});
