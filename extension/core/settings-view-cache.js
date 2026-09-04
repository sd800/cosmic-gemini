export const SETTINGS_VIEW_CACHE_KEY = 'cosmicGeminiSettingsViewCache';

function rules(value) {
  return Array.isArray(value) ? value.filter(rule => typeof rule === 'string') : [];
}

export function settingsViewCache(states = {}) {
  return {
    version: 23,
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
    pageDisplay: {
      reduceWhitePoint: {
        enabled: states.pageDisplay?.reduceWhitePoint?.enabled === true,
        reduction: Number.isFinite(Number(states.pageDisplay?.reduceWhitePoint?.reduction))
          ? Math.min(0.8, Math.max(0.1, Number(states.pageDisplay.reduceWhitePoint.reduction)))
          : 0.25
      },
      greyscale: {
        enabled: states.pageDisplay?.greyscale?.enabled === true
      }
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
      managedSites: {
        tencentNews: states.adMarshal?.managedSites?.tencentNews === true,
        douyin: states.adMarshal?.managedSites?.douyin === true,
        zhihu: states.adMarshal?.managedSites?.zhihu === true,
        gmail: states.adMarshal?.managedSites?.gmail === true
      }
    }
  };
}

export function saveSettingsViewCache(states, storage = globalThis.localStorage) {
  try { storage?.setItem(SETTINGS_VIEW_CACHE_KEY, JSON.stringify(settingsViewCache(states))); } catch {}
}
