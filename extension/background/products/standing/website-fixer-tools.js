import { hostnameFromUrl, normalizeWebsiteFixerSite, ruleMatches } from '../../../core/config.js';
import { siteKey } from '../../../core/site-key.js';

export const WEBSITE_TOOL_KINDS = Object.freeze(['translateOverride', 'stayOnPage']);
const SESSION_KEY = 'cosmicGeminiWebsiteFixerTools';
const LIMIT = 100;
const empty = () => ({ translateOverride: [], stayOnPage: [] });

export function toolSite(url) {
  const hostname = hostnameFromUrl(url);
  try {
    const site = hostname ? normalizeWebsiteFixerSite(hostname) : '';
    // A bare public suffix has no eTLD+1. Do not turn a host such as a shared
    // hosting suffix into an allowance for every independent tenant below it.
    return site && siteKey('https://cg-site-check.' + site) === site ? site : '';
  } catch { return ''; }
}

export function effectiveWebsiteFixerSettings(settings, tools) {
  const feature = settings.websiteFixer;
  return { ...settings, websiteFixer: { ...feature, enabled: true,
    ...Object.fromEntries(WEBSITE_TOOL_KINDS.map(kind => [kind, { ...feature[kind], enabled: true,
      whitelistDomains: [...new Set([
        ...(feature.enabled && feature[kind].enabled ? feature[kind].whitelistDomains : []), ...tools[kind]
      ])]
    }]))
  } };
}

export function createWebsiteFixerTools(platform) {
  const storage = platform.sessionStorage;
  const incognito = platform.isIncognitoContext?.() === true;
  async function read() {
    const saved = storage ? (await storage.get(SESSION_KEY))[SESSION_KEY] : null;
    const tools = empty();
    for (const kind of WEBSITE_TOOL_KINDS) {
      for (const value of Array.isArray(saved?.[kind]) ? saved[kind].slice(0, LIMIT) : []) {
        if (typeof value !== 'string') continue;
        try {
          const site = toolSite('https://' + value);
          if (!site) continue;
          if (!tools[kind].includes(site)) tools[kind].push(site);
        } catch {}
      }
    }
    return tools;
  }
  const permits = (settings, kind, url) => {
    const hostname = hostnameFromUrl(url);
    return !!hostname && settings.websiteFixer[kind].whitelistDomains.some(domain => ruleMatches(hostname, '*.' + domain));
  };
  return {
    read,
    async write(tools) {
      if (!storage) throw new Error('Browser session storage is unavailable.');
      if (WEBSITE_TOOL_KINDS.every(kind => !tools[kind].length)) await storage.remove(SESSION_KEY);
      else await storage.set({ [SESSION_KEY]: tools });
    },
    clear: () => storage?.remove(SESSION_KEY),
    state(url, tools) {
      const site = toolSite(url);
      return { site, supported: !!site && !!storage,
        ...Object.fromEntries(WEBSITE_TOOL_KINDS.map(kind => [kind, !!site && tools[kind].includes(site)])) };
    },
    async candidate(message, current) {
      if (!WEBSITE_TOOL_KINDS.includes(message.kind) || typeof message.enabled !== 'boolean') throw new Error('Unknown website tool.');
      if (!Number.isInteger(message.tabId) || message.tabId < 0) throw new Error('The current tab is unavailable.');
      const tab = await chrome.tabs.get(message.tabId);
      const site = toolSite(tab.pendingUrl || tab.url);
      if (!site || site !== message.expectedSite || !!tab.incognito !== incognito) {
        throw new Error('The page changed before the action completed.');
      }
      const domains = current[message.kind];
      if (message.enabled && domains.length >= LIMIT && !domains.includes(site)) throw new Error('The website tool has reached its session limit.');
      return { site, tools: { ...current, [message.kind]: message.enabled
        ? [...new Set([...domains, site])] : domains.filter(value => value !== site) } };
    },
    async syncSites(sites, settings) {
      const selected = new Set(sites);
      if (!selected.size) return;
      const tabs = (await chrome.tabs.query({})).filter(tab => !!tab.incognito === incognito && selected.has(toolSite(tab.url)));
      await Promise.allSettled(tabs.map(async tab => {
        const site = toolSite(tab.url);
        // Read only current frame identities; bind subsequent work to document
        // IDs so a navigation cannot transfer a tool to an unrelated document.
        const frames = await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true },
          func: () => ({ href: location.href, origin: location.origin, referrer: document.referrer }) });
        for (const frame of frames) {
          const value = frame.result;
          if (!value || !frame.documentId) continue;
          const url = /^https?:/.test(value.href) ? value.href
            : value.origin && value.origin !== 'null' ? value.origin : value.referrer;
          if (siteKey(url) !== site) continue;
          const target = { tabId: tab.id, documentIds: [frame.documentId] };
          if (frame.frameId === 0) {
            if (permits(settings, 'translateOverride', url)) {
              await chrome.scripting.executeScript({ target, world: 'ISOLATED', files: [
                'content/website-fixer/website-fixer-translate.js', 'content/website-fixer/website-fixer-tool-translate.js'
              ] });
            } else await chrome.scripting.executeScript({ target, world: 'ISOLATED', func: () => {
              globalThis[Symbol.for('cosmic-gemini.website-fixer.translate')]?.dispose?.();
            } });
          }
          if (permits(settings, 'stayOnPage', url)) {
            await chrome.scripting.executeScript({ target, world: 'MAIN', files: [
              'content/website-fixer/website-fixer-site-key.js', 'content/website-fixer/website-fixer-stay.js'
            ] });
            await chrome.scripting.executeScript({ target, world: 'ISOLATED', files: [
              'content/website-fixer/website-fixer-stay-browser-menu.js', 'content/website-fixer/website-fixer-tool-stay.js'
            ] });
          } else await chrome.scripting.executeScript({ target, world: 'ISOLATED', func: () => {
            globalThis[Symbol.for('cosmic-gemini.website-fixer.stay-menu')]?.dispose?.();
          } });
        }
      }));
    }
  };
}
