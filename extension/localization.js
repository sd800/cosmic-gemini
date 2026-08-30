const CATALOG = {
  'en-US': {
    appName: 'Native Scroll',
    enabledTitle: 'On · Click to turn off',
    disabledTitle: 'Off · Click to turn on',
    standardTitle: 'Standard mode · Click for Strong mode',
    strongTitle: 'Strong mode · Click for Standard mode',
    addWhitelistTitle: 'Add this site to the whitelist',
    removeWhitelistTitle: 'Remove this site from the whitelist',
    coveredWhitelistTitle: 'Covered by {rule} · Manage in Settings',
    unsupportedTitle: 'This page cannot be added to the whitelist',
    settingsTitle: 'Settings',
    protectingTitle: 'Protecting this page',
    settingsHeading: 'Settings',
    languageHeading: 'Language',
    languageHelp: 'Choose the language used by Native Scroll.',
    english: 'English',
    chinese: '简体中文',
    protectionHeading: 'Protection',
    globalProtection: 'Native Scroll',
    globalProtectionHelp: 'Apply your selected protection mode across websites.',
    standardMode: 'Standard',
    standardModeHelp: 'Keeps page-level scrolling native while preserving interactive controls and ordinary scrollable areas.',
    strongMode: 'Strong',
    strongModeHelp: 'Also handles nested scripted scrolling and transform-based page movement. Use it when Standard mode is not enough.',
    whitelistHeading: 'Whitelist',
    whitelistHelp: 'Native Scroll stays inactive on matching websites.',
    whitelistPlaceholder: 'example.com or *.example.com',
    add: 'Add',
    removeRule: 'Remove {rule}',
    emptyWhitelist: 'No websites have been added.',
    exactRuleHelp: 'example.com matches that hostname only. *.example.com also matches the root domain and all of its subdomains.',
    invalidRule: 'Enter a valid hostname or a wildcard such as *.example.com.',
    duplicateRule: 'That rule is already in the whitelist.',
    helpHeading: 'How it works',
    helpStandard: 'Standard mode intercepts website code that takes over wheel and trackpad gestures, leaving the browser’s native scrolling in control.',
    helpStrong: 'Strong mode applies broader protection for pages that simulate movement or repeatedly restore custom scrolling.',
    helpIndicator: 'A blue dot on the toolbar icon appears after Native Scroll suppresses scrolling code on the current page.',
    privacyHeading: 'Privacy',
    privacyText: 'Native Scroll runs locally, stores only your settings, and makes no network requests.',
    version: 'Version {version}',
    saved: 'Saved.',
    unavailable: 'Unable to update Native Scroll.',
    on: 'On',
    off: 'Off'
  },
  'zh-CN': {
    appName: 'Native Scroll',
    enabledTitle: '已开启 · 点击关闭',
    disabledTitle: '已关闭 · 点击开启',
    standardTitle: '标准模式 · 点击切换至强力模式',
    strongTitle: '强力模式 · 点击切换至标准模式',
    addWhitelistTitle: '将此网站加入白名单',
    removeWhitelistTitle: '将此网站移出白名单',
    coveredWhitelistTitle: '已由 {rule} 加入白名单 · 前往设置管理',
    unsupportedTitle: '此页面无法加入白名单',
    settingsTitle: '设置',
    protectingTitle: '正在保护此页面',
    settingsHeading: '设置',
    languageHeading: '语言',
    languageHelp: '选择 Native Scroll 的界面语言。',
    english: 'English',
    chinese: '简体中文',
    protectionHeading: '滚动保护',
    globalProtection: 'Native Scroll',
    globalProtectionHelp: '在所有网站上使用您选择的保护模式。',
    standardMode: '标准模式',
    standardModeHelp: '阻止网页接管整页滚动，同时保留交互控件和普通可滚动区域的正常操作。',
    strongMode: '强力模式',
    strongModeHelp: '进一步处理网页脚本控制的嵌套滚动和模拟页面移动；标准模式无效时可尝试启用。',
    whitelistHeading: '白名单',
    whitelistHelp: 'Native Scroll 不会在符合规则的网站上运行。',
    whitelistPlaceholder: 'example.com 或 *.example.com',
    add: '添加',
    removeRule: '移除 {rule}',
    emptyWhitelist: '尚未添加任何网站。',
    exactRuleHelp: 'example.com 仅匹配该主机名；*.example.com 同时匹配根域名及其所有子域名。',
    invalidRule: '请输入有效的主机名，或使用 *.example.com 这样的通配规则。',
    duplicateRule: '该规则已在白名单中。',
    helpHeading: '工作方式',
    helpStandard: '标准模式会拦截网页对滚轮和触控板手势的接管，让 Chrome 继续使用原生滚动。',
    helpStrong: '强力模式会进一步处理模拟页面移动或反复恢复自定义滚动的网页。',
    helpIndicator: 'Native Scroll 在当前页面拦截滚动代码后，工具栏图标上会显示蓝色圆点。',
    privacyHeading: '隐私',
    privacyText: 'Native Scroll 完全在本地运行，仅保存您的设置，不会发送网络请求。',
    version: '版本 {version}',
    saved: '已保存。',
    unavailable: 'Native Scroll 暂时无法更新设置。',
    on: '开启',
    off: '关闭'
  }
};

export function translator(locale) {
  const language = locale === 'zh-CN' ? 'zh-CN' : 'en-US';
  return (key, values = {}) => {
    let value = CATALOG[language][key] ?? CATALOG['en-US'][key] ?? key;
    for (const [name, replacement] of Object.entries(values)) value = value.replaceAll(`{${name}}`, String(replacement));
    return value;
  };
}

export function localizeDocument(t) {
  for (const element of document.querySelectorAll('[data-i18n]')) element.textContent = t(element.dataset.i18n);
  for (const element of document.querySelectorAll('[data-i18n-placeholder]')) element.placeholder = t(element.dataset.i18nPlaceholder);
}
