import {
  FEATURE_IDS,
  INCOGNITO_SETTINGS_KEY,
  SETTINGS_KEY,
  normalizeWebsiteFixerDomain,
  normalizeWebsiteFixerSite,
  updateFeature,
  websiteFixerState
} from '../../../core/config.js';
import { normalizeGeneralDomainInput, normalizeCrashPageWardenRuleInput } from '../../../core/website-rule-input.js';
import { createCrashPageWarden } from './website-fixer-warden.js';
import { createStayOnPage } from './website-fixer-stay.js';
import { createWebsiteFixerTools, effectiveWebsiteFixerSettings, hasSavedToolSite, savedToolDomains, toolChoices, toolSite, websiteToolFamily, websiteToolEnabled, WEBSITE_TOOL_KINDS } from './website-fixer-tools.js';

const SCRIPT_ID = 'cosmic-gemini-website-fixer-translate';
const SCRIPT_FILE = 'content/website-fixer/website-fixer-translate.js';
const DOMAIN_LIMIT = 100;

const STAY_SCRIPTS = ['cosmic-gemini-website-fixer-stay-main', 'cosmic-gemini-website-fixer-stay-isolated'];
const TOOL_SCRIPTS = [SCRIPT_ID + '-session', ...STAY_SCRIPTS.map(id => id + '-session')];

