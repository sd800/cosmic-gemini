const rulePanel = (listName, headingKey, helpKey, emptyKey = '') => `
  <section class="rule-panel" data-list-section="${listName}"${emptyKey ? ` data-empty-key="${emptyKey}"` : ''}>
    <h3 data-i18n="${headingKey}"></h3>
    <p data-i18n="${helpKey}"></p>
    <form class="rule-form" novalidate>
      <input type="text" autocapitalize="none" autocomplete="off" spellcheck="false" data-i18n-placeholder="rulePlaceholder">
      <button class="primary-button" type="submit" data-i18n="add"></button>
    </form>
    <p class="form-message" aria-live="polite"></p>
    <ul class="rule-list"></ul>
  </section>`;

const behaviorPanel = (listName, headingKey, helpKey, emptyKey) => `
  <section class="behavior-rule-panel" data-behavior-list="${listName}" data-empty-key="${emptyKey}">
    <h3 data-i18n="${headingKey}"></h3>
    <p data-i18n="${helpKey}"></p>
    <ul class="rule-list behavior-rule-list"></ul>
  </section>`;

const introTitle = (iconName, headingKey) => `
  <div class="intro-title">
    <span data-section-icon="${iconName}" aria-hidden="true"></span>
    <h1 data-i18n="${headingKey}"></h1>
  </div>`;

const websiteBehaviorCard = helpKey => `
  <section class="card website-behavior-card" data-behavior-card>
    <div class="group-heading"><h2 data-i18n="websiteBehaviorHeading"></h2><p data-i18n="${helpKey}"></p></div>
    <form class="behavior-rule-form" novalidate>
      <label class="sr-only" for="website-rule" data-i18n="websiteRuleLabel"></label>
      <input id="website-rule" type="text" autocapitalize="none" autocomplete="off" spellcheck="false" data-i18n-placeholder="rulePlaceholder">
      <label class="sr-only" for="website-behavior" data-i18n="websiteBehaviorLabel"></label>
      <select id="website-behavior">
        <option value="inactive" data-i18n="inactiveSitesHeading"></option>
        <option value="standard" data-i18n="standardSitesHeading"></option>
        <option value="enhanced" data-i18n="enhancedSitesHeading"></option>
      </select>
      <button class="primary-button" type="submit" data-i18n="add"></button>
    </form>
    <p class="form-message" aria-live="polite"></p>
    <div class="behavior-rule-grid">
      ${behaviorPanel('inactiveRules', 'inactiveSitesHeading', 'inactiveSitesHelp', 'emptyInactiveSites')}
      ${behaviorPanel('standardRules', 'standardSitesHeading', 'standardSitesHelp', 'emptyStandardSites')}
      ${behaviorPanel('enhancedRules', 'enhancedSitesHeading', 'enhancedSitesHelp', 'emptyEnhancedSites')}
    </div>
    <p class="caption behavior-rule-help"><span data-i18n="exactHostnameHelp"></span><span data-i18n="wildcardHostnameHelp"></span></p>
  </section>`;

const sharedWhitelistSection = () => `
  <section class="card rule-card nsna-whitelist-card" data-feature-id="nsna" data-list-section="whitelistRules" data-empty-key="emptySharedWhitelist">
    <h2 data-i18n="sharedWhitelistHeading"></h2>
    <p data-i18n="sharedWhitelistHelp"></p>
    <form class="rule-form" novalidate>
      <input type="text" autocapitalize="none" autocomplete="off" spellcheck="false" data-i18n-placeholder="rulePlaceholder">
      <button class="primary-button" type="submit" data-i18n="add"></button>
    </form>
    <p class="form-message" aria-live="polite"></p>
    <ul class="rule-list"></ul>
    <p class="caption behavior-rule-help"><span data-i18n="exactHostnameHelp"></span><span data-i18n="wildcardHostnameHelp"></span></p>
  </section>`;

const audioAllowSection = () => `
  <fieldset id="noAutoplayAudioOptions" class="card grouped-rule-card audio-rule-card" aria-labelledby="audioAllowHeading" disabled>
    <h2 id="audioAllowHeading" data-i18n="audioAllowHeading"></h2>
    <p data-i18n="audioAllowHelp"></p>
    <label class="preference-row" for="audioAutoplayAllSites">
      <span><strong data-i18n="audioAllowAllSitesHeading"></strong><small data-i18n="audioAllowAllSitesHelp"></small></span>
      <span class="switch"><input id="audioAutoplayAllSites" type="checkbox"><span></span></span>
    </label>
    ${rulePanel('permanentAudioAllowRules', 'audioAllowedSitesHeading', 'audioAllowedSitesHelp')}
    <p class="caption behavior-rule-help"><span data-i18n="exactHostnameHelp"></span><span data-i18n="wildcardHostnameHelp"></span></p>
  </fieldset>`;

