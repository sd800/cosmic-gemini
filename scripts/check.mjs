import assert from 'node:assert/strict';
import { readdir, readFile, stat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const extension = join(project, 'extension');
const ignoredPlatformEntries = new Set(['.DS_Store']);

const isIgnoredPlatformEntry = name => ignoredPlatformEntries.has(name) || name.startsWith('._');

async function filesBelow(directory) {
  const result = [];
  for (const name of await readdir(directory)) {
    if (isIgnoredPlatformEntry(name)) continue;
    const path = join(directory, name);
    if ((await stat(path)).isDirectory()) result.push(...await filesBelow(path));
    else result.push(path);
  }
  return result;
}

const files = await filesBelow(extension);
const source = async (...parts) => readFile(join(extension, ...parts), 'utf8');

for (const path of files.filter(path => /\.(?:js|mjs)$/.test(path))) {
  const check = spawnSync(process.execPath, ['--check', path], { encoding: 'utf8' });
  assert.equal(check.status, 0, path + '\n' + check.stderr);
}

const manifest = JSON.parse(await source('manifest.json'));
assert.equal(manifest.manifest_version, 3);
assert.equal(manifest.name, 'Cosmic Gemini');
assert.equal(manifest.version, '9.6.20');
assert.equal(manifest.version_name, undefined);
assert.equal(manifest.description, 'A personal toolkit for the web.');
assert.deepEqual(manifest.permissions.sort(), [
  'activeTab', 'alarms', 'declarativeNetRequestWithHostAccess', 'downloads', 'offscreen', 'scripting', 'sidePanel', 'storage', 'unlimitedStorage', 'webRequest'
]);
assert.deepEqual(manifest.host_permissions.sort(), ['http://*/*', 'https://*/*']);
assert.equal(manifest.background.service_worker, 'background/central.js');
assert.equal(manifest.action.default_popup, 'popup/index.html');
assert.equal(manifest.options_page, 'settings/all-settings.html');
assert.equal(manifest.content_scripts.length, 1);
assert.deepEqual(manifest.content_scripts[0].js, ['content/central-page.js']);
assert.equal(manifest.content_scripts[0].world, 'ISOLATED');
assert.equal(manifest.content_scripts[0].run_at, 'document_start');
assert.equal(manifest.content_scripts[0].all_frames, true);
assert.equal(manifest.incognito, 'split');
assert.deepEqual(manifest.web_accessible_resources, [{
  resources: [
    'assets/ad-marshal-empty.js',
    'assets/ad-marshal-empty.json',
    'assets/ad-marshal-empty.html',
    'assets/ad-marshal-transparent.svg',
    'assets/ad-marshal-qq-emonitor.js'
  ],
  matches: [
    'http://news.qq.com/*',
    'https://news.qq.com/*',
    'http://view.inews.qq.com/*',
    'https://view.inews.qq.com/*',
    'http://www.qq.com/*',
    'https://www.qq.com/*',
    'http://zhihu.com/*',
    'https://zhihu.com/*',
    'http://*.zhihu.com/*',
    'https://*.zhihu.com/*'
  ]
}]);

const extensionRootEntries = await readdir(extension, { withFileTypes: true });
assert.deepEqual(extensionRootEntries
  .filter(entry => entry.isFile() && !isIgnoredPlatformEntry(entry.name))
  .map(entry => entry.name)
  .sort(), ['manifest.json']);

for (const size of [16, 32, 48, 128]) {
  assert.equal(manifest.icons[String(size)], `icons/icon-${size}.png`);
  assert.equal(manifest.action.default_icon[String(size)], `icons/icon-${size}.png`);
  for (const name of [`icon-${size}.png`]) {
    const png = await readFile(join(extension, 'icons', name));
    assert.equal(png.toString('hex', 0, 8), '89504e470d0a1a0a', `${name} is not a PNG`);
    assert.equal(png.readUInt32BE(16), size, `${name} has the wrong width`);
    assert.equal(png.readUInt32BE(20), size, `${name} has the wrong height`);
  }
}

for (const htmlPath of files.filter(path => path.endsWith('.html'))) {
  const html = await readFile(htmlPath, 'utf8');
  assert.doesNotMatch(html, /<(?:script|link)[^>]+(?:src|href)=["']https?:/i, `${htmlPath} loads remote code`);
  for (const match of html.matchAll(/(?:src|href)=["']([^"']+)["']/g)) {
    if (/^(?:#|https?:|data:)/.test(match[1])) continue;
    await stat(resolve(dirname(htmlPath), match[1]));
  }
}

for (const jsPath of files.filter(path => path.endsWith('.js') && !path.includes(join(extension, 'vendor')))) {
  const js = await readFile(jsPath, 'utf8');
  for (const match of js.matchAll(/(?:from\s+|import\s*)["'](\.\.?\/[^"']+)["']/g)) {
    await stat(resolve(dirname(jsPath), match[1]));
  }
}

// Vendor PDF text-layer metrics reproduce authored glyphs, not our UI typography.
for (const cssPath of files.filter(path => path.endsWith('.css') && !path.includes(join(extension, 'vendor')))) {
  assert.doesNotMatch(await readFile(cssPath, 'utf8'), /letter-spacing\s*:\s*-/i, `${cssPath} uses negative letter spacing`);
}

const sourceEntries = await Promise.all(files.filter(path => /\.(?:js|html|css)$/.test(path))
  .map(async path => [path, await readFile(path, 'utf8')]));
const localizationContext = { globalThis: {} };
runInNewContext(await source('shared', 'localization-data.js'), localizationContext);
const localizationCatalog = localizationContext.globalThis.COSMIC_GEMINI_CATALOG;
assert.ok(localizationCatalog?.['en-US'] && localizationCatalog?.['zh-CN'], 'Both interface locales must be present.');
assert.deepEqual(Object.keys(localizationCatalog['en-US']).sort(), Object.keys(localizationCatalog['zh-CN']).sort(),
  'English and Chinese localization keys must stay synchronized.');
const localizedKeys = new Set();
for (const [path, value] of sourceEntries.filter(([path]) => !path.includes(join(extension, 'vendor')))) {
  if (!/\.(?:js|html)$/.test(path)) continue;
  for (const match of value.matchAll(/\b(?:t|translate)\(\s*['"]([A-Za-z0-9]+)['"]/g)) localizedKeys.add(match[1]);
  for (const match of value.matchAll(/data-i18n(?:-placeholder|-aria-label)?=['"]([A-Za-z0-9]+)['"]/g)) localizedKeys.add(match[1]);
}
for (const key of localizedKeys) {
  assert.ok(key in localizationCatalog['en-US'], `Missing English localization key: ${key}`);
  assert.ok(key in localizationCatalog['zh-CN'], `Missing Chinese localization key: ${key}`);
}
const firstPartyJoined = sourceEntries.filter(([path]) => !path.includes(join(extension, 'vendor')))
  .map(([, value]) => value).join('\n');
const networkFiles = sourceEntries.filter(([path, value]) => !path.includes(join(extension, 'vendor'))
  && /fetch\s*\(|XMLHttpRequest|WebSocket\s*\(/.test(value));
assert.deepEqual(networkFiles.map(([path]) => path).sort(), [
  join(extension, 'background/products/customs/video-download.js'),
  join(extension, 'background/products/operations/satellites.js'),
  join(extension, 'background/products/customs/document-preview.js'),
  join(extension, 'content/ad-marshal-runtime.js'),
  join(extension, 'content/video-download-page.js'),
  join(extension, 'core/site-video.js'),
  join(extension, 'core/twitter-video.js'),
  join(extension, 'offscreen/video-download.js'),
  join(extension, 'workspaces/document-preview/document-preview.js'),
  join(extension, 'workspaces/pdf-viewer/worker.js')
].sort());
assert.doesNotMatch(firstPartyJoined, /recent activity|最近活动/i);
assert.doesNotMatch(firstPartyJoined, /sound autoplay/i);
assert.doesNotMatch(firstPartyJoined, /navigator\.mediaSession|setActionHandler\s*\(|MediaPlayPause|nativeMessaging|osascript|AppleScript/i);

const settingsPages = ['native-scroll.html', 'no-autoplay.html', 'any-copy.html', 'image-download.html', 'video-download.html', 'page-display.html', 'satellites.html', 'all-settings.html'];
for (const name of settingsPages) {
  const html = await source('settings', name);
  assert.match(html, /<script src="\.\.\/shared\/localization-data\.js"><\/script>/);
  assert.match(html, /<script src="preload\.js"><\/script>\s*<script type="module" src="page\.js"><\/script>/);
  assert.match(html, /data-feature-link="imageDownload"/);
  assert.match(html, /data-feature-link="pageDisplay"/);
  assert.match(html, /data-feature-link="satellites"/);
  assert.match(html, /data-feature-link="allSettings"/);
  assert.match(html, /data-feature-link="pageDisplay"[\s\S]*data-feature-link="satellites"[\s\S]*data-feature-link="allSettings"/);
}
for (const [name, featureId] of Object.entries({
  'native-scroll.html': 'nativeScroll',
  'no-autoplay.html': 'noAutoplay',
  'any-copy.html': 'anyCopy',
  'image-download.html': 'imageDownload',
  'video-download.html': 'videoDownload',
  'page-display.html': 'pageDisplay',
  'satellites.html': 'satellites',
  'all-settings.html': 'allSettings'
})) {
  assert.match(await source('settings', name), new RegExp('class="intro-title"[\\s\\S]*?data-section-icon="' + featureId + '"'));
}

const popupHtml = await source('popup', 'index.html');
const popupSource = await source('popup', 'popup.js');
const sharedUi = await source('shared', 'ui.js');
assert.match(popupHtml, /id="nativeScroll-status"[\s\S]*id="nativeScroll-enhanced"[\s\S]*id="noAutoplay-status"[\s\S]*id="noAutoplay-enhanced"[\s\S]*id="anyCopy-status"[\s\S]*id="anyCopyEnhanced-status"[\s\S]*id="imageDownload-status"[\s\S]*id="videoDownload-status"[\s\S]*id="reduceWhitePoint-status"[\s\S]*id="greyscale-status"[\s\S]*id="all-settings"/);
assert.equal([...popupHtml.matchAll(/class="feature-row/g)].length, 5);
assert.match(popupSource, /type: 'UI_GET_ACTIVE_PAGE_STATE'/);
assert.match(popupSource, /type: 'UI_TOGGLE_PAGE_FEATURE'/);
assert.match(popupSource, /type: 'UI_TOGGLE_PAGE_ENHANCED'/);
assert.match(popupSource, /type: 'UI_TOGGLE_SITE_FEATURE'/);
assert.match(popupSource, /type: 'UI_TOGGLE_TAB_FEATURE'/);
assert.match(popupSource, /type: 'UI_SET_PAGE_DISPLAY_SETTING'/);
assert.match(popupSource, /state\.preferences\?\.pageDisplay/);
assert.match(popupSource, /state\.pageDisplay\?\.supported === true[\s\S]*toggle\.disabled = !supported \|\| !saved/);
assert.match(popupSource, /type: 'UI_OPEN_ALL_SETTINGS'/);
assert.match(popupSource, /retryRead\(\(\) => reload/);
assert.doesNotMatch(popupSource, /if \(reloadAfter\) await reload\(/);
assert.doesNotMatch(popupSource, /chrome\.storage|chrome\.tabs\./);
assert.doesNotMatch(popupSource, /showView\(state\.videoDownload\?\.active/);
assert.match(popupSource, /scanState === 'paused' \? 'off' : 'active'/);
assert.match(popupSource, /dataset\.persistent = String\(scanState === 'active'\)/);

const settingsSource = await source('settings', 'page.js');
const settingsPreload = await source('settings', 'preload.js');
const settingsStyle = await source('settings', 'settings.css');
const popupStyle = await source('popup', 'popup.css');
assert.doesNotMatch(popupStyle, /access-control-visit/);
const imageDownloadStyle = await source('workspaces', 'image-download', 'image-download.css');
const satellitesSettings = await source('settings', 'satellites.html');
const pageDisplaySettings = await source('settings', 'page-display.html');
const readme = await readFile(join(project, 'README.md'), 'utf8');
const readmeZh = await readFile(join(project, 'README_zh.md'), 'utf8');
const trashIconPath = 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 10v7M14 10v7';
assert.ok(sharedUi.includes(trashIconPath) && settingsPreload.includes(trashIconPath),
  'Shared and first-frame Settings rendering must use the same trash icon.');
assert.match(settingsStyle, /--switch-blue: #0b57d0/);
assert.match(settingsStyle, /prefers-color-scheme: dark[\s\S]*--switch-blue: #276cd9/);
assert.match(settingsStyle, /\.switch input:checked \+ span \{ background: var\(--switch-blue\); \}/);
assert.match(settingsSource, /UI_SET_BEHAVIOR_RULE/);
assert.match(settingsSource, /UI_ADD_NSNA_WHITELIST_RULE/);
assert.match(settingsSource, /UI_SET_AUDIO_AUTOPLAY_ALL_SITES/);
assert.match(settingsSource, /UI_RESET_ALL_SETTINGS/);
assert.match(settingsSource, /retryRead\(\(\) => reload/);
assert.doesNotMatch(settingsSource, /chrome\.storage|chrome\.tabs\./);
assert.match(settingsPreload, /inIncognitoContext[\s\S]*disabledByDefaultInIncognito/);
assert.match(satellitesSettings, /class="incognito-status"[\s\S]*data-i18n="disabledInIncognito"/);
assert.match(satellitesSettings, /satellitesGeneralFeatures[\s\S]*id="mailtoCaptureEnabled"[\s\S]*id="clipboardProtectEnabled"[\s\S]*id="accessControlEnabled"[\s\S]*id="websiteKnowledgeEnabled"[\s\S]*adMarshalName[\s\S]*id="adMarshalTencentNews"[\s\S]*satellitesSiteSpecificFeatures[\s\S]*id="xhsImageDarkModeEnabled"[\s\S]*id="biliDailyLogin"[\s\S]*id="claudeBrowserIdentityEnabled"[\s\S]*id="chineseResponseClaudeEnabled"[\s\S]*data-product="follow-list-instagram"/);
assert.match(satellitesSettings, /data-feature-id="accessControl" data-list-section="blockedDomains"[\s\S]*id="accessControlEnabled"[\s\S]*id="accessControlOptions"/);
assert.match(satellitesSettings, /class="rule-list"[\s\S]*id="accessControlTemporaryVisits"/,
  'Access Control must place the one-time-visit choice below its website list.');
assert.match(settingsSource, /normalizeAccessControlRuleInput[\s\S]*featureId: 'accessControl'/);
assert.match(settingsSource, /UI_SET_ACCESS_CONTROL_TEMPORARY_VISITS/);
assert.match(settingsSource, /querySelectorAll\('input\[type="text"\]'\)[\s\S]*bindRuleInputHelp/);
assert.match(settingsSource, /normalizeWebsiteRuleInput\(input\.value\)/,
  'Settings website-rule forms must apply shared input completion.');
assert.match(settingsStyle, /\.access-control-rule-scope \{[^}]*color: var\(--muted\)[^}]*font-size: 12px/);
assert.match(readme, /### Satellites – General features[\s\S]*#### Access Control[\s\S]*### Satellites – Site-specific features/);
assert.match(readmeZh, /### Satellites - 通用功能[\s\S]*#### Access Control[\s\S]*### Satellites - 网站专用功能/);
assert.doesNotMatch(readme, /PSL PRIVATE DOMAINS-sector geographic eTLD rules/i,
  'README must not expose the internal geographic eTLD category.');
assert.doesNotMatch(readmeZh, /PSL PRIVATE DOMAINS-sector geographic eTLD rules/i,
  'Chinese README must not expose the internal geographic eTLD category.');
assert.match(settingsStyle, /\.satellite-category-heading \{[^}]*font-size: 16px[^}]*font-weight: 700[^}]*\}[\s\S]*\.satellite-category-heading::after/);
for (const iconName of ['mailtoCapture', 'clipboardProtect', 'accessControl', 'websiteKnowledgeControl', 'adMarshal', 'xhsImageDarkMode', 'biliDailyLogin']) {
  assert.match(satellitesSettings, new RegExp(`class="satellite-feature-icon" data-section-icon="${iconName}"`));
  assert.match(sharedUi, new RegExp(`\\b${iconName}:`));
  assert.match(settingsPreload, new RegExp(`\\b${iconName}:`));
}
assert.doesNotMatch(satellitesSettings, /satellite-feature-icon[^>]+data-section-icon="(?:chineseResponseClaude|followListInstagram)"/);
assert.match(satellitesSettings, /chineseResponseClaudeDescription[\s\S]*class="satellite-inline-checkbox"[\s\S]*id="claudeBrowserIdentityEnabled"[\s\S]*claudeBrowserIdentityHelp[\s\S]*chineseResponseClaudeEnabled/);
assert.doesNotMatch(satellitesSettings, /claudeBrowserIdentityHeading|class="switch"><input id="claudeBrowserIdentityEnabled"/);
assert.doesNotMatch(satellitesSettings, /id="pageDisplay(?:ReduceWhitePointEnabled|GreyscaleEnabled)"/);
assert.match(pageDisplaySettings, /id="enabled"[\s\S]*data-section-icon="reduceWhitePoint"[\s\S]*id="pageDisplayReduceWhitePointEnabled"[\s\S]*id="reduceWhitePointReduction"[\s\S]*data-section-icon="greyscale"[\s\S]*id="pageDisplayGreyscaleEnabled"/);
assert.match(pageDisplaySettings, /id="reduceWhitePointReduction"[^>]*min="10"[^>]*max="80"[^>]*step="5"[^>]*value="25"/);
assert.match(pageDisplaySettings, /page-display-feature-heading[\s\S]*reduceWhitePointName[\s\S]*reduceWhitePointHelp[\s\S]*id="pageDisplayReduceWhitePointEnabled"/);
assert.match(pageDisplaySettings, /page-display-feature-heading[\s\S]*greyscaleName[\s\S]*greyscaleHelp[\s\S]*id="pageDisplayGreyscaleEnabled"/);
assert.match(satellitesSettings, /id="adMarshalTencentNews"[\s\S]*id="adMarshalZhihu"/);
assert.doesNotMatch(satellitesSettings, /id="adMarshal(?:Douyin|Gmail)"/);
assert.match(satellitesSettings, /xhsImageDarkModeSettingsName[\s\S]*experimentalFeature/);
assert.match(satellitesSettings, /xhsImageDarkModeDescription[\s\S]*experimentalFeature/);
assert.doesNotMatch(satellitesSettings, /id="adMarshalEnabled"/);
assert.match(settingsSource, /UI_SET_AD_MARSHAL_SITE/);
assert.match(settingsSource, /featureId: 'mailtoCapture'/);
assert.match(settingsSource, /primaryZones[\s\S]*Pacific\/Honolulu[\s\S]*secondaryZones[\s\S]*America\/Toronto[\s\S]*America\/Vancouver[\s\S]*America\/Anchorage[\s\S]*'UTC'[\s\S]*tertiaryZones[\s\S]*Pacific\/Auckland[\s\S]*Asia\/Seoul[\s\S]*Asia\/Hong_Kong[\s\S]*Asia\/Singapore[\s\S]*Asia\/Bangkok[\s\S]*Europe\/Zurich[\s\S]*America\/Sao_Paulo/,
  'Website Knowledge Control must preserve the three requested pinned time-zone groups.');
assert.match(settingsSource, /\}\), \[knowledgeEnabled\]\)\);[\s\S]*value \? \[control, value\] : \[control\]/,
  'Website Knowledge Control saves must mark only the changed controls as pending.');
assert.match(satellitesSettings, /id="websiteKnowledgeLanguagesValue"[\s\S]*value="zh-CN">简体中文（中国）<\/option>[\s\S]*value="zh-Hans">简体中文（无地区）<\/option>[\s\S]*value="zh-Hant">繁體中文（無地區）<\/option>[\s\S]*value="zh-HK">繁體中文（中國香港）<\/option>[\s\S]*value="zh-MO">繁體中文（中國澳門）<\/option>[\s\S]*value="zh-TW">繁體中文（中華台北）<\/option>[\s\S]*value="zh-MY">简体中文（马来西亚）<\/option>[\s\S]*value="zh-SG">简体中文（新加坡）<\/option>/,
  'The combined language and regional-format menu must preserve the requested Chinese locale order.');
assert.doesNotMatch(satellitesSettings, /websiteKnowledgeLocale/,
  'Website Knowledge Control must not retain a separate Intl locale control.');
assert.match(satellitesSettings, /id="websiteKnowledgeGlobalPrivacyControl"[^>]*checked[\s\S]*websiteKnowledgeGlobalPrivacyControlHelp/,
  'Global Privacy Control must be an independently selected Website Knowledge Control option.');
assert.match(settingsSource, /pageDisplayReduceWhitePointEnabled[\s\S]*UI_SET_PAGE_DISPLAY_SETTING[\s\S]*pageDisplayGreyscaleEnabled/);
assert.match(settingsPreload, /pageDisplayReduceWhitePointEnabled[\s\S]*pageDisplayGreyscaleEnabled[\s\S]*reduceWhitePointReduction/);
assert.match(settingsSource, /pageDisplayEnabled[\s\S]*reduceWhitePointEnabled\.disabled = !pageDisplayEnabled[\s\S]*greyscaleEnabled\.disabled = !pageDisplayEnabled/);
assert.match(settingsStyle, /data-page-display-enabled="false"[\s\S]*\.page-display-feature-card/);
assert.match(settingsSource, /states\?\.preferences \|\| states/);
for (const name of ['native-scroll.html', 'no-autoplay.html']) {
  const html = await source('settings', name);
  assert.equal([...html.matchAll(/data-behavior-card/g)].length, 1);
  assert.equal([...html.matchAll(/data-behavior-list=/g)].length, 3);
  assert.match(html, /data-behavior-list="inactiveRules"[\s\S]*data-behavior-list="standardRules"[\s\S]*data-behavior-list="enhancedRules"/);
  assert.match(html, /data-feature-id="nsna" data-list-section="whitelistRules"/);
}

const central = await source('background', 'central.js');
const centralPolicy = await source('background', 'central-policy.js');
const config = await source('core', 'config.js');
const messageSource = await source('background', 'message-source.js');
const platform = await source('background', 'platform.js');
const provinceInterface = await source('background', 'provinces', 'interface.js');
const standing = await source('background', 'provinces', 'standing.js');
const operations = await source('background', 'provinces', 'operations.js');
const customs = await source('background', 'provinces', 'customs.js');
const customsObservation = await source('background', 'provinces', 'customs-observation.js');
const customsResponseIngress = await source('background', 'provinces', 'customs-response-ingress.js');
const offscreenCoordinator = await source('background', 'provinces', 'customs-offscreen.js');
const runtimeHost = await source('background', 'features', 'page-runtime-host.js');
const nativeScroll = await source('background', 'products', 'standing', 'native-scroll.js');
const nativeScrollRuntime = await source('content', 'runtime.js');
const noAutoplay = await source('background', 'products', 'standing', 'no-autoplay.js');
const noAutoplayRuntime = await source('content', 'no-autoplay-runtime.js');
const mailtoCapture = await source('background', 'products', 'standing', 'mailto-capture.js');
const mailtoCaptureRuntime = await source('content', 'mailto-capture-runtime.js');
const mailtoCaptureProtocols = await source('shared', 'external-links-capture', 'protocols.js');
const mailtoCaptureNanp = await source('content', 'mailto-capture-nanp.js');
const mailtoCapturePhone = await source('content', 'mailto-capture-phone.js');
const accessControl = await source('background', 'products', 'standing', 'access-control.js');
const adMarshal = await source('background', 'products', 'standing', 'ad-marshal.js');
const adMarshalRuntime = await source('content', 'ad-marshal-runtime.js');
const anyCopy = await source('background', 'products', 'operations', 'any-copy.js');
const anyCopyEnhanced = await source('background', 'products', 'operations', 'any-copy-enhanced.js');
const satellites = await source('background', 'products', 'operations', 'satellites.js');
const pageDisplay = await source('background', 'products', 'operations', 'page-display.js');
const pageDisplayBridge = await source('content', 'page-display-bridge.js');
const pageDisplayRuntime = await source('content', 'page-display-runtime.js');
const pageDisplayStyles = await source('content', 'page-display.css');
const xhsImageDarkMode = await source('background', 'products', 'operations', 'xhs-image-dark-mode.js');
const xhsImageDarkModeRuntime = await source('content', 'xhs-image-dark-mode-runtime.js');
const followListInstagram = await source('background', 'products', 'operations', 'follow-list-instagram.js');
const followListInstagramDom = await source('content', 'follow-list-instagram-dom.js');
const followListInstagramWorkspace = await source('workspaces', 'follow-list-instagram', 'follow-list-instagram.js');
const followListInstagramHtml = await source('workspaces', 'follow-list-instagram', 'follow-list-instagram.html');
const chineseResponseClaude = await source('background', 'products', 'operations', 'chinese-response-claude.js');
const chineseResponseClaudeBridge = await source('content', 'chinese-response-claude-bridge.js');
const chineseResponseClaudeRuntime = await source('content', 'chinese-response-claude-runtime.js');
const administration = await source('background', 'products', 'operations', 'administration.js');
const imageDownload = await source('background', 'products', 'customs', 'image-download.js');
const videoDownload = await source('background', 'products', 'customs', 'video-download.js');
const videoScanner = await source('content', 'video-download-scanner.js');
const imageWorkspace = await source('workspaces', 'image-download', 'image-download.js');

assert.match(followListInstagram, /UI_IG_OPEN_UNFOLLOW_CONFIRMATION/);
assert.match(followListInstagram, /UI_IG_CHECK_UNFOLLOW_CONFIRMATION/);
assert.doesNotMatch(followListInstagram, /UI_IG_UNFOLLOW/,
  'Instagram unfollowing must remain inside Instagram’s native confirmation.');
assert.match(followListInstagramDom, /return \{ confirmationOpened: true \}/);
assert.doesNotMatch(followListInstagramDom, /confirmAction\.click\(\)/,
  'The Instagram reader must never choose the native confirmation action for the user.');
assert.match(followListInstagramWorkspace, /igUnfollowedAction/);
assert.doesNotMatch(followListInstagramHtml, /<dialog\b/,
  'The Instagram workspace must not add a second unfollow confirmation dialog.');

assert.match(imageDownload, /scanState: active \? downloadScanState\(session\) : 'paused'/);
assert.match(videoDownload, /scanState: active \? downloadScanState\(session\) : 'paused'/);
assert.match(popupSource, /groupVideoCandidates\(visible, selectedVideoCandidateIds\)/,
  'Video Download must group formats under distinct media items before rendering.');
assert.match(videoScanner, /mediaIdentity\(media\)[\s\S]*?mediaKey[\s\S]*?thumbnailUrl/,
  'Video Download must preserve DOM player identity and poster metadata.');
assert.match(videoDownload, /mediaKey: candidate\.mediaKey \|\| `hls:/,
  'Expanded HLS formats must retain their parent media identity.');
assert.match(videoDownload, /mediaKey: candidate\.mediaKey \|\| `dash:/,
  'Expanded DASH formats must retain their parent media identity.');
assert.match(imageDownload, /const workspacePromise = openImageWorkspace\([\s\S]*?const sourceTabPromise = chrome\.tabs\.get\([\s\S]*?Promise\.all\(\[workspacePromise, sourceTabPromise\]\)/,
  'Image Download must request its Side Panel before awaiting current-tab validation.');
assert.match(imageWorkspace, /retryReadUntil\([\s\S]*?value => value\?\.active === true/,
  'Image Download must wait through the Side Panel and session-start handoff.');
assert.match(imageWorkspace, /reloadPending = true[\s\S]*?document\.hidden/,
  'Image Download must retain state notifications received while its workspace is hidden.');
assert.match(imageDownload, /activePageScans[\s\S]*?allFrames: deep[\s\S]*?scan timed out/,
  'Image Download must coalesce page scans and keep standard scans bounded to the top frame.');
assert.match(imageDownload, /imagePageQuickDiscovery[\s\S]*?scanPhase = 'checking'/,
  'Image Download must publish a quick first result before source enrichment finishes.');
assert.match(imageDownload, /updates\.slice\(0, 500\)/,
  'Image Download metadata writes must remain bounded.');
assert.match(imageDownload, /UI_IMAGE_UPDATE_METADATA_BATCH/,
  'Image Download must combine preview metadata updates.');
assert.match(imageWorkspace, /requestAnimationFrame\(\(\) => appendBatch\(end\)\)/,
  'Image Download must render large result sets in small visual batches.');
assert.match(imageWorkspace, /imageScanTimedOut/,
  'Image Download must show a recoverable scan-timeout state.');
assert.match(imageWorkspace, /dataset\.busy[\s\S]*?scan-progress/,
  'Image Download must show a visible busy state while scanning.');

assert.ok(central.split('\n').length < 260, 'Central must remain a compact decision and routing layer.');
assert.match(central, /PROVINCE_PRODUCTS[\s\S]*standing:[\s\S]*operations:[\s\S]*customs:/);
assert.match(central, /createStandingProvince[\s\S]*createOperationsProvince[\s\S]*createCustomsProvince/);
assert.match(central, /provinceForProduct/);
assert.match(central, /productForMessage/);
assert.match(central, /centralPageDirectives/);
assert.match(centralPolicy, /managedSites\?\.zhihu === true[\s\S]*hostname\.endsWith\('\.zhihu\.com'\)/,
  'Central must own the Ad Marshal to Any Copy Zhihu coordination decision.');
assert.match(central, /UI_SET_CLAUDE_BROWSER_IDENTITY'\) return FEATURE_IDS\.CHINESE_RESPONSE_CLAUDE/);
assert.match(central, /createCustomsResponseIngress\(details => dispatchEvent\('headersReceived', details\)\)/);
assert.match(central, /validateMessageSource\(message, sender/);
assert.match(central, /validatePortSource\(port/);
assert.match(central, /documentId/);
assert.match(central, /Promise\.allSettled\(STATE_PRODUCTS/);
assert.match(central, /syncCentralPageProducts\(PAGE_PRODUCTS, directives/);
assert.match(centralPolicy, /yieldToAnyCopy[\s\S]*syncCentralPageProducts[\s\S]*const first = yielding \? FEATURE_IDS\.CLIPBOARD_PROTECT : FEATURE_IDS\.ANY_COPY/,
  'Central must stop the outgoing copy guard before it starts the incoming guard.');
assert.match(central, /unavailableProductState/);
assert.doesNotMatch(central, /onHeadersReceived\.addListener|CUSTOMS_RESPONSE_FILTER|setCustomsResponseIngressEnabled/,
  'Central must not install a global Customs response listener.');
assert.match(central, /windowCreated[\s\S]*handleWindowCreated[\s\S]*chrome\.windows\.onCreated/);
assert.doesNotMatch(central, /chrome\.storage\.(?!onChanged\.addListener)|chrome\.scripting\.executeScript|chrome\.tabs\.(?:query|create|update)|chrome\.downloads\.download\s*\(|chrome\.sidePanel|chrome\.offscreen|chrome\.declarativeNetRequest|fetch\s*\(/,
  'Central may decide and route, but must not execute product work.');

for (const method of ['initialize', 'getProductState', 'syncProduct', 'handleMessage', 'handleConnect', 'handleTabUpdated', 'handleTabRemoved', 'handleActionClicked', 'handleWindowCreated', 'handleWindowRemoved', 'handleDownloadChanged', 'handleDeterminingFilename', 'handleHeadersReceived', 'handleAlarm', 'handleStorageChanged', 'reset']) {
  assert.match(provinceInterface, new RegExp(method));
}
for (const [id, province] of [['standing', standing], ['operations', operations], ['customs', customs]]) {
  assert.match(province, /defineProvince\(/);
  assert.match(province, new RegExp(`id: '${id}'`));
  assert.match(province, /products/);
}
assert.match(standing, /createNativeScrollProduct[\s\S]*createNoAutoplayProduct[\s\S]*createMailtoCaptureProduct/);
assert.match(standing, /createAccessControlProduct/);
assert.match(standing, /createAdMarshalProduct/);
assert.match(central, /FEATURE_IDS\.CLIPBOARD_PROTECT[\s\S]*FEATURE_IDS\.ACCESS_CONTROL[\s\S]*FEATURE_IDS\.WEBSITE_KNOWLEDGE_CONTROL/);
assert.match(accessControl, /getSessionRules[\s\S]*updateSessionRules/);
assert.match(accessControl, /urlFilter: `\|\|\$\{domain\}\^`[\s\S]*'main_frame', 'sub_frame'/);
assert.match(central, /chrome\.action\.onClicked\.addListener/);
assert.match(accessControl, /webRequest\?\.onErrorOccurred/);
assert.match(accessControl, /chrome\.action\.setPopup/);
assert.match(accessControl, /updateSessionRules\([\s\S]*chrome\.tabs\.update/,
  'Access Control must install the temporary rule before retrying the blocked destination.');
assert.doesNotMatch(accessControl, /chrome\.tabs\.reload|scripting\.executeScript|UI_ACCESS_CONTROL_ALLOW_VISIT/);
assert.doesNotMatch(popupSource, /access-control-visit|UI_ACCESS_CONTROL_ALLOW_VISIT/);
assert.match(operations, /createAnyCopyProduct[\s\S]*createAnyCopyEnhancedProduct[\s\S]*createSatellitesProduct[\s\S]*createPageDisplayProduct[\s\S]*createXhsImageDarkModeProduct[\s\S]*createAdministrationProduct/);
assert.match(customs, /createImageDownloadProduct[\s\S]*createVideoDownloadProduct[\s\S]*createCustomsOffscreenCoordinator/);
assert.match(customs, /restorationTask[\s\S]*if \(restorationTask\) return restorationTask/,
  'Customs Province must coalesce concurrent session restoration.');
assert.match(customsObservation, /responseIngress\.setTabs\(tabIds\)/);
assert.doesNotMatch(customsObservation, /setEnabled|restorationReliable \|\|/,
  'Uncertain restoration must not enable an all-tab response fallback.');
assert.match(customsResponseIngress, /event\.addListener\(listener, \{[\s\S]*tabId/,
  'Customs response ingress must register exact tab filters.');
assert.match(customsResponseIngress, /event\.removeListener\(listener\)/,
  'Customs response ingress must release exact tab filters.');
assert.match(customs, /createCustomsObservationRegistry/);
assert.match(customs, /imageDownload\.initialize\(\)[\s\S]*videoDownload\.initialize\(\)/);
assert.match(customsObservation, /const tabIds = new Set\(\[\.\.\.collecting\]/);
assert.match(customsObservation, /restorationReliable/);
assert.match(customsObservation, /needsRestoration/);
assert.match(offscreenCoordinator, /activeAssemblies[\s\S]*activeRequests[\s\S]*queueDocumentLifecycle[\s\S]*sendVideoArtifact[\s\S]*sendImageArtifact[\s\S]*maybeClose/);

assert.match(runtimeHost, /chrome\.scripting\.executeScript/);
assert.match(runtimeHost, /CG_STOP_CENTRAL_FEATURE/);
assert.match(runtimeHost, /disposeMainRuntime/);
assert.match(runtimeHost, /documentIds/);
assert.match(runtimeHost, /response\?\.disposed === true/);
assert.match(runtimeHost, /catch \(error\)[\s\S]*CG_STOP_CENTRAL_FEATURE[\s\S]*disposeMainRuntime[\s\S]*throw error/);
assert.match(messageSource, /PAGE_MESSAGE_TYPES[\s\S]*OFFSCREEN_MESSAGE_TYPES[\s\S]*validatePortSource/);
assert.match(nativeScroll, /content\/native-scroll-bridge\.js[\s\S]*content\/runtime\.js/);
assert.match(nativeScrollRuntime, /usesNativeInteractionCompatibility\(\)[\s\S]*return this\.isXhsHost\(\)/);
assert.match(nativeScrollRuntime, /if \(this\.usesNativeInteractionCompatibility\(\)\) return;/);
assert.match(nativeScrollRuntime, /const receiver = owner === window \? window : this[\s\S]*Reflect\.apply\(original, receiver, args\)/,
  'Native Scroll must preserve the Window receiver for wrapped Window scrolling methods.');
assert.match(nativeScrollRuntime, /RETAINED_LISTENERS_KEY[\s\S]*retainListenerRegistry/);
assert.match(noAutoplay, /content\/no-autoplay-bridge\.js[\s\S]*content\/no-autoplay-runtime\.js/);
assert.doesNotMatch(noAutoplay, /topFrameOnly|context\.frameId === 0/,
  'No Autoplay must follow the top-level page policy inside embedded web frames.');
assert.match(noAutoplayRuntime, /querySelectorAll\('video,audio'\)[\s\S]*media\.paused === false/,
  'No Autoplay must catch media that began playing before its configuration arrived.');
assert.match(noAutoplayRuntime, /isPlaybackControl[\s\S]*hasRecentPlaybackIntent/);
assert.match(noAutoplayRuntime, /associatePlaybackIntent[\s\S]*ASSOCIATED_MEDIA_INTENT_MS[\s\S]*playerIntent/,
  'No Autoplay must preserve explicit playback intent for media associated with a custom player control.');
assert.match(noAutoplayRuntime, /blockedPlayPromise[\s\S]*Promise\.reject\(error\)[\s\S]*denial\.catch/,
  'Blocked media play requests must not report a false success to custom players.');
assert.doesNotMatch(noAutoplayRuntime, /navigator\.userActivation/,
  'Ordinary page interaction must not be treated as playback intent.');
assert.match(mailtoCapture, /content\/mailto-capture-bridge\.js[\s\S]*content\/mailto-capture-runtime\.js/);
assert.match(mailtoCapture, /runtimeDependencies[\s\S]*content\/mailto-capture-nanp\.js[\s\S]*content\/mailto-capture-phone\.js/,
  'Mailto Capture must load its compact offline telephone references before the page runtime.');
assert.doesNotMatch(mailtoCaptureRuntime, /NANP_LOCATION_LABEL|Area code location/,
  'Mailto Capture must not render numbering-plan locations as a separate labeled field.');
assert.match(mailtoCaptureRuntime, /\.phone-location\{color:var\(--mc-muted\)\}/,
  'Mailto Capture must distinguish inline locations by color without reducing their type size.');
assert.match(mailtoCaptureRuntime, /\.phone-location>\.phone-location-nowrap\{[^}]*white-space:nowrap/,
  'Mailto Capture must keep selected location suffixes together during natural wrapping.');
assert.match(mailtoCaptureRuntime, /appendLocationText[\s\S]*text\.startsWith\('中国 '\)[\s\S]*countrySuffix = ', USA'[\s\S]*chinaSuffix = ', China'[\s\S]*numberingPlanSuffix = 'North American Numbering Plan'[\s\S]*phone-location-nowrap/,
  'Mailto Capture must isolate US and China location units during natural wrapping.');
assert.match(mailtoCaptureRuntime, /appendTelephoneField[\s\S]*if \(item\.location\)/,
  'Mailto Capture must place only recognized locations beneath their telephone numbers.');
assert.match(mailtoCaptureRuntime, /displayTelephoneNumber[\s\S]*\+1 [\s\S]*ext\./,
  'Mailto Capture must standardize NANP display while preserving telephone URI extensions.');
assert.match(mailtoCaptureNanp, /Three-digit area results are used whenever reliable[\s\S]*const detail = Object\.freeze[\s\S]*function exactLocality/,
  'Mailto Capture must retain its precompiled hybrid NPA and NPA-NXX location index.');
assert.ok(Buffer.byteLength(mailtoCaptureNanp, 'utf8') < 500_000,
  'Mailto Capture numbering-plan data must remain compact enough for ordinary page injection.');
assert.match(mailtoCapturePhone, /libphonenumber-js 1\.13\.13 \/ Google libphonenumber 9\.0\.39/,
  'Mailto Capture international metadata must identify its pinned upstream versions.');
assert.match(mailtoCapturePhone, /function internationalNational[\s\S]*function chinaLocation[\s\S]*function mexicoLocation/,
  'Mailto Capture must format international numbers and retain localized China and Mexico location rules.');
assert.ok(Buffer.byteLength(mailtoCapturePhone, 'utf8') < 90_000,
  'Mailto Capture international formatting and China fixed-line data must remain precompiled and compact.');
assert.doesNotMatch(mailtoCaptureNanp, /United States/,
  'Mailto Capture area-code results must use the compact USA country label.');
assert.doesNotMatch(mailtoCaptureNanp, /U\.S\. Government/,
  'Mailto Capture must use the consistent USA Government label.');
assert.match(mailtoCaptureRuntime, /attachShadow\(\{ mode: 'closed'/);
assert.match(mailtoCaptureProtocols, /\^mailto:[\s\S]*recipientValues[\s\S]*cc[\s\S]*bcc[\s\S]*subject[\s\S]*body[\s\S]*otherFields/);
assert.match(mailtoCaptureProtocols, /\^sms:[\s\S]*recipients[\s\S]*body[\s\S]*otherFields/);
assert.match(mailtoCaptureRuntime, /onPointerDown[\s\S]*path\.includes\(this\.host\)[\s\S]*this\.close\(\)/);
assert.match(mailtoCaptureRuntime, /event\.key === 'Escape'[\s\S]*this\.close\(true\)/);
assert.match(anyCopy, /UI_TOGGLE_COORDINATED_TAB_FEATURE[\s\S]*COORDINATED_PAUSE_PREFIX/,
  'Any Copy must keep coordinated pauses tab-scoped and separate from hostname rules.');
assert.doesNotMatch(anyCopy, /ad-marshal|managedSites/,
  'Any Copy must consume Central directives without reading or controlling Ad Marshal.');
assert.match(mailtoCaptureRuntime, /simpleAddressOnly[\s\S]*labels\.copyAddress[\s\S]*labels\.copyMessage/);
assert.match(mailtoCaptureRuntime, /user-select:text/);
assert.match(mailtoCaptureRuntime, /\.status:empty\{display:none\}/);
assert.match(mailtoCaptureRuntime, /\.heading\{[^}]*align-items:baseline[^}]*\}[\s\S]*\.close\{[^}]*align-self:baseline/);
assert.doesNotMatch(mailtoCaptureRuntime, /MutationObserver|setInterval|location\.(?:href|assign|replace)|document\.createElement\(['"]a['"]\)|Open mail app/);
assert.match(pageDisplay, /content\/page-display-bridge\.js[\s\S]*content\/page-display-runtime\.js/);
assert.match(pageDisplay, /pageStyleFiles[\s\S]*content\/page-display\.css[\s\S]*pageRuntimeHost\.sync/,
  'Page Display must inject its visual layer at Chrome USER origin so page CSP cannot disable it.');
assert.match(pageDisplay, /context\.frameId === 0[\s\S]*pageRuntimeHost\.sync/);
assert.match(pageDisplayBridge, /CG_PAGE_STATE'[\s\S]*featureId: 'pageDisplay'/);
assert.match(pageDisplayBridge, /sendResponse\(\{ disposed: true \}\)/);
assert.doesNotMatch(pageDisplayBridge, /chrome\.storage/);
assert.doesNotMatch(pageDisplayRuntime, /\.style\.|style\.cssText|setAttribute\(['"]style/,
  'Page Display runtime must not depend on inline styles that strict page CSP can block.');
assert.match(pageDisplayStyles, /position:\s*fixed\s*!important[\s\S]*inset:\s*0\s*!important[\s\S]*pointer-events:\s*none\s*!important/);
assert.match(pageDisplayStyles, /backdrop-filter:\s*grayscale\(1\)\s*!important/);
assert.match(pageDisplayRuntime, /document\.fullscreenElement[\s\S]*fullscreenchange/);
assert.match(pageDisplayRuntime, /this\.host\?\.remove\(\)[\s\S]*this\.host = null/);
assert.match(pageDisplayRuntime, /invertSlope[\s\S]*shadeIsInsideInversion[\s\S]*data-shade[\s\S]*'light'[\s\S]*'dark'/,
  'Reduce White Point must compensate when an ancestor filter inverts its compositing layer.');
assert.match(pageDisplayStyles, /data-shade="dark"[\s\S]*rgb\(0 0 0 \/[\s\S]*data-shade="light"[\s\S]*rgb\(255 255 255 \//,
  'Reduce White Point must provide both ordinary and inversion-compensated USER-origin shades.');
assert.match(pageDisplayRuntime, /observeAppearanceTarget\(document\.documentElement[\s\S]*observeAppearanceTarget\(document\.body[\s\S]*observeAppearanceTarget\(document\.head/,
  'Reduce White Point appearance tracking must stay scoped to theme-bearing page surfaces.');
assert.match(pageDisplayRuntime, /if \(reduceWhitePoint\) this\.startAppearanceTracking\(\)[\s\S]*else this\.stopAppearanceTracking\(\)/);
assert.doesNotMatch(pageDisplayRuntime, /IntersectionObserver|ResizeObserver|setInterval|fetch\s*\(|XMLHttpRequest|WebSocket|addEventListener\(['"](?:click|pointer|wheel|touch|key)/);
assert.match(xhsImageDarkMode, /content\/xhs-image-dark-mode-bridge\.js[\s\S]*content\/xhs-image-dark-mode-runtime\.js/);
assert.match(xhsImageDarkMode, /hostname !== 'www\.xiaohongshu\.com'/);
assert.match(xhsImageDarkModeRuntime, /MAX_SAMPLE_PIXELS = 32 \* 32[\s\S]*CACHE_LIMIT = 240/);
for (const observer of ['IntersectionObserver', 'MutationObserver', 'ResizeObserver']) {
  assert.match(xhsImageDarkModeRuntime, new RegExp(observer));
}
assert.match(xhsImageDarkModeRuntime, /this\.running < 2/);
assert.match(xhsImageDarkModeRuntime, /isAvatar[\s\S]*sns-avatar/);
assert.match(xhsImageDarkModeRuntime, /note-detail-follow-btn/);
assert.match(xhsImageDarkModeRuntime, /edgeShare >= 0\.42[\s\S]*surfaceShare >= 0\.72[\s\S]*largestForegroundShare <= 0\.16/);
assert.match(xhsImageDarkModeRuntime, /strongestPanelShare[\s\S]*splitToneLayout[\s\S]*lightPanelShare >= 0\.72[\s\S]*darkPanelShare >= 0\.48/,
  'XHS Image Dark Mode must recognize stable split-tone document panels.');
assert.match(xhsImageDarkModeRuntime, /vividCard[\s\S]*Math\.abs\(value - backgroundLuminance\) >= 0\.22[\s\S]*foregroundComponents\.count >= 5[\s\S]*largestForegroundShare <= 0\.08/,
  'Vivid XHS text cards must recognize both light and dark text while rejecting large photo subjects.');
assert.match(xhsImageDarkModeRuntime, /conversationSurfaceCandidates[\s\S]*conversationSurfaceComponents\.count >= 3[\s\S]*conversationSurfaceComponents\.largestShare <= 0\.16[\s\S]*conversationTextStructure/,
  'XHS chat screenshots must require repeated reading surfaces and text-like foreground structure.');
assert.match(xhsImageDarkModeRuntime, /relatedResult\?\.kind[\s\S]*relatedResult\.kind !== 'photo'/,
  'Negative feed-cover classifications must not suppress independent viewer analysis.');
assert.match(chineseResponseClaude, /content\/chinese-response-claude-bridge\.js[\s\S]*content\/chinese-response-claude-runtime\.js/);
assert.match(chineseResponseClaude, /createRequestIdentityRules/);
assert.match(chineseResponseClaude, /frameId > 0[\s\S]*responseDisplay: false/);
assert.match(chineseResponseClaudeRuntime, /font-claude-response[\s\S]*MutationObserver/);
assert.match(chineseResponseClaudeRuntime, /pre[\s\S]*code[\s\S]*contenteditable[\s\S]*katex/);
assert.match(chineseResponseClaudeRuntime, /this\.records[\s\S]*record\.transformed[\s\S]*record\.original/);
assert.match(chineseResponseClaudeRuntime, /chinese-response-claude:activity[\s\S]*syncActivity/);
assert.match(chineseResponseClaudeBridge, /chinese-response-claude:activity[\s\S]*CG_FEATURE_ACTIVITY/);
assert.match(popupSource, /chineseResponseClaude[\s\S]*hostname: 'claude\.ai'[\s\S]*chineseResponseClaudeActiveTitle/,
  'Claude response display optimization must expose its contextual popup control and intervention state.');
assert.match(chineseResponseClaudeRuntime, /EAST_EIGHT_TIMEZONE_OFFSET = -480[\s\S]*America\/New_York/,
  'Claude browser identity normalization must change only UTC+8 device time zones to New York.');
assert.match(chineseResponseClaudeRuntime, /installIdentityNormalization[\s\S]*restoreIdentityNormalization/,
  'Claude browser identity normalization must share the product lifecycle and restore its page API wrappers.');
assert.match(chineseResponseClaude, /UI_SET_CLAUDE_BROWSER_IDENTITY[\s\S]*retainUntilTabsClose[\s\S]*handleTabRemoved/,
  'Claude browser identity normalization must have independent control and defer shutdown until governed tabs close.');
assert.doesNotMatch(chineseResponseClaudeRuntime, /fetch\s*\(|XMLHttpRequest|WebSocket|setInterval/);
assert.match(xhsImageDarkModeRuntime, /!image\.complete \|\| !image\.naturalWidth[\s\S]*waitForImageLoad[\s\S]*loadPriority/,
  'Unloaded XHS images must not occupy an image-analysis worker.');
assert.match(xhsImageDarkModeRuntime, /imageRequestKey[\s\S]*record\.requestKey !== requestKey[\s\S]*viewerForImage\(image\) \? -20 : 0[\s\S]*waitForImageLoad\(record, priority\)/,
  'Reused XHS viewer elements must follow src and srcset changes before currentSrc updates.');
assert.match(xhsImageDarkModeRuntime, /controlRecords[\s\S]*createControl[\s\S]*resizeObserver\?\.observe\(record\.image\)[\s\S]*startControlPositionTracking[\s\S]*if \(!this\.controlRecords\.size\) this\.stopControlPositionTracking\(\)[\s\S]*scheduleControlPositions[\s\S]*for \(const record of this\.controlRecords\)/,
  'Only expanded-view controls may participate in resize and scroll positioning.');
assert.match(xhsImageDarkModeRuntime, /viewerImageContext\(image\)[\s\S]*image\.closest\?\.\('#noteContainer'\)[\s\S]*return false[\s\S]*note-slider-img, \.img-container[\s\S]*primaryImage !== image/,
  'Viewer overlays must not be analyzed as post media.');
assert.match(xhsImageDarkModeRuntime, /const positionedOwners = new Set\(\)[\s\S]*!positionedOwners\.has\(owner\)[\s\S]*positionedOwners\.add\(owner\)/,
  'A viewer must never display overlapping image controls.');
assert.match(xhsImageDarkModeRuntime, /togglePostOverride[\s\S]*postOverrides\.set\(postKey, darkened\)[\s\S]*applyPostMode\(postKey, darkened\)[\s\S]*restorePostAutomatic[\s\S]*postOverrides\.delete\(postKey\)/,
  'Long presses must alternate a stable post-wide display mode, while clicks restore automatic recognition.');
assert.match(xhsImageDarkModeRuntime, /recordsForPost\(postKey\)[\s\S]*viewerPostKey\(record\.image\) === postKey[\s\S]*document\.querySelectorAll\?\.\([\s\S]*record\.button\.hidden = !this\.showImageControl \|\| this\.profileProcessingDisabled\(record\)/,
  'Post-wide overrides must include matching feed covers without hiding the image control.');
assert.match(xhsImageDarkModeRuntime, /inlineCommentImage[\s\S]*#noteContainer, \.note-container[\s\S]*armCommentPreview[\s\S]*pendingCommentPreview[\s\S]*markCommentPreview[\s\S]*hasOpenCommentPreview/,
  'Comment images must remain expanded-post-only and preview association must survive resource URL changes.');
assert.match(xhsImageDarkModeRuntime, /bindCommentControl[\s\S]*record\.darkened = !record\.darkened[\s\S]*commentPreview \|\| !commentPreviewOpen/,
  'Comment previews must own a single-image control while suppressing the post image control.');
assert.match(xhsImageDarkModeRuntime, /if \(!record\.image\.isConnected\) \{[\s\S]*record\.button\.style\.display = 'none'/,
  'A detached comment preview control must leave the hit-testing layer immediately.');
assert.match(xhsImageDarkModeRuntime, /touch-action: none[\s\S]*const shield = event =>[\s\S]*event\.stopPropagation/,
  'XHS image controls must isolate their complete pointer gesture from page carousel handlers.');
assert.match(xhsImageDarkModeRuntime, /checkVisibility[\s\S]*activeCommentPreviewRecord[\s\S]*record === activeCommentPreview/,
  'Only the actually visible comment preview may own a control or suppress the post control.');
assert.match(xhsImageDarkModeRuntime, /commentPreviewRecords[\s\S]*activeCommentPreviewRecord\(\)[\s\S]*this\.commentPreviewRecords/,
  'XHS Image Dark Mode must index comment previews instead of rescanning every image record during control positioning.');
assert.match(xhsImageDarkModeRuntime, /mutation\.removedNodes\?\.length[\s\S]*needsCleanup[\s\S]*if \(needsCleanup\) this\.scheduleCleanup\(\)/,
  'XHS Image Dark Mode must reserve full record cleanup for DOM removals.');
assert.match(xhsImageDarkModeRuntime, /profileControlUrl[\s\S]*controlMatchesCurrentPage[\s\S]*if \(controlMatchesCurrentPage\) return/,
  'XHS Image Dark Mode must avoid rewriting an unchanged profile control on unrelated mutations.');
assert.match(xhsImageDarkModeRuntime, /isContentImage\(image, knownCommentKind\)[\s\S]*knownCommentKind === undefined/,
  'XHS Image Dark Mode must reuse comment classification within the image-registration hot path.');
assert.match(xhsImageDarkModeRuntime, /prioritizeModal[\s\S]*filter\(image => this\.viewerImageContext\(image\)\)/,
  'Opening a post must not eagerly analyze its entire comment image list.');
assert.match(xhsImageDarkModeRuntime, /currentProfileKey[\s\S]*disabledProfileKeys[\s\S]*toggleProfileDisabled[\s\S]*removeQueuedImage[\s\S]*collectImages\(document\)/,
  'Profile controls must stop pending analysis and resume image discovery for only the current profile.');
assert.match(xhsImageDarkModeRuntime, /result\.kind === 'photo'[\s\S]*retireRecord\(record\)[\s\S]*intersectionObserver\?\.unobserve/,
  'Completed feed photographs must release their record and intersection observation.');
assert.match(xhsImageDarkModeRuntime, /requestIdleCallback\(run, \{ timeout: 600 \}\)[\s\S]*schedulePump\(\(this\.queue\[0\]\?\.priority \?\? 0\) < 0\)/,
  'Background image work must return to idle scheduling after urgent work completes.');
assert.match(xhsImageDarkModeRuntime, /processingGeneration[\s\S]*generation !== this\.processingGeneration[\s\S]*this\.records\.get\(image\) !== record/,
  'Superseded image work must not write into a later processing lifecycle.');
assert.match(xhsImageDarkModeRuntime, /grayBackground[\s\S]*'gray-theme'[\s\S]*cg-xhs-image-dark-mode-gray/);
assert.match(xhsImageDarkModeRuntime, /--cg-xhs-image-brightness, 1[\s\S]*noteCacheKey[\s\S]*visualTarget/);
assert.match(xhsImageDarkModeRuntime, /viewerForImage\(record\.image\)[\s\S]*fractionRect\.right - FRACTION_SLOT_WIDTH - CONTROL_GAP - CONTROL_SIZE/);
assert.match(xhsImageDarkModeRuntime, /renderedPageWideDarkMode[\s\S]*surfaceLuminanceAtPoint[\s\S]*darkShare >= 0\.5/);
assert.match(xhsImageDarkModeRuntime, /detectDarkMode\(\)[\s\S]*renderedPageWideDarkMode\(\)[\s\S]*explicitDarkMode\(\)/);
assert.match(xhsImageDarkModeRuntime, /dark-reader-filter[\s\S]*data-darkreader-mode[\s\S]*meta\[name="darkreader"\]/);
assert.doesNotMatch(xhsImageDarkModeRuntime, /FaceDetector|maskImage|cg-xhs-dark-overlay/);
assert.doesNotMatch(xhsImageDarkModeRuntime, /setInterval|fetch\s*\(|XMLHttpRequest|WebSocket/);
assert.match(adMarshal, /getSessionRules[\s\S]*updateSessionRules/);
assert.match(adMarshal, /tabIds[\s\S]*universal-report\.min\.js[\s\S]*\/qqindex2021\/advertisement\//);
assert.match(adMarshal, /wwwQqCom[\s\S]*https:\/\/www\.qq\.com\/\*/);
assert.match(adMarshal, /SETTING_ID_BY_SITE_ID[\s\S]*settings\.adMarshal\.managedSites/);
assert.match(adMarshal, /UI_SET_AD_MARSHAL_SITE/);
assert.match(adMarshal, /void reconcile\(settings\)\.catch\(\(\) => false\)[\s\S]*return settings\.adMarshal/,
  'Saving an Ad Marshal site selection must not wait for native network-rule reconciliation.');
assert.match(adMarshal, /WWW_QQ_TRACKING_DOMAINS[\s\S]*h5\.ssp\.qq\.com[\s\S]*\/www\/js\/emonitor\//);
assert.match(adMarshal, /zhihuCom[\s\S]*http:\/\/\*\.zhihu\.com\/\*/);
assert.match(adMarshal, /ZHIHU_TELEMETRY_DOMAINS[\s\S]*zhihu-web-analytics\.zhihu\.com[\s\S]*crash2\.zhihu\.com[\s\S]*hm\.baidu\.com/);
assert.doesNotMatch(adMarshal, /douyinCom|gmailCom|DOUYIN_TELEMETRY_DOMAINS|GMAIL_RUNTIME_FRAME_HOSTS/);
assert.match(adMarshal, /\/@cfe\/sentry-script@[\s\S]*\/za-js-sdk@/);
assert.match(adMarshal, /ad-marshal-empty\.js[\s\S]*ad-marshal-empty\.json[\s\S]*ad-marshal-empty\.html[\s\S]*ad-marshal-transparent\.svg/);
assert.match(adMarshal, /news\.ssp\.qq\.com[\s\S]*op\.ssp\.qq\.com[\s\S]*127\.0\.0\.1:11601\/check/);
assert.match(adMarshal, /activeTabs\.get\(tabId\) === nextSiteId[\s\S]*Promise\.resolve/,
  'Ad Marshal must avoid native rule reads on unrelated or already synchronized tabs.');
assert.match(adMarshalRuntime, /globalThis\.fetch = this\.fetchWrapper[\s\S]*XMLHttpRequest\.prototype\.open = this\.xhrOpenWrapper[\s\S]*Navigator\.prototype\.sendBeacon = this\.sendBeaconWrapper/);
assert.match(adMarshalRuntime, /TRANSPARENT_IMAGE_URL[\s\S]*HTMLImageElement\.prototype/);
assert.match(adMarshalRuntime, /127\.0\.0\.1[\s\S]*adMarshalImageSrcSet/);
assert.match(adMarshalRuntime, /tonglan-ad-channel\.ad-news[\s\S]*rectangle-ad-channel\.ad-news[\s\S]*NEWS_QQ_AD_CONTAINER_SELECTOR[\s\S]*this\.ensureStyle\(\)/);
assert.match(adMarshalRuntime, /NEWS_QQ_MEDIA_CONTAINER_SELECTOR[\s\S]*#content-right\.content-right[\s\S]*NEWS_QQ_REMOVED_VIDEO_SELECTOR[\s\S]*\.qnt-p \.videoPlayerMini/);
assert.match(adMarshalRuntime, /NEWS_QQ_REMOVED_VIDEO_SELECTOR[\s\S]*\.qqcom-jxvideo[\s\S]*\.video-wrap[\s\S]*iframe\[src\*="video\.qq\.com"\][\s\S]*iframe\[src\*="v\.qq\.com"\]/);
assert.match(adMarshalRuntime, /startNewsVideoContainerRemoval[\s\S]*removeNewsVideoContainers\(document\)[\s\S]*record\.addedNodes/);
assert.match(adMarshalRuntime, /releaseNewsMediaContainer[\s\S]*video\.pause\(\)[\s\S]*video\.removeAttribute\('src'\)[\s\S]*container\.matches\('iframe'\)[\s\S]*container\.remove\(\)/);
assert.match(adMarshalRuntime, /startNewsFloatingPlayerMonitoring[\s\S]*document\.querySelector\('\.qnt-p'\)[\s\S]*observeNewsFloatingPlayerRoot/);
assert.match(adMarshalRuntime, /suspendNewsFloatingPlayer[\s\S]*prepareNewsMedia\(media, \{ force: true \}\)/);
assert.doesNotMatch(adMarshalRuntime, /suspendNewsFloatingPlayer[\s\S]{0,500}(?:releaseNewsMediaContainer|player\.remove\(\))/,
  'The Tencent News floating player must be suspended without deleting its node or media sources.');
assert.match(adMarshalRuntime, /observeNewsFloatingPlayerRoot[\s\S]*record\.addedNodes[\s\S]*attributeFilter: \['class'\]/);
assert.match(adMarshalRuntime, /newsFloatingPlayerObserver\?\.disconnect\(\)[\s\S]*this\.newsFloatingPlayerObserver = null/);
assert.match(adMarshalRuntime, /installNewsMediaGuards[\s\S]*addEventListener\('pointerdown'[\s\S]*addEventListener\('play'[\s\S]*addEventListener\('volumechange'/);
assert.match(adMarshalRuntime, /pauseNewsMedia[\s\S]*removeAttribute\('autoplay'\)/);
assert.match(adMarshalRuntime, /prepareNewsMedia[\s\S]*media\.muted = true[\s\S]*setAttribute\('preload', 'none'\)[\s\S]*media\.load\(\)/);
assert.match(adMarshalRuntime, /newsMediaForEvent[\s\S]*closest\?\.\('\.qnt-p'\)[\s\S]*this\.newsMediaIntent\.set/);
assert.match(adMarshalRuntime, /isNewsVolumeControlEvent[\s\S]*volume\|mute\|muted\|unmuted[\s\S]*this\.newsUnmuteIntent\.set/);
assert.match(adMarshalRuntime, /isNewsPlaybackControlEvent[\s\S]*play\|replay\|poster[\s\S]*if \(playbackControl\) this\.activateNewsMedia/);
assert.match(adMarshalRuntime, /onNewsVolumeChange[\s\S]*hasNewsUnmuteIntent[\s\S]*newsUserUnmutedMedia\.add/);
assert.match(adMarshalRuntime, /NEWS_MEDIA_ACTIVE_MARKER[\s\S]*txp_poster_img[\s\S]*setAttribute\(NEWS_MEDIA_ACTIVE_MARKER/);
assert.match(adMarshalRuntime, /removeNewsMediaGuards[\s\S]*removeEventListener\('pointerdown'[\s\S]*removeEventListener\('play'[\s\S]*removeEventListener\('volumechange'/);
assert.match(adMarshalRuntime, /hostStyles:[\s\S]*'news\.qq\.com'[\s\S]*config\?\.hostStyles\?\.\[location\.hostname\.toLowerCase\(\)\]/);
assert.match(adMarshalRuntime, /STYLE_MARKER[\s\S]*document\.querySelector[\s\S]*setAttribute\(STYLE_MARKER, this\.siteId\)/);
assert.doesNotMatch(adMarshalRuntime, /this\.styleElement\?\.remove\(\)/);
assert.match(adMarshalRuntime, /wwwQqCom[\s\S]*h5\.ssp\.qq\.com[\s\S]*qqhome-col-1:has\(> \.game-rank-wrap\)/);
assert.match(adMarshalRuntime, /zhihuCom[\s\S]*hostSuffix: '\.zhihu\.com'[\s\S]*zhihu-web-analytics\.zhihu\.com[\s\S]*\/za-js-sdk@/);
assert.doesNotMatch(adMarshalRuntime, /douyinCom|gmailCom|play\.google\.com\/log/);
assert.doesNotMatch(adMarshalRuntime, /data-beacon|removeChild/,
  'Ad Marshal must not alter Beacon metadata or use broad node-removal primitives.');
assert.doesNotMatch(adMarshalRuntime, /Node\.prototype\.(?:appendChild|insertBefore|replaceChild)\s*=/,
  'Ad Marshal must not wrap generic DOM insertion methods.');
assert.match(anyCopy, /content\/any-copy-bridge\.js[\s\S]*content\/any-copy-runtime\.js/);
assert.match(anyCopy, /message\.rule \|\| message\.hostname/);
assert.match(anyCopyEnhanced, /content\/any-copy-enhanced-bridge\.js[\s\S]*content\/any-copy-enhanced-runtime\.js/);
assert.match(anyCopyEnhanced, /anyCopyEnhancedTab:/);
assert.match(anyCopyEnhanced, /createKeyedTaskQueue/);
assert.match(satellites, /https:\/\/api\.bilibili\.com\/x\/web-interface\/nav/);
assert.match(satellites, /https:\/\/api\.bilibili\.com\/x\/member\/web\/exp\/reward/);
assert.match(satellites, /AbortController[\s\S]*signal[\s\S]*stopRun/);
assert.match(satellites, /mutateSettings\([\s\S]*\), false\)/);
assert.match(administration, /UI_GET_ACTIVE_PAGE_STATE[\s\S]*UI_OPEN_ALL_SETTINGS[\s\S]*UI_RESET_ALL_SETTINGS/);
assert.match(administration, /UI_GET[\s\S]*includePreferences: true/);
assert.match(central, /includePreferences === true \? \{ preferences: settings \} : \{\}/);
assert.match(platform, /chrome\.storage[\s\S]*refreshOpenPages[\s\S]*renderToolbar/);
assert.match(platform, /refreshTabPage[\s\S]*\[0, 80, 240\]/);
assert.match(platform, /createKeyedTaskQueue/);
assert.match(platform, /activityQueue\.run/);
assert.match(platform, /queueWrite/);
assert.match(platform, /resettingStorage/);
assert.match(platform, /clearOrphanedActivity/);
assert.match(platform, /RETAINED_DOWNLOAD_PREFIXES/);
assert.match(config, /DEFAULT_INCOGNITO_SETTINGS[\s\S]*nativeScroll:[\s\S]*enabled: false[\s\S]*noAutoplay:[\s\S]*enabled: false/);
assert.match(config, /pageDisplay:[\s\S]*enabled: false[\s\S]*reduceWhitePoint:[\s\S]*enabled: false[\s\S]*reduction: 0\.25[\s\S]*greyscale:[\s\S]*enabled: false/);
assert.match(administration, /PAGE_DISPLAY\]: 'settings\/page-display\.html'/);
assert.match(platform, /INCOGNITO_SETTINGS_KEY[\s\S]*chrome\.storage\.session[\s\S]*INCOGNITO_WINDOWS_KEY/);
assert.match(platform, /handleIncognitoWindowChange/);
assert.match(platform, /refreshToolbarTitles[\s\S]*readActivity\(tab\.id\)[\s\S]*renderToolbar[\s\S]*setLocale/);
assert.match(satellites, /inIncognitoContext[\s\S]*ownsDailySchedule/);
assert.match(satellites, /available: false/);
assert.match(satellites, /if \(ownsDailySchedule\) return settings\.satellites/);
assert.match(settingsSource, /disabledByDefaultInIncognito/);
assert.match(popupStyle, /#video-stop, #video-stop:hover \{ background: transparent; color: var\(--danger\); \}/);
assert.match(imageDownloadStyle, /#stop, #stop:hover \{ background: transparent; color: var\(--danger\); \}/);
assert.doesNotMatch(popupHtml, /class="identity"\s+hidden/);
assert.doesNotMatch(popupStyle, /^\.identity(?:\s|\[|\{|\.)/m);
assert.doesNotMatch(imageWorkspace, /recommendationPresentationEnabled|recommendedOriginal|recommended-badge/);
assert.doesNotMatch(imageDownloadStyle, /\.recommended-badge\b/);
for (const removedIcon of ['power', 'siteAdd', 'siteRemove', 'siteCovered', 'settings']) {
  assert.doesNotMatch(sharedUi, new RegExp(`\\n\\s*${removedIcon}:`));
}
assert.match(settingsSource, /helpPanel\.hidden = false/);
assert.doesNotMatch(settingsSource, /helpPanel\.hidden = incognitoContext/);

assert.match(imageDownload, /chrome\.sidePanel\.setOptions/);
assert.match(imageDownload, /typeof chrome\.sidePanel\?\.close === 'function'/);
assert.match(imageDownload, /UI_IMAGE_CLOSE_SIDE_PANEL/);
assert.match(imageDownload, /return \{\s*\.\.\.settings\.imageDownload,\s*supported,\s*active,/);
assert.match(imageDownload, /workspaces\/image-download\/image-download\.html/);
assert.match(imageDownload, /UI_IMAGE_DOWNLOAD/);
assert.match(imageDownload, /observation\.setCollecting\(FEATURE_IDS\.IMAGE_DOWNLOAD/);
assert.match(imageDownload, /sessionUpdates\.run/);
assert.match(imageDownload, /imageDownloadArtifact:/);
assert.match(imageDownload, /trackImageArtifact/);
assert.match(imageDownload, /downloads\.search\(\{ id: downloadId \}\)/);
assert.match(imageDownload, /preparedImageSidePanels\.delete\(tabId\)[\s\S]*offscreen\.maybeClose\(\)/);
assert.match(videoDownload, /CG_VIDEO_CANCEL_REQUEST/);
assert.match(videoDownload, /return \{\s*\.\.\.settings\.videoDownload,\s*supported,\s*active,/);
assert.match(videoDownload, /observation\.setCollecting\(FEATURE_IDS\.VIDEO_DOWNLOAD/);
assert.match(videoDownload, /sessionUpdates\.run/);
assert.match(videoDownload, /cleanupOrphanedMediaHeaderRules/);
assert.match(videoDownload, /videoDownloadArtifact:/);
assert.match(videoDownload, /activeVideoProcessing\.has\(processingKey\)/);
assert.match(videoDownload, /handedOffToChrome = true;[\s\S]*rememberVideoArtifact/);
assert.match(videoDownload, /downloads\.search\(\{ id: downloadId \}\)/);
assert.match(videoDownload, /inIncognitoContext[\s\S]*750001[\s\S]*749999/);
assert.match(videoDownload, /requestBilibiliJson/);
assert.match(videoDownload, /expectedSenderPageUrl/);
assert.match(videoDownload, /expandingVideoManifests\.clear\(\)/);
assert.match(videoDownload, /limitVideoCandidatesForSession/);
assert.match(videoDownload, /await stopVideoScanner\(tabId\);\s*return false;/);
assert.match(videoDownload, /world: 'MAIN'[\s\S]*cosmic-gemini\.video-download\.page-runtime/);
assert.match(imageDownload, /limitImageCandidatesForSession/);
assert.match(imageDownload, /pending\.candidates\.length < 2000/);
assert.match(imageDownload, /schedulePageScan/);
assert.match(imageDownload, /tab\.active[\s\S]*captureVisibleTab[\s\S]*visibleTab\?\.id !== tabId/);
assert.match(imageDownload, /sourceTabPromise = chrome\.tabs\.get\(tabId\)/);
assert.match(videoDownload, /pending\.candidates\.length < 800/);
assert.match(videoDownload, /sourceTab = await chrome\.tabs\.get\(tabId\)/);
assert.match(imageWorkspace, /retryRead\(\(\) => reload/);
assert.match(imageWorkspace, /preserveWorkspace: closeSidePanel/);
assert.match(imageWorkspace, /root\.dataset\.workspaceClosing = 'true'/);
assert.doesNotMatch(imageWorkspace, /await send\(\{ type: 'UI_IMAGE_STOP'[\s\S]{0,160}await reload\(/);
assert.doesNotMatch(imageDownload, /scheduleDownloadDiscoveryPause|videoDownloadSession:/);
assert.doesNotMatch(videoDownload, /scheduleDownloadDiscoveryPause|imageDownloadSession:/);
assert.doesNotMatch(imageDownload, /createVideoDownloadProduct/);
assert.doesNotMatch(videoDownload, /createImageDownloadProduct/);

const productFiles = files.filter(path => path.includes(join(extension, 'background', 'products')) && path.endsWith('.js'));
for (const path of productFiles) {
  const value = await readFile(path, 'utf8');
  assert.doesNotMatch(value, /from ['"]\.\.\/[^'"]*products\//, `${path} imports another product`);
  assert.doesNotMatch(value, /from ['"][^'"]*provinces\//, `${path} depends on a province implementation`);
  assert.doesNotMatch(value, /from ['"][^'"]*central(?:\.js)?['"]/, `${path} depends on central`);
}

const centralPage = await source('content', 'central-page.js');
assert.match(centralPage, /cosmic-gemini\.central/);
assert.match(centralPage, /CG_SYNC_CENTRAL/);
assert.match(centralPage, /syncFailures/);
assert.doesNotMatch(centralPage, /nativeScroll|noAutoplay|mailtoCapture|adMarshal|anyCopy|pageDisplay|reduceWhitePoint|greyscale|imageDownload|videoDownload|chrome\.storage/);
for (const bridge of ['clipboard-protect-bridge.js', 'native-scroll-bridge.js', 'no-autoplay-bridge.js', 'mailto-capture-bridge.js', 'ad-marshal-bridge.js', 'any-copy-bridge.js', 'any-copy-enhanced-bridge.js', 'chinese-response-claude-bridge.js']) {
  const value = await source('content', bridge);
  assert.doesNotMatch(value, /chrome\.storage/);
  assert.match(value, /CG_PAGE_STATE', featureId:/);
  assert.match(value, /configFailures/);
  assert.match(value, /const requestConfig = async \(\) => \{\s*if \(disposed\) return;/);
  assert.match(value, /sendMessage[\s\S]*if \(disposed\) return;/);
  assert.match(value, /sendResponse\(\{ disposed: true \}\)/);
  assert.match(value, /Configuration is temporarily unavailable/);
  assert.match(value, /sendRuntimeMessage[\s\S]*try \{[\s\S]*chrome\.runtime\.sendMessage[\s\S]*Promise\.reject/,
    `${bridge} must catch synchronous extension-context invalidation before returning a rejected promise`);
  assert.doesNotMatch(value, /void chrome\.runtime\.sendMessage/);
}
assert.match(centralPage, /sendRuntimeMessage[\s\S]*try \{[\s\S]*chrome\.runtime\.sendMessage[\s\S]*Promise\.reject/);
for (const name of ['page-display-bridge.js', 'xhs-image-dark-mode-bridge.js', 'video-download-scanner.js', 'image-capture.js']) {
  const value = await source('content', name);
  assert.match(value, /sendRuntimeMessage[\s\S]*try \{[\s\S]*chrome\.runtime\.sendMessage[\s\S]*Promise\.reject/);
  assert.doesNotMatch(value, /void chrome\.runtime\.sendMessage/);
}

assert.equal(await stat(join(extension, 'workspaces/image-download/image-download.html')).then(() => true), true);
assert.equal(await stat(join(extension, 'offscreen/video-download.html')).then(() => true), true);
const videoOffscreen = await source('offscreen', 'video-download.js');
const videoPageRuntime = await source('content', 'video-download-page.js');
const imageDownloadProduct = await source('background', 'products/customs/image-download.js');
const videoDownloadProduct = await source('background', 'products/customs/video-download.js');
assert.match(videoOffscreen, /new AbortController\(\)/);
assert.match(videoOffscreen, /artifactId = artifact\.name/);
assert.match(videoOffscreen, /STALE_ARTIFACT_AGE_MS/);
assert.match(videoOffscreen, /collectRetainedArtifactIds/);
assert.doesNotMatch(videoOffscreen, /setTimeout\(\(\) => void cleanupArtifact\(artifactId\)/);
assert.match(videoPageRuntime, /removeEventListener\('message', this\.onMessage\)/);
assert.match(videoPageRuntime, /XMLHttpRequest\.prototype\.open === this\.trackedXhrOpen/);
assert.match(videoPageRuntime, /delete globalThis\[RUNTIME_KEY\]/);
const imageCapture = await source('content', 'image-capture.js');
assert.match(imageCapture, /cosmic-gemini\.image-capture/);
assert.match(imageCapture, /globalThis\[CAPTURE_KEY\]\?\.dispose\?\.\(\)/);
assert.match(videoScanner, /chrome\.runtime\.onMessage\.removeListener\(this\.onMessage\)/);
assert.match(videoScanner, /globalThis\.removeEventListener\('message', this\.onWindowMessage\)/);
assert.match(videoScanner, /delete globalThis\[RUNTIME_KEY\]/);
assert.match(imageDownloadProduct, /priorCollecting[\s\S]*restoredCollecting/);
assert.match(imageDownloadProduct, /cosmic-gemini\.image-capture[\s\S]*dispose/);
assert.match(videoDownloadProduct, /priorCollecting[\s\S]*restoredCollecting/);
const popupRuntime = await source('popup', 'popup.js');
const imageWorkspaceRuntime = await source('workspaces', 'image-download/image-download.js');
assert.match(popupRuntime, /function setVideoViewVisible\(visible\) \{\s*if \(popupClosing\) return;/);
assert.match(popupRuntime, /function connectCentralUi\(\) \{\s*if \(popupClosing \|\| document\.hidden/);
assert.match(popupRuntime, /if \(reloadTimer\) clearTimeout\(reloadTimer\)/);
assert.match(imageWorkspaceRuntime, /function setWorkspaceVisible\(visible\) \{\s*if \(workspaceClosing\) return;/);
assert.match(imageWorkspaceRuntime, /sourceTabValue[\s\S]*\^\\d\+\$/);
assert.match(videoScanner, /transportCandidate\(item\)/);
assert.match(videoScanner, /event\.data\.candidates\.slice\(0, 500\)/);
assert.match(offscreenCoordinator, /videoDownloadArtifact:/);
assert.match(offscreenCoordinator, /getPlatformInfo[\s\S]*25_000[\s\S]*clearInterval/);
assert.match(await source('settings', 'all-settings.html'), /language-card[\s\S]*id="reset-settings-card"/);
assert.match(await source('settings', 'native-scroll.html'), /© 2026 Songming\.org/);
assert.match(await readFile(join(project, '.gitignore'), 'utf8'), /^dist\/$/m);

console.log(`Checked ${files.length} extension files and the central → province → product → feature boundaries.`);
