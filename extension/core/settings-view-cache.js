export const SETTINGS_VIEW_CACHE_KEY = 'cosmicGeminiSettingsViewCache';

function rules(value) {
  return Array.isArray(value) ? value.filter(rule => typeof rule === 'string') : [];
}

export function settingsViewCache(states = {}) {
  return {
    nativeScroll: {
      enabled: states.nativeScroll?.enabled !== false,
      enhancedRules: rules(states.nativeScroll?.enhancedRules),
      whitelistRules: rules(states.nativeScroll?.whitelistRules)
    },
    noAutoplay: {
      enabled: states.noAutoplay?.enabled !== false,
      enhancedRules: rules(states.noAutoplay?.enhancedRules),
      whitelistRules: rules(states.noAutoplay?.whitelistRules),
      permanentAudioAllowRules: rules(states.noAutoplay?.permanentAudioAllowRules)
    },
    anyCopy: {
      enforcedRules: rules(states.anyCopy?.enforcedRules),
      enhancedRules: rules(states.anyCopy?.enhancedRules)
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
