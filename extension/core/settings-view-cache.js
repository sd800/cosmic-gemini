export const SETTINGS_VIEW_CACHE_KEY = 'cosmicGeminiSettingsViewCache';

function rules(value) {
  return Array.isArray(value) ? value.filter(rule => typeof rule === 'string') : [];
}

export function settingsViewCache(states = {}) {
  return {
    nativeScroll: {
      enabled: states.nativeScroll?.enabled !== false,
      enabledRules: rules(states.nativeScroll?.enabledRules),
      enhancedRules: rules(states.nativeScroll?.enhancedRules),
      whitelistRules: rules(states.nativeScroll?.whitelistRules),
      standardRules: rules(states.nativeScroll?.standardRules)
    },
    noAutoplay: {
      enabled: states.noAutoplay?.enabled !== false,
      enabledRules: rules(states.noAutoplay?.enabledRules),
      enhancedRules: rules(states.noAutoplay?.enhancedRules),
      whitelistRules: rules(states.noAutoplay?.whitelistRules),
      standardRules: rules(states.noAutoplay?.standardRules),
      audioAutoplayAllSites: states.noAutoplay?.audioAutoplayAllSites === true,
      permanentAudioAllowRules: rules(states.noAutoplay?.permanentAudioAllowRules)
    },
    anyCopy: {
      siteRules: rules(states.anyCopy?.siteRules)
    },
    anyCopyEnhanced: {
      siteRules: rules(states.anyCopyEnhanced?.siteRules)
    },
    imageDownload: {
      workspaceMode: states.imageDownload?.workspaceMode === 'page' ? 'page' : 'sidePanel',
      batchMode: states.imageDownload?.batchMode === 'separate' ? 'separate' : 'zip',
      outputFormat: states.imageDownload?.outputFormat || 'original',
      askWhereToSave: states.imageDownload?.askWhereToSave !== false
    },
    videoDownload: {
      preferredQuality: states.videoDownload?.preferredQuality || 'best',
      askWhereToSave: states.videoDownload?.askWhereToSave !== false
    },
    satellites: {
      biliDailyLogin: { enabled: states.satellites?.biliDailyLogin?.enabled === true }
    }
  };
}

export function saveSettingsViewCache(states, storage = globalThis.localStorage) {
  try { storage?.setItem(SETTINGS_VIEW_CACHE_KEY, JSON.stringify(settingsViewCache(states))); } catch {}
}
