import { createContextSessionStorage } from '../../commissions/central-cc.js';
import { FEATURE_IDS, anyCopyState, hostnameFromUrl, isIpAddress, normalizeRule, updateFeature } from '../../../core/config.js';
import { createKeyedTaskQueue } from '../../../core/keyed-task-queue.js';
import { siteKey } from '../../../core/site-key.js';

const SESSION_PREFIX = 'anyCopySite:';

export function createAnyCopyProduct(pageRuntimeHost, platform) {
  const sessionStorage = createContextSessionStorage(platform.isIncognitoContext?.() === true);
  const siteUpdates = createKeyedTaskQueue();
  const key = site => SESSION_PREFIX + site;
  const ownsRule = (rule, site) => siteKey('https://' + rule.replace(/^\*\./, '')) === site;

  async function currentPage(message) {
    if (!Number.isInteger(message.tabId) || message.tabId < 0) throw new Error('The current tab is unavailable.');
    const tab = await chrome.tabs.get(message.tabId);
    const url = tab.pendingUrl || tab.url || '';
    const hostname = hostnameFromUrl(url);
    if (!hostname || hostname !== normalizeRule(message.expectedHostname || message.hostname || '')
      || (tab.incognito === true) !== (platform.isIncognitoContext?.() === true)) {
      throw new Error('The page changed before the action completed.');
    }
    return { tab, url, site: siteKey(url) };
  }

  async function refreshSite(site, active) {
    const tabs = await chrome.tabs.query({});
    await Promise.allSettled(tabs.filter(tab => Number.isInteger(tab.id)
      && (tab.incognito === true) === (platform.isIncognitoContext?.() === true)
      && siteKey(tab.pendingUrl || tab.url || '') === site).map(async tab => {
      if (!active) {
        try { await platform.setFeatureActivity(tab.id, product.id, false); } catch {}
      }
      // Central also coordinates Clipboard Protect and every eligible child frame.
      await platform.refreshTabPage(tab.id);
    }));
  }

  const product = Object.freeze({
    id: FEATURE_IDS.ANY_COPY,
    bridge: 'content/any-copy/any-copy-bridge.js',
    runtime: 'content/any-copy/any-copy-runtime.js',
    awaitConfiguration: true,
    async state(settings, url, _tabId, directives = {}) {
      const base = anyCopyState(settings, url);
      const site = base.supported ? siteKey(url) : '';
      const entry = site ? (await sessionStorage.get(key(site)))[key(site)] : null;
      const sessionOverride = typeof entry?.active === 'boolean';
      const persistent = base.supported && directives[product.id]?.persistent === true;
      const active = sessionOverride ? entry.active : persistent || base.active;
      const savedSitePolicy = !!site && base.siteRules.some(rule => ownsRule(rule, site));
      return {
        ...base, site, active, enabled: active, sessionOverride,
        persistentPolicy: savedSitePolicy || base.active || persistent, savedSitePolicy,
        coordinated: persistent,
        coordinationSource: persistent ? String(directives[product.id].source || '') : ''
      };
    },
    async sync(context, settings) {
      const state = await product.state(settings, context.topUrl, context.tabId, context.directives);
      await pageRuntimeHost.sync(product, context, state.active);
      return state.active;
    },
    async handleMessage(message, context = {}) {
      if (message.type === 'UI_TOGGLE_SITE_FEATURE') {
        if (context.sender?.url !== chrome.runtime.getURL('popup/index.html')) {
          throw new Error('Any Copy website choices are available only from the popup.');
        }
        if (message.scope && !['session', 'persistent'].includes(message.scope)) throw new Error('Unknown Any Copy scope.');
        const initial = await currentPage(message);
        return siteUpdates.run(initial.site, async () => {
          const { tab, url, site } = await currentPage(message);
          let settings = await platform.readSettings();
          if (message.scope === 'persistent') {
            const previous = (await sessionStorage.get(key(site)))[key(site)];
            let temporaryChanged = false;
            try {
              settings = await platform.mutateSettings(async current => {
                const saved = current[product.id].siteRules.some(rule => ownsRule(rule, site));
                const rule = isIpAddress(site) || site === 'localhost' || siteKey('https://cg-site-check.' + site) !== site
                  ? site : '*.' + site;
                if (!saved) {
                  const directives = await context.resolvePageDirectives?.(url);
                  const before = await product.state(current, url, tab.id, directives);
                  if (!before.active) {
                    await sessionStorage.set({ [key(site)]: { active: true } });
                    temporaryChanged = true;
                  }
                }
                return updateFeature(current, product.id, feature => ({ ...feature,
                  siteRules: saved ? feature.siteRules.filter(rule => !ownsRule(rule, site)) : [...feature.siteRules, rule]
                }));
              }, false);
            } catch (error) {
              if (temporaryChanged) {
                if (previous === undefined) await sessionStorage.remove(key(site)).catch(() => {});
                else await sessionStorage.set({ [key(site)]: previous }).catch(() => {});
              }
              throw error;
            }
            const directives = await context.resolvePageDirectives?.(url);
            const state = await product.state(settings, url, tab.id, directives);
            platform.notifyCentralUi?.();
            await refreshSite(site, state.active).catch(() => {});
            return state;
          }
          const directives = await context.resolvePageDirectives?.(url);
          const state = await product.state(settings, url, tab.id, directives);
          const active = !state.active;
          // Browser-session storage survives worker suspension, but never Chrome exit.
          await sessionStorage.set({ [key(site)]: { active } });
          platform.notifyCentralUi?.();
          await refreshSite(site, active).catch(() => {});
          return { ...state, active, enabled: active, sessionOverride: true };
        });
      }
      if (!['UI_ADD_RULE', 'UI_DELETE_RULE', 'UI_ALPHABETIZE_RULES', 'UI_CLEAR_RULES'].includes(message.type)
        || message.listName !== 'siteRules') {
        throw new Error('Any Copy does not support this command.');
      }
      if (!String(context.sender?.url || '').startsWith(chrome.runtime.getURL('settings/'))) {
        throw new Error('Any Copy rules can be managed only from Settings.');
      }
      const hostname = ['UI_ADD_RULE', 'UI_DELETE_RULE'].includes(message.type)
        ? normalizeRule(message.rule || message.hostname || '') : '';
      const settings = await platform.mutateSettings(current => updateFeature(current, product.id, feature => ({
        ...feature,
        siteRules: message.type === 'UI_CLEAR_RULES' ? []
          : message.type === 'UI_ALPHABETIZE_RULES' ? [...feature.siteRules].sort((a, b) => a.localeCompare(b))
            : message.type === 'UI_DELETE_RULE' ? feature.siteRules.filter(rule => rule !== hostname)
              : feature.siteRules.includes(hostname) ? feature.siteRules : [...feature.siteRules, hostname]
      })));
      return settings[product.id];
    },
    async reset() {
      await siteUpdates.drain();
      const keys = Object.keys(await sessionStorage.get(null)).filter(value => value.startsWith(SESSION_PREFIX));
      if (keys.length) await sessionStorage.remove(keys);
    }
  });
  return product;
}
