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
  <section class="card grouped-rule-card audio-rule-card">
    <h2 data-i18n="audioAllowHeading"></h2>
    <p data-i18n="audioAllowHelp"></p>
    <label class="preference-row" for="audioAutoplayAllSites">
      <span><strong data-i18n="audioAllowAllSitesHeading"></strong><small data-i18n="audioAllowAllSitesHelp"></small></span>
      <span class="switch"><input id="audioAutoplayAllSites" type="checkbox"><span></span></span>
    </label>
    ${rulePanel('permanentAudioAllowRules', 'audioAllowedSitesHeading', 'audioAllowedSitesHelp')}
    <p class="caption group-caption" data-i18n="exactRuleHelp"></p>
  </section>`;

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
    <p class="caption" data-i18n="exactRuleHelp"></p>
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

export const PRODUCT_META = Object.freeze({
  nativeScroll: { name: 'Native Scroll', path: 'native-scroll.html' },
  noAutoplay: { name: 'No Autoplay', path: 'no-autoplay.html' },
  anyCopy: { name: 'Any Copy', path: 'any-copy.html' },
  imageDownload: { name: 'Image Download', path: 'image-download.html' },
  videoDownload: { name: 'Video Download', path: 'video-download.html' },
  satellites: { name: 'Satellites', path: 'satellites.html' },
  allSettings: { name: 'All Settings', path: 'all-settings.html' }
});

export function featureFromPath(pathname) {
  if (pathname.endsWith('/no-autoplay.html')) return 'noAutoplay';
  if (pathname.endsWith('/any-copy.html')) return 'anyCopy';
  if (pathname.endsWith('/image-download.html')) return 'imageDownload';
  if (pathname.endsWith('/video-download.html')) return 'videoDownload';
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
      <section class="card satellite-card">
        <div class="section-heading">
          <div><h1 data-i18n="biliDailyLoginName"></h1><p data-i18n="biliDailyLoginDescription"></p></div>
          <div class="satellite-control"><label class="switch"><input id="biliDailyLogin" type="checkbox"><span></span><b class="sr-only">Bili Daily Login</b></label><span class="incognito-status" data-i18n="disabledInIncognito" hidden></span></div>
        </div>
        <div class="satellite-privacy"><strong data-i18n="biliDailyLoginPrivacyHeading"></strong><p data-i18n="biliDailyLoginPrivacy"></p></div>
      </section>
      <section class="card satellite-card">
        <div class="section-heading">
          <div><h1 data-i18n="adMarshalName"></h1><p data-i18n="adMarshalDescription"></p></div>
        </div>
        <div class="satellite-site-list">
          <h2 data-i18n="adMarshalSitesHeading"></h2>
          <label class="preference-row satellite-site-row" for="adMarshalNewsQqCom">
            <span><strong>news.qq.com</strong><small data-i18n="adMarshalNewsQqDescription"></small></span>
            <span class="switch"><input id="adMarshalNewsQqCom" type="checkbox"><span></span></span>
          </label>
          <label class="preference-row satellite-site-row" for="adMarshalDouyinCom">
            <span><strong>douyin.com</strong><small data-i18n="adMarshalDouyinDescription"></small></span>
            <span class="switch"><input id="adMarshalDouyinCom" type="checkbox"><span></span></span>
          </label>
        </div>
        <div class="satellite-privacy"><strong data-i18n="biliDailyLoginPrivacyHeading"></strong><p data-i18n="adMarshalPrivacy"></p></div>
      </section>`,
    help: '<h2 data-i18n="satellitesHelpHeading"></h2><p data-i18n="satellitesHelpIntro"></p>'
  };
  if (featureId === 'nativeScroll') return {
    primary: `
      <section class="card default-card">
        <div class="section-heading">
          <div>${introTitle('nativeScroll', 'nativeScrollName')}<p class="intro-purpose" data-i18n="nativeIntroPurpose"></p><p class="intro-setting" data-i18n="nativeProtectionHelp"></p></div>
          <label class="switch"><input id="enabled" type="checkbox" checked><span></span><b class="sr-only">Native Scroll</b></label>
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
          <div>${introTitle('noAutoplay', 'noAutoplayName')}<p class="intro-purpose" data-i18n="autoplayIntroPurpose"></p><p class="intro-setting" data-i18n="autoplayProtectionHelp"></p></div>
          <label class="switch"><input id="enabled" type="checkbox" checked><span></span><b class="sr-only">No Autoplay</b></label>
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
