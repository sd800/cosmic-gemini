import { FEATURE_IDS, hostnameFromUrl, normalizeWhiteSofterTone, updateFeature,
  INCOGNITO_SETTINGS_KEY, SETTINGS_KEY } from '../../../core/config.js';

const EARLY_SCRIPT_ID = 'cosmic-gemini-white-softer-prepaint';
const EARLY_CHECK_ID = 'cosmic-gemini-white-softer-prepaint-check';

export function createWhiteSofterProduct(pageRuntimeHost, platform) {
  const pageStyleFiles = Object.freeze(['content/white-softer/white-softer.css']);
  const incognito = platform.isIncognitoContext?.() === true;
  const scriptId = id => incognito ? id + '-incognito' : id;
  const ids = [scriptId(EARLY_SCRIPT_ID), scriptId(EARLY_CHECK_ID)];
  let registrationQueue = Promise.resolve();
  function reconcile(settings) {
    const operation = registrationQueue.then(async () => {
      const saved = settings || await platform.readSettings();
      const registered = await chrome.scripting.getRegisteredContentScripts({ ids });
      const active = saved.whiteSofter?.enabled === true;
      if (!active) {
        if (registered.length) await chrome.scripting.unregisterContentScripts({ ids: registered.map(script => script.id) });
        return;
      }
      const tone = normalizeWhiteSofterTone(saved.whiteSofter.tone);
      const common = { matches: ['http://*/*', 'https://*/*'], runAt: 'document_start',
        allFrames: false, persistAcrossSessions: !incognito };
      const desired = [
        { ...common, id: ids[0], world: 'MAIN', css: pageStyleFiles,
          js: ['shared/white-tones.js', 'content/shared/white-cap-layer.js',
            `content/white-softer/tones/${tone}.js`, 'content/white-softer/white-softer-prepaint.js'] },
        { ...common, id: ids[1], world: 'ISOLATED',
          js: ['content/white-softer/white-softer-prepaint-check.js'] }
      ];
      for (const script of desired) {
        const current = registered.find(item => item.id === script.id);
        if (current && Object.entries(script).every(([key, value]) => JSON.stringify(current[key]) === JSON.stringify(value))) continue;
        if (current) await chrome.scripting.updateContentScripts([script]);
        else await chrome.scripting.registerContentScripts([script]);
      }
    });
    registrationQueue = operation.catch(() => undefined);
    return operation;
  }
  async function ensureReconciled(settings) {
    let failure;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try { return await reconcile(settings); }
      catch (error) {
        failure = error;
        if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 40 * (attempt + 1)));
      }
    }
    throw failure;
  }
  const product = Object.freeze({
    id: FEATURE_IDS.WHITE_SOFTER,
    bridge: 'content/white-softer/white-softer-bridge.js',
    runtime: 'content/white-softer/white-softer-runtime.js',
    runtimeDependencies: Object.freeze(['shared/white-tones.js', 'content/shared/white-cap-layer.js']),
    pageStyleFiles,
    awaitConfiguration: true,
    preservePageStylesOnRefresh: true,
    state(settings, url) {
      const enabled = settings.whiteSofter?.enabled === true;
      const tone = normalizeWhiteSofterTone(settings.whiteSofter?.tone);
      const supported = Boolean(hostnameFromUrl(url));
      return { enabled, tone, supported, active: enabled && supported };
    },
    async sync(context, settings) {
      // One composited surface also covers visible child frames without recoloring twice.
      const active = context.frameId === 0 && product.state(settings, context.topUrl).active;
      await pageRuntimeHost.sync(product, context, active, active ? pageStyleFiles : []);
      return active;
    },
    async handleMessage(message) {
      if (message.type !== 'UI_SET_ENABLED' && (message.type !== 'UI_SET_WHITE_SOFTER_TONE'
        || message.tone !== normalizeWhiteSofterTone(message.tone))) {
        throw new Error('White Softer does not support this setting.');
      }
      try {
        const settings = await platform.mutateSettings(async current => {
          const next = updateFeature(current, product.id, feature => ({
            ...feature,
            ...(message.type === 'UI_SET_ENABLED' ? { enabled: message.enabled === true } : { tone: message.tone })
          }));
          await ensureReconciled(next);
          return next;
        });
        return settings.whiteSofter;
      } catch (error) {
        await ensureReconciled().catch(() => {});
        throw error;
      }
    },
    initialize: () => ensureReconciled(),
    handleStorageChanged(changes, areaName) {
      if (areaName !== (incognito ? 'session' : 'local')) return;
      const change = changes[incognito ? INCOGNITO_SETTINGS_KEY : SETTINGS_KEY];
      if (!change || JSON.stringify(change.oldValue?.whiteSofter) === JSON.stringify(change.newValue?.whiteSofter)) return;
      return ensureReconciled();
    },
    reset() {
      const operation = registrationQueue.then(async () => {
        const registered = await chrome.scripting.getRegisteredContentScripts({ ids });
        if (registered.length) await chrome.scripting.unregisterContentScripts({ ids: registered.map(script => script.id) });
      });
      registrationQueue = operation.catch(() => undefined);
      return operation;
    }
  });
  return product;
}