const anyCopyRuleSection = (featureId, headingKey, helpKey, emptyKey) => `
  <section class="card rule-card" data-feature-id="${featureId}" data-list-section="siteRules" data-empty-key="${emptyKey}">
    <h2 data-i18n="${headingKey}"></h2>
    <p data-i18n="${helpKey}"></p>
    <form class="rule-form" novalidate>
      <input type="text" autocapitalize="none" autocomplete="off" spellcheck="false" data-i18n-placeholder="rulePlaceholder">
      <button class="primary-button" type="submit" data-i18n="add"></button>
    </form>
    <p class="form-message" aria-live="polite"></p>
    <ul class="rule-list"></ul>
    <p class="caption adaptive-rule-help"><span data-i18n="exactHostnameHelp"></span><span data-i18n="wildcardHostnameHelp"></span></p>
  </section>`;

const settingsCard = (featureId, nameKey, descriptionKey) => `
  <a class="settings-destination" href="${PRODUCT_META[featureId].path}" data-settings-card="${featureId}">
    <span class="settings-destination-icon" data-section-icon="${featureId}" aria-hidden="true"></span>
    <span><strong data-i18n="${nameKey}"></strong><small data-i18n="${descriptionKey}"></small></span>
    <span class="settings-destination-arrow" aria-hidden="true">›</span>
  </a>`;

const help = (keys, privacyKey, list = false) => `
  <h2 data-i18n="${list ? 'setupGuideHeading' : 'helpHeading'}"></h2>
  ${list ? `<ol class="flow-list">${keys.map(key => `<li data-i18n="${key}"></li>`).join('')}</ol>` : keys.map(key => `<p data-i18n="${key}"></p>`).join('')}
  <hr><h2 data-i18n="privacyHeading"></h2><p data-i18n="${privacyKey}"></p>`;

const knowledgeLocaleOptions = `
  <option value="en-US">English (United States)</option><option value="en-GB">English (United Kingdom)</option><option value="zh-CN">简体中文（中国）</option><option value="zh-Hans">简体中文（无地区）</option><option value="zh-Hant">繁體中文（無地區）</option><option value="zh-HK">繁體中文（中國香港）</option><option value="zh-MO">繁體中文（中國澳門）</option><option value="zh-TW">繁體中文（中華台北）</option><option value="zh-MY">简体中文（马来西亚）</option><option value="zh-SG">简体中文（新加坡）</option><option value="ja-JP">日本語（日本）</option><option value="ko-KR">한국어 (대한민국)</option><option value="fr-FR">Français (France)</option><option value="de-DE">Deutsch (Deutschland)</option><option value="es-ES">Español (España)</option><option value="pt-BR">Português (Brasil)</option>`;

export const PRODUCT_META = Object.freeze({
  nativeScroll: { name: 'Native Scroll', path: 'native-scroll.html' },
  noAutoplay: { name: 'No Autoplay', path: 'no-autoplay.html' },
  anyCopy: { name: 'Any Copy', path: 'any-copy.html' },
  imageDownload: { name: 'Image Download', path: 'image-download.html' },
  videoDownload: { name: 'Video Download', path: 'video-download.html' },
  pageDisplay: { name: 'Page Display', path: 'page-display.html' },
  satellites: { name: 'Satellites', path: 'satellites.html' },
  allSettings: { name: 'All Settings', path: 'all-settings.html' }
});

export function featureFromPath(pathname) {
  if (pathname.endsWith('/no-autoplay.html')) return 'noAutoplay';
  if (pathname.endsWith('/any-copy.html')) return 'anyCopy';
  if (pathname.endsWith('/image-download.html')) return 'imageDownload';
  if (pathname.endsWith('/video-download.html')) return 'videoDownload';
  if (pathname.endsWith('/page-display.html')) return 'pageDisplay';
  if (pathname.endsWith('/satellites.html')) return 'satellites';
  if (pathname.endsWith('/all-settings.html')) return 'allSettings';
  return 'nativeScroll';
}

