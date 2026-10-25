// UI descriptors only: products retain authorization, scope, storage, and runtime
// policy. A new tool supplies its own read(state) and request(state, tab) methods.
const websiteTool = (id, nameKey, glyph) => Object.freeze({
  id, nameKey, glyph,
  read(state) {
    const tools = state?.websiteFixer?.tools;
    const enabled = tools?.[id] === true;
    return { supported: tools?.supported === true, enabled, site: tools?.site || '',
      titleKey: enabled ? 'popupToolOnTitle' : 'popupToolOffTitle' };
  },
  request(state, tab) {
    const value = this.read(state);
    return { type: 'UI_SET_WEBSITE_FIXER_TOOL', featureId: 'websiteFixer', kind: id,
      tabId: tab?.id, expectedSite: value.site, enabled: !value.enabled };
  }
});

export const POPUP_TOOLS = Object.freeze([
  websiteTool('translateOverride', 'websiteFixerTranslateName', 'translateOverride'),
  websiteTool('stayOnPage', 'websiteFixerStayName', 'stayOnPage')
]);
