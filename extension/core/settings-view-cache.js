export const SETTINGS_VIEW_CACHE_KEY = 'cosmicGeminiSettingsViewCache';

function rules(value) {
  return Array.isArray(value) ? value.filter(rule => typeof rule === 'string') : [];
}

export function settingsViewCache(states = {}) {
  return {
    version: 20,
    nsna: {
      whitelistRules: rules(states.nsna?.whitelistRules)
    },
    nativeScroll: {
      enabled: states.nativeScroll?.enabled !== false,
      inactiveRules: rules(states.nativeScroll?.inactiveRules),
      enhancedRules: rules(states.nativeScroll?.enhancedRules),
      standardRules: rules(states.nativeScroll?.standardRules)
    },
    noAutoplay: {
      enabled: states.noAutoplay?.enabled !== false,
      inactiveRules: rules(states.noAutoplay?.inactiveRules),
      enhancedRules: rules(states.noAutoplay?.enhancedRules),
      standardRules: rules(states.noAutoplay?.standardRules),
      audioAutoplayAllSites: states.noAutoplay?.audioAutoplayAllSites === true,
      permanentAudioAllowRules: rules(states.noAutoplay?.permanentAudioAllowRules)
    },
    anyCopy: {
      siteRules: rules(states.anyCopy?.siteRules)
    },
    mailtoCapture: {
      enabled: states.mailtoCapture?.enabled !== false
    },
    xhsImageDarkMode: {
      enabled: states.xhsImageDarkMode?.enabled === true,
      overrideDarkMode: states.xhsImageDarkMode?.overrideDarkMode === true,
      showImageControl: states.xhsImageDarkMode?.showImageControl !== false,
      controlOpacity: states.xhsImageDarkMode?.controlOpacity || 0.5
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
    },
    adMarshal: {
      enabled: states.adMarshal?.enabled === true
    }
  };
}

export function saveSettingsViewCache(states, storage = globalThis.localStorage) {
  try { storage?.setItem(SETTINGS_VIEW_CACHE_KEY, JSON.stringify(settingsViewCache(states))); } catch {}
}