export function createWebsiteFixerProduct(platform) {
  const incognito = platform.isIncognitoContext?.() === true;
  const scriptId = id => incognito ? id + '-incognito' : id;
  const contextFile = kind => `content/website-fixer/website-fixer-${kind}-${incognito ? 'incognito' : 'regular'}.js`;
  const tools = createWebsiteFixerTools(platform);
  const warden = createCrashPageWarden(platform);
  const stay = createStayOnPage({ ...platform, readSettings: async () =>
    effectiveWebsiteFixerSettings(await platform.readSettings(), await tools.read()) });
  let queue = Promise.resolve();
  let commands = Promise.resolve();
  const command = task => {
    const result = commands.then(task);
    commands = result.catch(() => undefined);
    return result;
  };
  const serialize = task => {
    const operation = queue.then(task);
    queue = operation.catch(() => undefined);
    return operation;
  };

  const reconcile = (providedSettings, providedTools) => serialize(async () => {
    const settings = providedSettings || await platform.readSettings();
    const temporary = providedTools || await tools.read();
    await stay.reconcile(effectiveWebsiteFixerSettings(settings, temporary));
    await warden.reconcile(settings, temporary);
    const matches = domains => domains.map(domain => `*://*.${domain}/*`).sort();
    const translateMatches = matches(savedToolDomains(settings, 'translateOverride'));
    const stayMatches = matches(savedToolDomains(settings, 'stayOnPage'));
    const translateExcluded = matches(toolChoices(temporary, 'translateOverride', false));
    const stayExcluded = matches(toolChoices(temporary, 'stayOnPage', false));
    const scripts = [{ id: scriptId(SCRIPT_ID), matches: translateMatches, excludeMatches: translateExcluded, js: [SCRIPT_FILE, contextFile('translate')], world: 'ISOLATED', allFrames: false },
      ...STAY_SCRIPTS.map((id, index) => ({ id: scriptId(id), matches: stayMatches, excludeMatches: stayExcluded,
        js: index === 0 ? ['content/website-fixer/website-fixer-site-key.js', 'content/website-fixer/website-fixer-stay.js']
          : ['content/website-fixer/website-fixer-stay-browser-menu.js', contextFile('stay')],
        world: index === 0 ? 'MAIN' : 'ISOLATED', allFrames: true, matchOriginAsFallback: true })),
      { id: scriptId(TOOL_SCRIPTS[0]), matches: matches(toolChoices(temporary, 'translateOverride', true)),
        js: [SCRIPT_FILE, 'content/website-fixer/website-fixer-tool-translate.js'], world: 'ISOLATED', allFrames: false, persistAcrossSessions: false },
      ...TOOL_SCRIPTS.slice(1).map((id, index) => ({ id: scriptId(id), matches: matches(toolChoices(temporary, 'stayOnPage', true)),
        js: index === 0 ? ['content/website-fixer/website-fixer-site-key.js', 'content/website-fixer/website-fixer-stay.js']
          : ['content/website-fixer/website-fixer-stay-browser-menu.js', 'content/website-fixer/website-fixer-tool-stay.js'],
        world: index === 0 ? 'MAIN' : 'ISOLATED', allFrames: true, matchOriginAsFallback: true, persistAcrossSessions: false }))];
    const registered = await chrome.scripting.getRegisteredContentScripts({ ids: scripts.map(script => script.id) });
    for (const desired of scripts) {
      const current = registered.find(script => script.id === desired.id);
      if (!desired.matches.length) {
        if (current) await chrome.scripting.unregisterContentScripts({ ids: [desired.id] });
        continue;
      }
      const script = { ...desired, runAt: 'document_start', persistAcrossSessions: desired.persistAcrossSessions ?? !incognito };
      if (current && Object.entries(script).every(([key, value]) => JSON.stringify(current[key]) === JSON.stringify(value))) continue;
      if (current) await chrome.scripting.updateContentScripts([script]);
      else await chrome.scripting.registerContentScripts([script]);
    }
  });

  async function ensureReconciled(settings, temporary) {
    let failure;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try { return await reconcile(settings, temporary); }
      catch (error) {
        failure = error;
        if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 40 * (attempt + 1)));
      }
    }
    throw failure;
  }

  return Object.freeze({
    id: FEATURE_IDS.WEBSITE_FIXER,
    async state(settings, url) {
      const temporary = await tools.read();
      return { ...websiteFixerState(settings, url),
        active: WEBSITE_TOOL_KINDS.some(kind => websiteToolEnabled(settings, temporary, kind, url)),
        tools: tools.state(url, temporary, settings) };
    },
    async handleMessage(message, context) {
      if (message.type === 'CG_CRASH_PAGE_WARDEN_HEARTBEAT') return warden.heartbeat(context.sender, message.visible);
      if (message.type === 'CG_WEBSITE_FIXER_ACTIVATE') {
        if (message.kind === 'crashPageWarden') await commands;
        const settings = await platform.readSettings(); // Also verifies a fresh private-window session.
        if (message.kind === 'crashPageWarden') return warden.activate(settings, await tools.read(), context.sender);
        return { active: ['translateOverride', 'stayOnPage'].includes(message.kind)
          && websiteToolEnabled(settings, await tools.read(), message.kind, context.sender.url) };
      }
      if (message.type === 'CG_WEBSITE_FIXER_CONTEXT_MENU') {
        return stay.handleContextMenu(message, context.sender);
      }
      if (message.type === 'UI_SET_WEBSITE_FIXER_TOOL') {
        if (context.sender.url !== chrome.runtime.getURL('popup/index.html')) throw new Error('Website tools can be changed only from the popup.');
        return command(async () => {
          let settings = await platform.readSettings();
          const previous = await tools.read();
          if (message.scope && !['session', 'persistent'].includes(message.scope)) throw new Error('Unknown website tool scope.');
          let candidate = await tools.candidate(message, previous);
          if (message.scope === 'persistent') {
            let temporaryChanged = false;
            try {
              settings = await platform.mutateSettings(async current => {
                const saved = hasSavedToolSite(current, message.kind, candidate.site);
                const enableTemporary = !saved && !websiteToolEnabled(current, previous, message.kind, `https://${candidate.site}/`);
                if (enableTemporary) candidate = { ...candidate, tools: tools.withChoice(previous, message.kind, candidate.site, true) };
                const next = updateFeature(current, FEATURE_IDS.WEBSITE_FIXER, feature => {
                  const group = feature[message.kind];
                  const domains = group.whitelistDomains.filter(domain => websiteToolFamily(domain) !== candidate.site);
                  if (!saved && domains.length >= DOMAIN_LIMIT) throw new Error('Website Fixer has reached its domain limit.');
                  return { ...feature, [message.kind]: { ...group,
                    whitelistDomains: saved ? domains : [...domains, message.kind === 'crashPageWarden' ? '*.' + candidate.site : candidate.site]
                  } };
                });
                await ensureReconciled(next, candidate.tools);
                if (enableTemporary) { await tools.write(candidate.tools); temporaryChanged = true; }
                return next;
              }, false);
            } catch (error) {
              if (temporaryChanged) await tools.write(previous).catch(() => {});
              await ensureReconciled().catch(() => {});
              throw error;
            }
          } else {
            try {
              await ensureReconciled(settings, candidate.tools);
              await tools.write(candidate.tools);
            } catch (error) {
              await ensureReconciled().catch(() => {});
              throw error;
            }
          }
          if (message.kind === 'crashPageWarden') await warden.syncSites([candidate.site], settings, candidate.tools);
          else await tools.syncSites([candidate.site], effectiveWebsiteFixerSettings(settings, candidate.tools));
          platform.notifyCentralUi?.();
          return tools.state(`https://${candidate.site}/`, candidate.tools, settings);
        });
      }
      if (!String(context.sender.url || '').startsWith(chrome.runtime.getURL('settings/'))) {
        throw new Error('Website Fixer can be changed only from Settings.');
      }
      return command(async () => {
        let revise;
        if (message.type === 'UI_SET_ENABLED') {
          revise = feature => ({ ...feature, enabled: true }); // Frozen compatibility command; no Settings switch.
        } else if (['UI_SET_WEBSITE_FIXER_TRANSLATE_OVERRIDE', 'UI_SET_WEBSITE_FIXER_STAY_ON_PAGE', 'UI_SET_CRASH_PAGE_WARDEN'].includes(message.type)) {
          const group = message.type === 'UI_SET_CRASH_PAGE_WARDEN' ? 'crashPageWarden' : message.type === 'UI_SET_WEBSITE_FIXER_STAY_ON_PAGE' ? 'stayOnPage' : 'translateOverride';
          revise = feature => ({ ...feature, [group]: { ...feature[group], enabled: message.enabled === true } });
        } else if (['UI_ADD_RULE', 'UI_DELETE_RULE', 'UI_ALPHABETIZE_RULES', 'UI_CLEAR_RULES'].includes(message.type)
          && message.listName === 'whitelistDomains') {
          const group = message.settingGroup || 'translateOverride';
          if (!WEBSITE_TOOL_KINDS.includes(group)) throw new Error('Unknown Website Fixer option.');
          const normalize = group === 'crashPageWarden' ? normalizeCrashPageWardenRuleInput : group === 'stayOnPage' ? normalizeWebsiteFixerSite : normalizeWebsiteFixerDomain;
          const domain = ['UI_ADD_RULE', 'UI_DELETE_RULE'].includes(message.type)
            ? normalize(group === 'crashPageWarden' ? message.rule : normalizeGeneralDomainInput(message.rule || '')) : '';
          revise = feature => {
            const current = feature[group].whitelistDomains;
            if (message.type === 'UI_ADD_RULE' && current.length >= DOMAIN_LIMIT && !current.includes(domain)) {
              throw new Error('Website Fixer has reached its domain limit.');
            }
            const domains = message.type === 'UI_ADD_RULE' ? current.includes(domain) ? current : [...current, domain]
              : message.type === 'UI_DELETE_RULE' ? current.filter(item => item !== domain)
                : message.type === 'UI_CLEAR_RULES' ? [] : [...current].sort((a, b) => a.localeCompare(b));
            return { ...feature, [group]: { ...feature[group], whitelistDomains: domains } };
          };
        } else throw new Error('Website Fixer does not support this command.');
        try {
          const settings = await platform.mutateSettings(async current => {
            const next = updateFeature(current, FEATURE_IDS.WEBSITE_FIXER, revise);
            await ensureReconciled(next);
            return next;
          });
          if (message.type === 'UI_SET_CRASH_PAGE_WARDEN' || message.settingGroup === 'crashPageWarden') {
            await warden.syncSites(settings.websiteFixer.crashPageWarden.whitelistDomains.map(websiteToolFamily), settings, await tools.read());
          }
          return settings.websiteFixer;
        } catch (error) {
          // A failed storage write or partial registration must leave the last
          // saved website lists and their installed rules in agreement.
          await ensureReconciled().catch(() => {});
          throw error;
        }
      });
    },
    initialize: () => ensureReconciled(),
    handleNavigationRequest: stay.handleNavigationRequest,
    async handleTabCreated(tab) {
      await stay.handleTabCreated(tab);
      return ensureReconciled();
    },
    async handleTabUpdated(tabId, change, tab) {
      await warden.handleTabUpdated(tabId, change);
      await stay.handleTabUpdated(tabId, change, tab);
      if (change.url) return ensureReconciled();
    },
    async handleTabRemoved(tabId) {
      await warden.handleTabRemoved(tabId);
      stay.handleTabRemoved(tabId);
      return ensureReconciled();
    },
    handleStorageChanged(changes) {
      const key = platform.isIncognitoContext?.() === true ? INCOGNITO_SETTINGS_KEY : SETTINGS_KEY;
      const change = changes[key];
      if (!change || JSON.stringify(change.oldValue?.websiteFixer) === JSON.stringify(change.newValue?.websiteFixer)) return;
      return ensureReconciled();
    },
    reset() { return command(() => serialize(async () => {
      const previous = await tools.read();
      await tools.clear();
      await stay.reset();
      await warden.reset();
      const registered = await chrome.scripting.getRegisteredContentScripts({ ids: [SCRIPT_ID, ...STAY_SCRIPTS, ...TOOL_SCRIPTS].map(scriptId) });
      if (registered.length) await chrome.scripting.unregisterContentScripts({ ids: registered.map(script => script.id) });
      const settings = effectiveWebsiteFixerSettings(await platform.readSettings(), await tools.read());
      await tools.syncSites([...new Set([...previous.translateOverride.map(entry => entry.site), ...previous.stayOnPage.map(entry => entry.site)])], settings);
    })); }
  });
}
