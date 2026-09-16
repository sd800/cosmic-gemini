import {
  FEATURE_IDS,
  chineseResponseClaudeState,
  isClaudeFamilyUrl,
  updateFeature
} from '../../../core/config.js';

const IDENTITY_SESSION_KEY = 'chineseResponseClaudeIdentitySession';

export function createChineseResponseClaudeProduct(pageRuntimeHost, platform) {
  const sessionKey = platform.isIncognitoContext?.() === true
    ? `${IDENTITY_SESSION_KEY}:incognito`
    : `${IDENTITY_SESSION_KEY}:regular`;
  let retainedIdentity;
  let identityQueue = Promise.resolve();

  function serializeIdentity(task) {
    const operation = identityQueue.then(task);
    identityQueue = operation.catch(() => undefined);
    return operation;
  }

  async function readRetainedIdentity() {
    if (typeof retainedIdentity === 'boolean') return retainedIdentity;
    const value = (await globalThis.chrome?.storage?.session?.get(sessionKey))?.[sessionKey];
    retainedIdentity = value?.retained === true;
    return retainedIdentity;
  }

  async function setRetainedIdentity(retained) {
    retainedIdentity = retained === true;
    if (!globalThis.chrome?.storage?.session) return retainedIdentity;
    try {
      if (retainedIdentity) {
        await chrome.storage.session.set({ [sessionKey]: { retained: true } });
      } else {
        await chrome.storage.session.remove(sessionKey);
      }
    } catch {}
    return retainedIdentity;
  }

  async function hasOpenClaudeFamilyTab(options = {}) {
    let tabs = [];
    try { tabs = await chrome.tabs.query({}); } catch {}
    return tabs.some(tab => {
      if (!Number.isInteger(tab.id) || tab.id === options.excludeTabId) return false;
      const url = tab.id === options.replaceTabId ? options.replacementUrl : tab.url;
      return isClaudeFamilyUrl(url || '');
    });
  }

  async function reconcileIdentitySession(options = {}) {
    return serializeIdentity(async () => {
      const settings = await platform.readSettings();
      if (settings.chineseResponseClaude.browserIdentityEnabled === true) {
        return setRetainedIdentity(false);
      }
      if (!await readRetainedIdentity()) return false;
      if (await hasOpenClaudeFamilyTab(options)) return true;
      await setRetainedIdentity(false);
      return false;
    });
  }

  const product = Object.freeze({
    id: FEATURE_IDS.CHINESE_RESPONSE_CLAUDE,
    bridge: 'content/chinese-response-claude-bridge.js',
    runtime: 'content/chinese-response-claude-runtime.js',
    awaitConfiguration: true,
    async state(settings, url) {
      return chineseResponseClaudeState(settings, url, {
        browserIdentityRetained: await readRetainedIdentity()
      });
    },
    async sync(context, settings) {
      const state = await product.state(settings, context.topUrl);
      const active = context.frameId === 0 && state.active;
      await pageRuntimeHost.sync(product, context, active);
      return active;
    },
    async handleMessage(message) {
      if (message.type === 'UI_SET_ENABLED' && message.featureId === FEATURE_IDS.CHINESE_RESPONSE_CLAUDE) {
        const settings = await platform.mutateSettings(current => updateFeature(
          current,
          FEATURE_IDS.CHINESE_RESPONSE_CLAUDE,
          feature => ({ ...feature, enabled: message.enabled === true })
        ), false);
        await platform.refreshOpenPages();
        return settings.chineseResponseClaude;
      }
      if (message.type !== 'UI_SET_CLAUDE_BROWSER_IDENTITY'
        || message.featureId !== FEATURE_IDS.CHINESE_RESPONSE_CLAUDE) {
        throw new Error('Chinese Response Display Optimization for Claude does not support this command.');
      }
      return serializeIdentity(async () => {
        const enabled = message.enabled === true;
        const previousRetained = await readRetainedIdentity();
        const retainUntilTabsClose = !enabled && await hasOpenClaudeFamilyTab();
        if (retainUntilTabsClose) await setRetainedIdentity(true);
        let settings;
        try {
          settings = await platform.mutateSettings(current => updateFeature(
            current,
            FEATURE_IDS.CHINESE_RESPONSE_CLAUDE,
            feature => ({ ...feature, browserIdentityEnabled: enabled })
          ), false);
        } catch (error) {
          await setRetainedIdentity(previousRetained);
          throw error;
        }
        if (enabled || !retainUntilTabsClose) await setRetainedIdentity(false);
        await platform.refreshOpenPages();
        return settings.chineseResponseClaude;
      });
    },
    initialize() { return reconcileIdentitySession(); },
    handleTabUpdated(tabId, change, tab) {
      if (!change.url) return undefined;
      return reconcileIdentitySession({ replaceTabId: tabId, replacementUrl: tab?.url || change.url });
    },
    handleTabRemoved(tabId) {
      return reconcileIdentitySession({ excludeTabId: tabId });
    },
    reset() {
      return serializeIdentity(() => setRetainedIdentity(false));
    }
  });

  return product;
}
