// Loaded only after the Settings shortcut. This describes ownership; it never routes work.
export const DEVELOPER_FEATURES = Object.freeze({
  nativeScroll: { title: 'nativeScrollName', tag: 'native-scroll', province: 'standing' },
  noAutoplay: { title: 'noAutoplayName', tag: 'no-autoplay', province: 'standing' },
  anyCopy: { title: 'anyCopyName', tag: 'any-copy', province: 'operations' },
  anyCopyEnhanced: { title: 'anyCopyEnhancedName', tag: 'any-copy-enhanced', province: 'operations' },
  imageDownload: { title: 'imageDownloadName', tag: 'image-download', province: 'customs' },
  videoDownload: { title: 'videoDownloadName', tag: 'video-download', province: 'customs' },
  pageDisplay: { title: 'pageDisplayName', tag: 'page-display', province: 'operations' },
  reduceWhitePoint: { title: 'reduceWhitePointName', tag: 'reduce-white-point', parent: 'pageDisplay' },
  greyscale: { title: 'greyscaleName', tag: 'greyscale', parent: 'pageDisplay' },
  satellites: { title: 'satellitesName', tag: 'satellites', province: 'operations' },
  mailtoCapture: { title: 'mailtoCaptureName', tag: 'mailto-capture', province: 'standing' },
  clipboardProtect: { title: 'clipboardProtectName', tag: 'clipboard-protect', province: 'standing' },
  accessControl: { title: 'accessControlName', tag: 'access-control', province: 'standing' },
  websiteKnowledgeControl: { title: 'websiteKnowledgeName', tag: 'website-knowledge-control', province: 'standing' },
  languages: { title: 'websiteKnowledgeLanguages', tag: 'languages', parent: 'websiteKnowledgeControl' },
  timeZone: { title: 'websiteKnowledgeTimeZone', tag: 'time-zone', parent: 'websiteKnowledgeControl' },
  globalPrivacyControl: { title: 'websiteKnowledgeGlobalPrivacyControl', tag: 'global-privacy-control', parent: 'websiteKnowledgeControl' },
  documentPreview: { title: 'documentPreviewName', tag: 'document-preview', province: 'customs' },
  adMarshal: { title: 'adMarshalName', tag: 'ad-marshal', province: 'standing' },
  websiteFixer: { title: 'websiteFixerName', tag: 'website-fixer', province: 'standing' },
  translateOverride: { title: 'websiteFixerTranslateName', tag: 'translate-override', parent: 'websiteFixer' },
  stayOnPage: { title: 'websiteFixerStayName', tag: 'stay-on-page', parent: 'websiteFixer' },
  xhsImageDarkMode: { title: 'xhsImageDarkModeSettingsName', name: 'xhsImageDarkModeName', tag: 'xhs-image-dark-mode', province: 'operations' },
  biliDailyLogin: { title: 'biliDailyLoginName', tag: 'bili-daily-login', parent: 'satellites' },
  chineseResponseClaude: { title: 'chineseResponseClaudeName', tag: 'chinese-response-claude', province: 'operations' },
  followListInstagram: { title: 'followListInstagramName', tag: 'follow-list-instagram', province: 'operations' },
  langGoogle: { title: 'langGoogleName', tag: 'lang-google', province: 'standing' }
});

const PROVINCE_NAMES = Object.freeze({
  standing: 'Standing Province', operations: 'Operations Province', customs: 'Customs Province'
});

export function featureAffiliation(id, t) {
  const names = [];
  let feature = DEVELOPER_FEATURES[id];
  while (feature) {
    names.unshift(t(feature.name || feature.title));
    if (!feature.parent) return ['Central', PROVINCE_NAMES[feature.province], ...names].join(' > ');
    feature = DEVELOPER_FEATURES[feature.parent];
  }
  return '';
}

export function createDeveloperMode(document) {
  let enabled = false;

  function clear() {
    for (const details of document.querySelectorAll('.developer-feature-details')) details.remove();
    for (const stack of document.querySelectorAll('.developer-title-stack')) stack.replaceWith(...stack.childNodes);
  }

  function render(t) {
    clear();
    if (!enabled) return;
    for (const [id, feature] of Object.entries(DEVELOPER_FEATURES)) {
      const selector = ['h1', 'h2', 'h3', 'strong'].map(tag => `${tag}[data-i18n="${feature.title}"]`).join(',');
      for (const title of document.querySelectorAll(`.primary :is(${selector})`)) {
        const details = document.createElement('span');
        details.className = 'developer-feature-details';
        details.dataset.developerFeature = id;
        details.setAttribute('translate', 'no');
        details.addEventListener('click', event => {
          event.preventDefault();
          event.stopPropagation();
        });
        const tagLine = document.createElement('span');
        tagLine.append(t('developerTechnicalTag') + ': ');
        const tag = document.createElement('code');
        tag.textContent = feature.tag;
        tagLine.append(tag);
        const affiliation = document.createElement('span');
        affiliation.textContent = t('developerAffiliation') + ': ' + featureAffiliation(id, t);
        details.append(tagLine, affiliation);
        if (title.parentElement.matches('.intro-title, .satellite-title, .rule-heading, .website-fixer-heading')) {
          const stack = document.createElement('div');
          stack.className = 'developer-title-stack';
          title.replaceWith(stack);
          stack.append(title, details);
        } else title.after(details);
      }
    }
  }

  return {
    render,
    toggle(t) {
      enabled = !enabled;
      document.documentElement.toggleAttribute('data-developer-mode', enabled);
      render(t);
    }
  };
}
