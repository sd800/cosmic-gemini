import { hostnameFromUrl, normalizeWebsiteFixerSite, ruleMatches } from '../../../core/config.js';
import { siteKey } from '../../../core/site-key.js';

export const WEBSITE_TOOL_KINDS = Object.freeze(['translateOverride', 'stayOnPage', 'crashPageWarden']);
const SESSION_KEY = 'cosmicGeminiWebsiteFixerTools';
const LIMIT = 100;
const empty = () => ({ translateOverride: [], stayOnPage: [], crashPageWarden: [] });

export function toolSite(url) {
  const hostname = hostnameFromUrl(url);
  try {
    const site = hostname ? normalizeWebsiteFixerSite(hostname) : '';
    // A bare public suffix has no eTLD+1. Do not turn a host such as a shared
    // hosting suffix into an allowance for every independent tenant below it.
    return site && siteKey('https://cg-site-check.' + site) === site ? site : '';
  } catch { return ''; }
}

export function savedToolDomains(settings, kind) {
  const feature = settings.websiteFixer;
  const saved = feature[kind];
  return feature.enabled && saved.enabled ? saved.whitelistDomains : [];
}

export function toolChoices(tools, kind, enabled) {
  return tools[kind].filter(entry => entry.enabled === enabled).map(entry => entry.site);
}

export const websiteToolRule = (kind, domain) => kind === 'crashPageWarden' ? domain : '*.' + domain;
export const websiteToolFamily = rule => toolSite('https://' + rule.replace(/^\*\./, ''));

export function hasSavedToolSite(settings, kind, site) {
  return settings.websiteFixer[kind].whitelistDomains.some(domain => websiteToolFamily(domain) === site);
}

export function websiteToolEnabled(settings, tools, kind, url) {
  const site = toolSite(url), hostname = hostnameFromUrl(url);
  if (!site) return false;
  const override = tools[kind].find(entry => entry.site === site);
  return override ? override.enabled : savedToolDomains(settings, kind)
    .some(domain => ruleMatches(hostname, websiteToolRule(kind, domain)));
}

export function effectiveWebsiteFixerSettings(settings, tools) {
  const feature = settings.websiteFixer;
  return { ...settings, websiteFixer: { ...feature, enabled: true,
    ...Object.fromEntries(WEBSITE_TOOL_KINDS.map(kind => {
      const excludedDomains = toolChoices(tools, kind, false);
      return [kind, { ...feature[kind], enabled: true, excludedDomains,
        whitelistDomains: [...new Set([...savedToolDomains(settings, kind)
          .filter(domain => !excludedDomains.includes(websiteToolFamily(domain))), ...toolChoices(tools, kind, true)])]
      }];
    }))
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
        // Migrate earlier session-only positive lists without promoting them to saved rules.
        const entry = typeof value === 'string' ? { site: value, enabled: true } : value;
        if (typeof entry?.site !== 'string' || typeof entry.enabled !== 'boolean') continue;
        const site = toolSite('https://' + entry.site);
        if (site && !tools[kind].some(item => item.site === site)) tools[kind].push({ site, enabled: entry.enabled });
      }
    }
    return tools;
  }
  const permits = (settings, kind, url) => {
    const hostname = hostnameFromUrl(url);
    return !!hostname && !settings.websiteFixer[kind].excludedDomains?.includes(toolSite(url))
      && settings.websiteFixer[kind].whitelistDomains.some(domain => ruleMatches(hostname, websiteToolRule(kind, domain)));
  };
  return {
    read,
    async write(tools) {
      if (!storage) throw new Error('Browser session storage is unavailable.');
      if (WEBSITE_TOOL_KINDS.every(kind => !tools[kind].length)) await storage.remove(SESSION_KEY);
      else await storage.set({ [SESSION_KEY]: tools });
    },
    clear: () => storage?.remove(SESSION_KEY),
    state(url, tools, settings) {
      const site = toolSite(url);
      return { site, supported: !!site && !!storage,
        persistent: Object.fromEntries(WEBSITE_TOOL_KINDS.map(kind => [kind, !!site && hasSavedToolSite(settings, kind, site)])),
        persistentEnabled: Object.fromEntries(WEBSITE_TOOL_KINDS.map(kind => [kind, settings.websiteFixer[kind].enabled === true])),
        ...Object.fromEntries(WEBSITE_TOOL_KINDS.map(kind => [kind, !!site && websiteToolEnabled(settings, tools, kind, url)])) };
    },
    async candidate(message, current) {
      if (!WEBSITE_TOOL_KINDS.includes(message.kind) || typeof message.enabled !== 'boolean') throw new Error('Unknown website tool.');
      if (!Number.isInteger(message.tabId) || message.tabId < 0) throw new Error('The current tab is unavailable.');
      const tab = await chrome.tabs.get(message.tabId);
      const site = toolSite(tab.pendingUrl || tab.url);
      if (!site || site !== message.expectedSite || !!tab.incognito !== incognito) {
        throw new Error('The page changed before the action completed.');
      }
      return { site, tools: message.scope === 'persistent' ? current : this.withChoice(current, message.kind, site, message.enabled) };
    },
    withChoice(current, kind, site, enabled) {
      const domains = current[kind];
      if (domains.length >= LIMIT && !domains.some(entry => entry.site === site)) throw new Error('The website tool has reached its session limit.');
      return { ...current, [kind]: [...domains.filter(entry => entry.site !== site), { site, enabled }] };
    },
    async syncSites(sites, settings, kinds = ['translateOverride', 'stayOnPage']) {
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
          if (frame.frameId === 0 && kinds.includes('translateOverride')) {
            if (permits(settings, 'translateOverride', url)) {
              await chrome.scripting.executeScript({ target, world: 'ISOLATED', files: [
                'content/website-fixer/website-fixer-translate.js', 'content/website-fixer/website-fixer-tool-translate.js'
              ] });
            } else await chrome.scripting.executeScript({ target, world: 'ISOLATED', func: () => {
              const pending = globalThis[Symbol.for('cosmic-gemini.website-fixer.translate-pending')];
              if (pending) pending.revision += 1;
              globalThis[Symbol.for('cosmic-gemini.website-fixer.translate')]?.dispose?.();
            } });
          }
          if (!kinds.includes('stayOnPage')) continue;
          if (permits(settings, 'stayOnPage', url)) {
            await chrome.scripting.executeScript({ target, world: 'MAIN', files: [
              'content/website-fixer/website-fixer-site-key.js', 'content/website-fixer/website-fixer-stay.js'
            ] });
            await chrome.scripting.executeScript({ target, world: 'ISOLATED', files: [
              'content/website-fixer/website-fixer-stay-browser-menu.js', 'content/website-fixer/website-fixer-tool-stay.js'
            ] });
          } else {
            const stopped = await chrome.scripting.executeScript({ target, world: 'ISOLATED', func: () => {
              const pending = globalThis[Symbol.for('cosmic-gemini.website-fixer.stay-pending')];
              if (pending) pending.revision += 1;
              const menu = globalThis[Symbol.for('cosmic-gemini.website-fixer.stay-menu')];
              if (!menu) return false;
              menu.dispose();
              return true;
            } });
            // Document rebuilding can erase the MAIN-world deactivate listener.
            // A known isolated controller authorizes this additional cleanup.
            if (stopped.some(result => result.result === true)) await chrome.scripting.executeScript({ target, world: 'MAIN', func: () => {
              globalThis[Symbol.for('cosmic-gemini.website-fixer.stay-bootstrap')]?.deactivate?.();
            } });
          }
        }
      }));
    }
  };
}
