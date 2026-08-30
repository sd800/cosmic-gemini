const ruleSection = (listName, headingKey, helpKey) => `
  <section class="card rule-card" data-list-section="${listName}">
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

const help = (keys, privacyKey) => `
  <h2 data-i18n="helpHeading"></h2>
  ${keys.map(key => `<p data-i18n="${key}"></p>`).join('')}
  <hr><h2 data-i18n="privacyHeading"></h2><p data-i18n="${privacyKey}"></p>`;

export const PRODUCT_META = Object.freeze({
  nativeScroll: { name: 'Native Scroll', path: 'native-scroll.html' },
  noAutoplay: { name: 'No Autoplay', path: 'no-autoplay.html' },
  anyCopy: { name: 'Any Copy', path: 'any-copy.html' },
  videoDownload: { name: 'Video Download', path: 'video-download.html' },
  satellites: { name: 'Satellites', path: 'satellites.html' }
});

export function featureFromPath(pathname) {
  if (pathname.endsWith('/no-autoplay.html')) return 'noAutoplay';
  if (pathname.endsWith('/any-copy.html')) return 'anyCopy';
  if (pathname.endsWith('/video-download.html')) return 'videoDownload';
  if (pathname.endsWith('/satellites.html')) return 'satellites';
  return 'nativeScroll';
}

export function viewFor(featureId) {
  if (featureId === 'satellites') return {
    primary: `
      <section class="card">
        <h1 data-i18n="satellitesName"></h1>
        <p class="last" data-i18n="satellitesOverviewHelp"></p>
      </section>
      <section class="card satellite-card">
        <div class="section-heading">
          <div><h1 data-i18n="biliDailyLoginName"></h1><p data-i18n="biliDailyLoginDescription"></p></div>
          <label class="switch"><input id="biliDailyLogin" type="checkbox"><span></span><b class="sr-only">Bili Daily Login</b></label>
        </div>
        <div class="satellite-privacy"><strong data-i18n="biliDailyLoginPrivacyHeading"></strong><p data-i18n="biliDailyLoginPrivacy"></p></div>
      </section>`,
    help: '<h2 data-i18n="satellitesHelpHeading"></h2><p data-i18n="satellitesHelpIntro"></p>'
  };
  if (featureId === 'nativeScroll') return {
    primary: `
      <section class="card">
        <div class="section-heading">
          <div><h1 data-i18n="nativeStandardHeading"></h1><p data-i18n="nativeProtectionHelp"></p></div>
          <label class="switch"><input id="enabled" type="checkbox" checked><span></span><b class="sr-only">Native Scroll</b></label>
        </div>
      </section>
      ${ruleSection('enhancedRules', 'enhancedSitesHeading', 'nativeEnhancedSitesHelp')}
      ${ruleSection('whitelistRules', 'whitelistHeading', 'nativeWhitelistHelp')}`,
    help: help(['nativeHelpStandard', 'nativeHelpEnhanced', 'nativeHelpIndicator'], 'nativePrivacy')
  };
  if (featureId === 'noAutoplay') return {
    primary: `
      <section class="card">
        <div class="section-heading">
          <div><h1 data-i18n="autoplayStandardHeading"></h1><p data-i18n="autoplayProtectionHelp"></p></div>
          <label class="switch"><input id="enabled" type="checkbox" checked><span></span><b class="sr-only">No Autoplay</b></label>
        </div>
      </section>
      ${ruleSection('enhancedRules', 'enhancedSitesHeading', 'autoplayEnhancedSitesHelp')}
      ${ruleSection('whitelistRules', 'whitelistHeading', 'autoplayWhitelistHelp')}
      ${ruleSection('permanentAudioAllowRules', 'audioAllowHeading', 'audioAllowHelp')}`,
    help: help(['autoplayHelpStandard', 'autoplayHelpEnhanced', 'autoplayHelpSound'], 'autoplayPrivacy')
  };
  if (featureId === 'videoDownload') return {
    primary: `
      <section class="card">
        <div class="section-heading">
          <div><h1 data-i18n="videoDownloadName"></h1><p data-i18n="videoDownloadActivationHelp"></p></div>
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
  return {
    primary: `
      <section class="card">
        <div class="section-heading">
          <div><h1 data-i18n="anyCopyStandardHeading"></h1><p data-i18n="anyCopyActivationHelp"></p></div>
          <span class="context-label" data-i18n="siteActivationLabel"></span>
        </div>
      </section>
      ${ruleSection('enforcedRules', 'enforcedSitesHeading', 'enforcedSitesHelp')}
      ${ruleSection('enhancedRules', 'enhancedSitesHeading', 'anyCopyEnhancedSitesHelp')}`,
    help: help(['anyCopyHelpStandard', 'anyCopyHelpEnhanced'], 'anyCopyPrivacy')
  };
}