export function viewFor(featureId) {
  if (featureId === 'allSettings') return {
    primary: `
      <section class="card">
        ${introTitle('allSettings', 'allSettingsName')}
        <p class="last" data-i18n="allSettingsIntro"></p>
      </section>
      <section class="settings-grid" aria-label="Cosmic Gemini">
        ${settingsCard('nativeScroll', 'nativeScrollName', 'allSettingsNativeDescription')}
        ${settingsCard('noAutoplay', 'noAutoplayName', 'allSettingsAutoplayDescription')}
        ${settingsCard('anyCopy', 'anyCopyName', 'allSettingsAnyCopyDescription')}
        ${settingsCard('imageDownload', 'imageDownloadName', 'allSettingsImageDescription')}
        ${settingsCard('videoDownload', 'videoDownloadName', 'allSettingsVideoDescription')}
        ${settingsCard('pageDisplay', 'pageDisplayName', 'allSettingsPageDisplayDescription')}
        ${settingsCard('satellites', 'satellitesName', 'allSettingsSatellitesDescription')}
      </section>`,
    help: '<h2 data-i18n="allSettingsHelpHeading"></h2><p data-i18n="allSettingsHelp"></p>'
  };
  if (featureId === 'satellites') return {
    primary: `
      <section class="card">
        ${introTitle('satellites', 'satellitesName')}
        <p class="last" data-i18n="satellitesOverviewHelp"></p>
      </section>
      <h2 class="satellite-category-heading" data-i18n="satellitesGeneralFeatures"></h2>
      <section class="card satellite-card">
        <div class="section-heading">
          <div><div class="satellite-title"><span class="satellite-feature-icon" data-section-icon="mailtoCapture" aria-hidden="true"></span><h1 data-i18n="mailtoCaptureName"></h1></div><p data-i18n="mailtoCaptureDescription"></p></div>
          <div class="satellite-control"><label class="switch"><input id="mailtoCaptureEnabled" type="checkbox"><span></span><b class="sr-only">Mailto Capture</b></label></div>
        </div>
        <div class="satellite-privacy"><strong data-i18n="biliDailyLoginPrivacyHeading"></strong><p data-i18n="mailtoCapturePrivacy"></p></div>
      </section>
      <section class="card satellite-card">
        <div class="section-heading">
          <div><div class="satellite-title"><span class="satellite-feature-icon" data-section-icon="clipboardProtect" aria-hidden="true"></span><h1 data-i18n="clipboardProtectName"></h1></div><p data-i18n="clipboardProtectDescription"></p></div>
          <div class="satellite-control"><label class="switch"><input id="clipboardProtectEnabled" type="checkbox"><span></span><b class="sr-only">Clipboard Protect</b></label></div>
        </div>
        <div class="satellite-privacy"><strong data-i18n="biliDailyLoginPrivacyHeading"></strong><p data-i18n="clipboardProtectPrivacy"></p></div>
      </section>
      <section class="card satellite-card access-control-card" data-feature-id="accessControl" data-list-section="blockedDomains" data-empty-key="accessControlEmptyDomains">
        <div class="section-heading">
          <div><div class="satellite-title"><span class="satellite-feature-icon" data-section-icon="accessControl" aria-hidden="true"></span><h1 data-i18n="accessControlName"></h1></div><p data-i18n="accessControlDescription"></p></div>
          <div class="satellite-control"><label class="switch"><input id="accessControlEnabled" type="checkbox"><span></span><b class="sr-only">Access Control</b></label></div>
        </div>
        <fieldset id="accessControlOptions" class="access-control-options" disabled>
          <legend class="sr-only" data-i18n="accessControlBlockedDomainsHeading"></legend>
          <form class="rule-form" novalidate>
            <input type="text" autocapitalize="none" autocomplete="off" spellcheck="false" data-i18n-placeholder="accessControlDomainPlaceholder">
            <button class="primary-button" type="submit" data-i18n="add"></button>
          </form>
          <p class="form-message" aria-live="polite"></p>
          <p class="rule-list-heading" hidden></p>
          <ul class="rule-list"></ul>
          <label class="satellite-inline-checkbox access-control-temporary-visit" for="accessControlTemporaryVisits"><input id="accessControlTemporaryVisits" type="checkbox"><span data-i18n="accessControlTemporaryVisits"></span></label>
        </fieldset>
        <div class="satellite-privacy"><strong data-i18n="biliDailyLoginPrivacyHeading"></strong><p data-i18n="accessControlPrivacy"></p></div>
      </section>
      <section class="card satellite-card knowledge-card">
        <div class="section-heading">
          <div><div class="satellite-title"><span class="satellite-feature-icon" data-section-icon="websiteKnowledgeControl" aria-hidden="true"></span><h1 data-i18n="websiteKnowledgeName"></h1></div><p data-i18n="websiteKnowledgeDescription"></p></div>
          <div class="satellite-control"><label class="switch"><input id="websiteKnowledgeEnabled" type="checkbox"><span></span><b class="sr-only">Website Knowledge Control</b></label></div>
        </div>
        <fieldset id="websiteKnowledgeOptions" class="knowledge-options" disabled>
          <legend class="sr-only" data-i18n="websiteKnowledgeOptions"></legend>
          <div class="knowledge-row">
            <label for="websiteKnowledgeLanguages"><input id="websiteKnowledgeLanguages" type="checkbox"><span><strong id="websiteKnowledgeLanguagesLabel" data-i18n="websiteKnowledgeLanguages"></strong><small data-i18n="websiteKnowledgeLanguagesHelp"></small></span></label>
            <select id="websiteKnowledgeLanguagesValue" aria-labelledby="websiteKnowledgeLanguagesLabel">${knowledgeLocaleOptions}</select>
          </div>
          <div class="knowledge-row">
            <label for="websiteKnowledgeTimeZone"><input id="websiteKnowledgeTimeZone" type="checkbox"><span><strong id="websiteKnowledgeTimeZoneLabel" data-i18n="websiteKnowledgeTimeZone"></strong><small data-i18n="websiteKnowledgeTimeZoneHelp"></small></span></label>
            <select id="websiteKnowledgeTimeZoneValue" aria-labelledby="websiteKnowledgeTimeZoneLabel" disabled><option value="America/New_York">America/New_York</option><option value="UTC">UTC</option></select>
          </div>
          <div class="knowledge-row knowledge-checkbox-row">
            <label for="websiteKnowledgeGlobalPrivacyControl"><input id="websiteKnowledgeGlobalPrivacyControl" type="checkbox"><span><strong data-i18n="websiteKnowledgeGlobalPrivacyControl"></strong><small data-i18n="websiteKnowledgeGlobalPrivacyControlHelp"></small></span></label>
          </div>
        </fieldset>
        <div class="satellite-privacy"><strong data-i18n="biliDailyLoginPrivacyHeading"></strong><p data-i18n="websiteKnowledgePrivacy"></p></div>
      </section>
      <section class="card satellite-card">
        <div class="section-heading">
          <div><div class="satellite-title"><span class="satellite-feature-icon" data-section-icon="documentPreview" aria-hidden="true"></span><h1 data-i18n="documentPreviewName"></h1></div><p data-i18n="documentPreviewDescription"></p></div>
          <div class="satellite-control"><label class="switch"><input id="documentPreviewEnabled" type="checkbox"><span></span><b class="sr-only">Document Preview</b></label></div>
        </div>
        <details class="document-formats">
          <summary data-i18n="documentSupportedFormats"></summary>
          <dl>
            <dt data-i18n="documentFormatsDocuments"></dt><dd>.doc/.docx/.docm/.dotx/.dotm/.rtf/.odt</dd>
            <dt data-i18n="documentFormatsSpreadsheets"></dt><dd>.xls/.xlsx/.xlsm/.xltx/.xltm/.ods</dd>
            <dt data-i18n="documentFormatsSlides"></dt><dd>.ppt/.pptx/.pptm/.potx/.potm/.ppsx/.ppsm/.odp</dd>
            <dt>PDF</dt><dd>.pdf</dd>
            <dt data-i18n="documentFormatsOther"></dt><dd>.eml</dd>
          </dl>
          <p data-i18n="documentFormatsSafety"></p>
        </details>
        <fieldset id="documentPreviewOptions" class="knowledge-options document-preview-options" disabled>
          <legend class="sr-only" data-i18n="documentAppearance"></legend>
          <div class="knowledge-row">
            <div class="knowledge-label"><strong id="documentPreviewAppearanceLabel" data-i18n="documentAppearance"></strong><small id="documentPreviewAppearanceHelp" data-i18n="documentAppearanceHelp"></small></div>
            <select id="documentPreviewAppearance" aria-labelledby="documentPreviewAppearanceLabel" aria-describedby="documentPreviewAppearanceHelp">
              <option value="auto" data-i18n="documentAppearanceAuto"></option>
              <option value="light" data-i18n="documentAppearanceLight"></option>
              <option value="dark" data-i18n="documentAppearanceDark"></option>
            </select>
          </div>
          <div class="knowledge-row">
            <div class="knowledge-label"><strong id="documentPdfSamplingLabel" data-i18n="documentPdfSampling"></strong><small id="documentPdfSamplingHelp" data-i18n="documentPdfSamplingHelp"></small></div>
            <select id="documentPdfSampling" aria-labelledby="documentPdfSamplingLabel" aria-describedby="documentPdfSamplingHelp">
              <option value="1">1×</option>
              <option value="2">2×</option>
              <option value="3">3×</option>
              <option value="4" selected>4×</option>
              <option value="5">5×</option>
              <option value="6">6×</option>
            </select>
          </div>
          <div class="knowledge-row knowledge-checkbox-row">
            <label for="documentPdfSharpening"><input id="documentPdfSharpening" type="checkbox" aria-describedby="documentPdfSharpeningHelp"><span><strong data-i18n="documentPdfSharpening"></strong><small id="documentPdfSharpeningHelp" data-i18n="documentPdfSharpeningHelp"></small></span></label>
          </div>
          <div class="document-whitelist" data-feature-id="documentPreview" data-list-section="whitelistDomains" data-domain-scope="subdomains" data-empty-key="documentWhitelistEmpty">
            <strong id="documentWhitelistHeading" data-i18n="documentWhitelistHeading"></strong>
            <p data-i18n="documentWhitelistDescription"></p>
            <form class="rule-form">
              <input type="text" autocapitalize="none" autocomplete="off" spellcheck="false" aria-labelledby="documentWhitelistHeading" data-i18n-placeholder="accessControlDomainPlaceholder">
              <button type="submit" class="primary-button" data-i18n="add"></button>
            </form>
            <p class="form-message" role="status"></p>
            <p class="rule-list-heading" hidden></p>
            <ul class="rule-list"></ul>
          </div>
        </fieldset>
        <div class="satellite-privacy"><strong data-i18n="biliDailyLoginPrivacyHeading"></strong><p data-i18n="documentPreviewPrivacy"></p></div>
      </section>
      <section class="card satellite-card">
        <div class="section-heading">
          <div><div class="satellite-title"><span class="satellite-feature-icon" data-section-icon="adMarshal" aria-hidden="true"></span><h1 data-i18n="adMarshalName"></h1></div><p data-i18n="adMarshalDescription"></p></div>
        </div>
        <fieldset class="ad-marshal-sites">
          <legend data-i18n="adMarshalManagedSitesHeading"></legend>
          <div class="ad-marshal-site-grid">
            <label><input id="adMarshalTencentNews" data-ad-marshal-site="tencentNews" type="checkbox"><span data-i18n="adMarshalTencentNews"></span></label>
            <label><input id="adMarshalZhihu" data-ad-marshal-site="zhihu" type="checkbox"><span data-i18n="adMarshalZhihu"></span></label>
          </div>
        </fieldset>
        <div class="satellite-privacy"><strong data-i18n="biliDailyLoginPrivacyHeading"></strong><p data-i18n="adMarshalPrivacy"></p></div>
      </section>
      <section class="card satellite-card website-fixer-card">
        <div class="section-heading">
          <div><div class="satellite-title"><span class="satellite-feature-icon" data-section-icon="websiteFixer" aria-hidden="true"></span><h1 data-i18n="websiteFixerName"></h1></div><p data-i18n="websiteFixerDescription"></p></div>
          <div class="satellite-control"><label class="switch"><input id="websiteFixerEnabled" type="checkbox"><span></span><b class="sr-only">Website Fixer</b></label></div>
        </div>
        <fieldset id="websiteFixerOptions" class="knowledge-options" disabled>
          <label class="satellite-inline-checkbox" for="websiteFixerTranslateOverrideEnabled"><input id="websiteFixerTranslateOverrideEnabled" type="checkbox"><span data-i18n="websiteFixerTranslateName"></span></label>
          <fieldset id="websiteFixerTranslateOptions" class="website-fixer-translate-options" disabled>
            <legend class="sr-only" data-i18n="websiteFixerTranslateName"></legend>
            <p data-i18n="websiteFixerTranslateHelp"></p>
            <section class="rule-panel" data-feature-id="websiteFixer" data-setting-group="translateOverride" data-list-section="whitelistDomains" data-domain-scope="subdomains" data-empty-key="websiteFixerWhitelistEmpty">
              <h3 data-i18n="websiteFixerWhitelistHeading"></h3>
              <form class="rule-form" novalidate><input type="text" autocapitalize="none" autocomplete="off" spellcheck="false" data-i18n-placeholder="accessControlDomainPlaceholder"><button class="primary-button" type="submit" data-i18n="add"></button></form>
              <p class="form-message" aria-live="polite"></p><p class="rule-list-heading" hidden></p><ul class="rule-list"></ul>
            </section>
          </fieldset>
        </fieldset>
        <div class="satellite-privacy"><strong data-i18n="biliDailyLoginPrivacyHeading"></strong><p data-i18n="websiteFixerPrivacy"></p></div>
      </section>
      <h2 class="satellite-category-heading" data-i18n="satellitesSiteSpecificFeatures"></h2>
      <section class="card satellite-card xhs-dark-reader-card">
        <div class="section-heading">
          <div><div class="satellite-title"><span class="satellite-feature-icon" data-section-icon="xhsImageDarkMode" aria-hidden="true"></span><h1 data-i18n="xhsImageDarkModeSettingsName"></h1></div><p class="satellite-description-paragraph" data-i18n="xhsImageDarkModeDescription"></p><p class="satellite-experimental-note" data-i18n="experimentalFeature"></p></div>
          <div class="satellite-control"><label class="switch"><input id="xhsImageDarkModeEnabled" type="checkbox"><span></span><b class="sr-only">XHS Image Dark Mode</b></label></div>
        </div>
        <div class="preference-list satellite-preferences">
          <label class="preference-row" for="xhsImageDarkModeOverride"><span><strong data-i18n="xhsImageDarkModeOverrideHeading"></strong><small data-i18n="xhsImageDarkModeOverrideHelp"></small></span><span class="switch"><input id="xhsImageDarkModeOverride" type="checkbox"><span></span></span></label>
          <label class="preference-row" for="xhsImageDarkModeControl"><span><strong data-i18n="xhsImageDarkModeControlHeading"></strong><small data-i18n="xhsImageDarkModeControlHelp"></small></span><span class="switch"><input id="xhsImageDarkModeControl" type="checkbox" checked><span></span></span></label>
          <label class="preference-row xhs-opacity-row" for="xhsImageDarkModeOpacity"><span><strong data-i18n="xhsImageDarkModeOpacityHeading"></strong><small data-i18n="xhsImageDarkModeOpacityHelp"></small></span><span class="range-control"><input id="xhsImageDarkModeOpacity" type="range" min="20" max="90" step="5" value="50"><output id="xhsImageDarkModeOpacityValue" for="xhsImageDarkModeOpacity">50%</output></span></label>
        </div>
        <div class="satellite-privacy"><strong data-i18n="biliDailyLoginPrivacyHeading"></strong><p data-i18n="xhsImageDarkModePrivacy"></p></div>
      </section>
      <section class="card satellite-card">
        <div class="section-heading">
          <div><div class="satellite-title"><span class="satellite-feature-icon" data-section-icon="biliDailyLogin" aria-hidden="true"></span><h1 data-i18n="biliDailyLoginName"></h1></div><p data-i18n="biliDailyLoginDescription"></p></div>
          <div class="satellite-control"><label class="switch"><input id="biliDailyLogin" type="checkbox"><span></span><b class="sr-only">Bili Daily Login</b></label><span class="incognito-status" data-i18n="disabledInIncognito" hidden></span></div>
        </div>
        <div class="satellite-privacy"><strong data-i18n="biliDailyLoginPrivacyHeading"></strong><p data-i18n="biliDailyLoginPrivacy"></p></div>
      </section>
      <section class="card satellite-card">
        <div class="section-heading">
          <div>
            <h1 data-i18n="chineseResponseClaudeName"></h1>
            <p data-i18n="chineseResponseClaudeDescription"></p>
            <label class="satellite-inline-checkbox" for="claudeBrowserIdentityEnabled"><input id="claudeBrowserIdentityEnabled" type="checkbox"><span data-i18n="claudeBrowserIdentityHelp"></span></label>
          </div>
          <div class="satellite-control"><label class="switch"><input id="chineseResponseClaudeEnabled" type="checkbox"><span></span><b class="sr-only">Chinese Response Display Optimization for Claude</b></label></div>
        </div>
        <div class="satellite-privacy"><strong data-i18n="biliDailyLoginPrivacyHeading"></strong><p data-i18n="chineseResponseClaudePrivacy"></p></div>
      </section>
      <section class="card satellite-card" data-product="follow-list-instagram">
        <div class="section-heading"><div><h1 data-i18n="followListInstagramName"></h1><p data-i18n="followListInstagramDescription"></p><p data-i18n="followListInstagramHelp"></p></div><span class="context-label" data-i18n="clickToEnableLabel"></span></div>
        <div class="satellite-privacy"><strong data-i18n="biliDailyLoginPrivacyHeading"></strong><p data-i18n="followListInstagramPrivacy"></p></div>
      </section>
      <section class="card satellite-card" data-product="lang-google">
        <div class="section-heading">
          <div><h1 data-i18n="langGoogleName"></h1><p data-i18n="langGoogleDescription"></p></div>
          <div class="satellite-control"><label class="switch"><input id="langGoogleEnabled" type="checkbox"><span></span><b class="sr-only" data-i18n="langGoogleName"></b></label></div>
        </div>
        <div class="satellite-privacy"><strong data-i18n="biliDailyLoginPrivacyHeading"></strong><p data-i18n="langGooglePrivacy"></p></div>
      </section>`,
    help: '<h2 data-i18n="satellitesHelpHeading"></h2><p data-i18n="satellitesHelpIntro"></p>'
  };
  if (featureId === 'pageDisplay') return {
    primary: `
      <section class="card page-display-master-card">
        <div class="section-heading">
          <div>${introTitle('pageDisplay', 'pageDisplayName')}<p class="last" data-i18n="pageDisplayDescription"></p></div>
          <label class="switch"><input id="enabled" type="checkbox"><span></span><b class="sr-only">Page Display</b></label>
        </div>
      </section>
      <section class="card page-display-feature-card">
        <div class="section-heading page-display-feature-heading">
          <div><div class="rule-heading"><span data-section-icon="reduceWhitePoint" aria-hidden="true"></span><h2 data-i18n="reduceWhitePointName"></h2></div><p class="last" data-i18n="reduceWhitePointHelp"></p></div>
          <label class="switch"><input id="pageDisplayReduceWhitePointEnabled" type="checkbox"><span></span><b class="sr-only">Reduce White Point</b></label>
        </div>
        <div class="preference-list page-display-strength-list">
          <label class="preference-row" for="reduceWhitePointReduction"><span><strong data-i18n="reduceWhitePointReductionHeading"></strong><small data-i18n="reduceWhitePointReductionHelp"></small></span><span class="range-control"><input id="reduceWhitePointReduction" type="range" min="10" max="80" step="5" value="25"><output id="reduceWhitePointReductionValue" for="reduceWhitePointReduction">25%</output></span></label>
        </div>
      </section>
      <section class="card page-display-feature-card">
        <div class="section-heading page-display-feature-heading">
          <div><div class="rule-heading"><span data-section-icon="greyscale" aria-hidden="true"></span><h2 data-i18n="greyscaleName"></h2></div><p class="last" data-i18n="greyscaleHelp"></p></div>
          <label class="switch"><input id="pageDisplayGreyscaleEnabled" type="checkbox"><span></span><b class="sr-only">Greyscale</b></label>
        </div>
      </section>`,
    help: help(['pageDisplayHelpEffects', 'pageDisplayHelpRestore'], 'pageDisplayPrivacy')
  };
  if (featureId === 'nativeScroll') return {
    primary: `
      <section class="card default-card">
        <div class="section-heading">
          <div>${introTitle('nativeScroll', 'nativeScrollName')}<p class="intro-purpose" data-i18n="nativeIntroPurpose"></p><p class="intro-setting" hidden></p></div>
          <label class="switch"><input id="enabled" type="checkbox"><span></span><b class="sr-only">Native Scroll</b></label>
        </div>
      </section>
      ${websiteBehaviorCard('nativeWebsiteBehaviorHelp')}
      ${sharedWhitelistSection()}`,
    help: help(['nativeSetupStepDefault', 'nativeSetupStepExceptions', 'nativeSetupStepEnhanced'], 'nativePrivacy', true)
  };
  if (featureId === 'noAutoplay') return {
    primary: `
      <section class="card default-card">
        <div class="section-heading">
          <div>${introTitle('noAutoplay', 'noAutoplayName')}<p class="intro-purpose" data-i18n="autoplayIntroPurpose"></p><p class="intro-setting" hidden></p></div>
          <label class="switch"><input id="enabled" type="checkbox"><span></span><b class="sr-only">No Autoplay</b></label>
        </div>
      </section>
      ${websiteBehaviorCard('autoplayWebsiteBehaviorHelp')}
      ${sharedWhitelistSection()}
      ${audioAllowSection()}`,
    help: help(['autoplaySetupStepDefault', 'autoplaySetupStepExceptions', 'autoplaySetupStepEnhanced', 'autoplaySetupStepAudio'], 'autoplayPrivacy', true)
  };
  if (featureId === 'anyCopy') return {
    primary: `
      <section class="card">
        <div class="section-heading">
          <div>${introTitle('anyCopy', 'anyCopyName')}<p class="last" data-i18n="anyCopyIntroHelp"></p></div>
          <span class="context-label" data-i18n="clickToEnableLabel"></span>
        </div>
      </section>
      ${anyCopyRuleSection('anyCopy', 'anyCopySitesHeading', 'anyCopySitesHelp', 'emptyAnyCopySites')}
      <section class="card">
        <div class="section-heading any-copy-section-heading">
          <div class="rule-heading"><span data-section-icon="anyCopyEnhanced" aria-hidden="true"></span><h2 data-i18n="anyCopyEnhancedName"></h2></div>
          <span class="context-label" data-i18n="currentTabOnlyLabel"></span>
        </div>
        <p class="last" data-i18n="anyCopyEnhancedTabHelp"></p>
      </section>`,
    help: help(['anyCopyHelpStandard', 'anyCopyHelpEnhanced'], 'anyCopyPrivacy')
  };
  if (featureId === 'imageDownload') return {
    primary: `
      <section class="card">
        <div class="section-heading">
          <div>${introTitle('imageDownload', 'imageDownloadName')}<p data-i18n="imageDownloadActivationHelp"></p></div>
          <span class="context-label" data-i18n="clickToEnableLabel"></span>
        </div>
      </section>
      <section class="card">
        <h2 data-i18n="imageDownloadPreferencesHeading"></h2>
        <p data-i18n="imageDownloadPreferencesHelp"></p>
        <div class="preference-list">
          <label class="preference-row" for="imageWorkspaceMode"><span><strong data-i18n="imageWorkspaceModeHeading"></strong><small data-i18n="imageWorkspaceModeHelp"></small></span><select id="imageWorkspaceMode"><option value="sidePanel" data-i18n="imageWorkspaceSidePanel"></option><option value="page" data-i18n="imageWorkspacePage"></option></select></label>
          <label class="preference-row" for="imageOutputFormat"><span><strong data-i18n="imageOutputFormatHeading"></strong><small data-i18n="imageOutputFormatHelp"></small></span><select id="imageOutputFormat"><option value="original" data-i18n="keepOriginalFormat"></option><option value="jpg">JPEG</option><option value="png">PNG</option><option value="webp">WebP</option></select></label>
          <label class="preference-row" for="imageBatchMode"><span><strong data-i18n="imageBatchModeHeading"></strong><small data-i18n="imageBatchModeHelp"></small></span><select id="imageBatchMode"><option value="zip" data-i18n="downloadAsZip"></option><option value="separate" data-i18n="downloadSeparately"></option></select></label>
          <label class="preference-row" for="imageAskWhereToSave"><span><strong data-i18n="askWhereToSaveHeading"></strong><small data-i18n="askWhereToSaveHelp"></small></span><span class="switch"><input id="imageAskWhereToSave" type="checkbox" checked><span></span></span></label>
        </div>
      </section>`,
    help: help(['imageDownloadHelpDetection', 'imageDownloadHelpOriginals', 'imageDownloadHelpBatch'], 'imageDownloadPrivacy')
  };
  if (featureId === 'videoDownload') return {
    primary: `
      <section class="card">
        <div class="section-heading">
          <div>${introTitle('videoDownload', 'videoDownloadName')}<p data-i18n="videoDownloadActivationHelp"></p></div>
          <span class="context-label" data-i18n="clickToEnableLabel"></span>
        </div>
      </section>
      <section class="card">
        <h2 data-i18n="videoDownloadPreferencesHeading"></h2>
        <p data-i18n="videoDownloadPreferencesHelp"></p>
        <div class="preference-list">
          <label class="preference-row" for="preferredQuality"><span><strong data-i18n="preferredQualityHeading"></strong><small data-i18n="preferredQualityHelp"></small></span><select id="preferredQuality"><option value="best" data-i18n="qualityBest"></option><option value="2160">2160p</option><option value="1440">1440p</option><option value="1080">1080p</option><option value="720">720p</option><option value="480">480p</option></select></label>
          <label class="preference-row" for="askWhereToSave"><span><strong data-i18n="askWhereToSaveHeading"></strong><small data-i18n="askWhereToSaveHelp"></small></span><span class="switch"><input id="askWhereToSave" type="checkbox" checked><span></span></span></label>
        </div>
      </section>`,
    help: help(['videoDownloadHelpDetection', 'videoDownloadHelpFormats', 'videoDownloadHelpSession'], 'videoDownloadPrivacy')
  };
  return viewFor('nativeScroll');
}
