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

const languageSection = helpKey => `
  <section class="card compact">
    <label for="language"><strong data-i18n="languageHeading"></strong><small data-i18n="${helpKey}"></small></label>
    <select id="language"><option value="en-US" data-i18n="english"></option><option value="zh-CN" data-i18n="chinese"></option></select>
  </section>`;

const help = keys => `
  <h2 data-i18n="helpHeading"></h2>
  ${keys.map(key => `<p data-i18n="${key}"></p>`).join('')}
  <hr><h2 data-i18n="privacyHeading"></h2><p data-i18n="privacyText"></p>`;

export const PRODUCT_META = Object.freeze({
  nativeScroll: { name: 'Native Scroll', path: 'native-scroll.html' },
  noAutoplay: { name: 'No Autoplay', path: 'no-autoplay.html' },
  anyCopy: { name: 'Any Copy', path: 'any-copy.html' }
});

export function featureFromPath(pathname) {
  if (pathname.endsWith('/no-autoplay.html')) return 'noAutoplay';
  if (pathname.endsWith('/any-copy.html')) return 'anyCopy';
  return 'nativeScroll';
}

export function viewFor(featureId) {
  if (featureId === 'nativeScroll') return {
    primary: `
      <section class="card">
        <div class="section-heading">
          <div><h1 data-i18n="protectionHeading"></h1><p data-i18n="nativeProtectionHelp"></p></div>
          <label class="switch"><input id="enabled" type="checkbox"><span></span><b class="sr-only">Native Scroll</b></label>
        </div>
      </section>
      ${ruleSection('enhancedRules', 'enhancedSitesHeading', 'nativeEnhancedSitesHelp')}
      ${ruleSection('whitelistRules', 'whitelistHeading', 'nativeWhitelistHelp')}
      ${languageSection('nativeLanguageHelp')}`,
    help: help(['nativeHelpStandard', 'nativeHelpEnhanced', 'nativeHelpIndicator'])
  };
  if (featureId === 'noAutoplay') return {
    primary: `
      <section class="card">
        <div class="section-heading">
          <div><h1 data-i18n="protectionHeading"></h1><p data-i18n="autoplayProtectionHelp"></p></div>
          <label class="switch"><input id="enabled" type="checkbox"><span></span><b class="sr-only">No Autoplay</b></label>
        </div>
      </section>
      ${ruleSection('enhancedRules', 'enhancedSitesHeading', 'autoplayEnhancedSitesHelp')}
      ${ruleSection('whitelistRules', 'whitelistHeading', 'autoplayWhitelistHelp')}
      ${ruleSection('permanentAudioAllowRules', 'audioAllowHeading', 'audioAllowHelp')}
      ${languageSection('autoplayLanguageHelp')}`,
    help: help(['autoplayHelpStandard', 'autoplayHelpEnhanced', 'autoplayHelpSound'])
  };
  return {
    primary: `
      <section class="card">
        <h1 data-i18n="anyCopyActivationHeading"></h1>
        <p class="last" data-i18n="anyCopyActivationHelp"></p>
      </section>
      ${ruleSection('enforcedRules', 'enforcedSitesHeading', 'enforcedSitesHelp')}
      ${ruleSection('enhancedRules', 'enhancedSitesHeading', 'anyCopyEnhancedSitesHelp')}
      ${languageSection('anyCopyLanguageHelp')}`,
    help: help(['anyCopyHelpStandard', 'anyCopyHelpEnhanced'])
  };
}
