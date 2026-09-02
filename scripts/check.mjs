import assert from 'node:assert/strict';
import { readdir, readFile, stat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const extension = join(project, 'extension');

async function filesBelow(directory) {
  const result = [];
  for (const name of await readdir(directory)) {
    const path = join(directory, name);
    if ((await stat(path)).isDirectory()) result.push(...await filesBelow(path));
    else result.push(path);
  }
  return result;
}

const files = await filesBelow(extension);
const source = async (...parts) => readFile(join(extension, ...parts), 'utf8');

for (const path of files.filter(path => path.endsWith('.js'))) {
  const check = spawnSync(process.execPath, ['--check', path], { encoding: 'utf8' });
  assert.equal(check.status, 0, path + '\n' + check.stderr);
}

const manifest = JSON.parse(await source('manifest.json'));
assert.equal(manifest.manifest_version, 3);
assert.equal(manifest.name, 'Cosmic Gemini');
assert.equal(manifest.version, '6.5.5');
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
    'assets/ad-marshal-transparent.svg'
  ],
  matches: [
    'http://news.qq.com/*',
    'https://news.qq.com/*',
    'http://www.qq.com/*',
    'https://www.qq.com/*',
    'http://douyin.com/*',
    'https://douyin.com/*',
    'http://www.douyin.com/*',
    'https://www.douyin.com/*'
  ]
}]);

const extensionRootEntries = await readdir(extension, { withFileTypes: true });
assert.deepEqual(extensionRootEntries.filter(entry => entry.isFile()).map(entry => entry.name).sort(), ['manifest.json']);

for (const size of [16, 32, 48, 128]) {
  assert.equal(manifest.icons[String(size)], `icons/icon-${size}.png`);
  assert.equal(manifest.action.default_icon[String(size)], `icons/icon-${size}.png`);
  for (const name of [`icon-${size}.png`, `icon-suppressing-${size}.png`]) {
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

for (const cssPath of files.filter(path => path.endsWith('.css'))) {
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
  join(extension, 'content/ad-marshal-runtime.js'),
  join(extension, 'content/video-download-page.js'),
  join(extension, 'core/site-video.js'),
  join(extension, 'offscreen/video-download.js')
].sort());
assert.doesNotMatch(firstPartyJoined, /recent activity|最近活动/i);
assert.doesNotMatch(firstPartyJoined, /sound autoplay/i);
assert.doesNotMatch(firstPartyJoined, /navigator\.mediaSession|setActionHandler\s*\(|MediaPlayPause|nativeMessaging|osascript|AppleScript/i);

const settingsPages = ['native-scroll.html', 'no-autoplay.html', 'any-copy.html', 'image-download.html', 'video-download.html', 'satellites.html', 'all-settings.html'];
for (const name of settingsPages) {
  const html = await source('settings', name);
  assert.match(html, /<script src="\.\.\/shared\/localization-data\.js"><\/script>/);
  assert.match(html, /<script src="preload\.js"><\/script>\s*<script type="module" src="page\.js"><\/script>/);
  assert.match(html, /data-feature-link="imageDownload"/);
  assert.match(html, /data-feature-link="satellites"/);
  assert.match(html, /data-feature-link="allSettings"/);
}
for (const [name, featureId] of Object.entries({
  'native-scroll.html': 'nativeScroll',
  'no-autoplay.html': 'noAutoplay',
  'any-copy.html': 'anyCopy',
  'image-download.html': 'imageDownload',
  'video-download.html': 'videoDownload',
  'satellites.html': 'satellites',
  'all-settings.html': 'allSettings'
})) {
  assert.match(await source('settings', name), new RegExp('class="intro-title"[\\s\\S]*?data-section-icon="' + featureId + '"'));
}

const popupHtml = await source('popup', 'index.html');
const popupSource = await source('popup', 'popup.js');
assert.match(popupHtml, /id="nativeScroll-status"[\s\S]*id="nativeScroll-enhanced"[\s\S]*id="noAutoplay-status"[\s\S]*id="noAutoplay-enhanced"[\s\S]*id="anyCopy-status"[\s\S]*id="anyCopyEnhanced-status"[\s\S]*id="imageDownload-status"[\s\S]*id="videoDownload-status"[\s\S]*id="all-settings"/);
assert.equal([...popupHtml.matchAll(/class="feature-row/g)].length, 4);
assert.match(popupSource, /type: 'UI_GET_ACTIVE_PAGE_STATE'/);
assert.match(popupSource, /type: 'UI_TOGGLE_PAGE_FEATURE'/);
assert.match(popupSource, /type: 'UI_TOGGLE_PAGE_ENHANCED'/);
assert.match(popupSource, /type: 'UI_TOGGLE_SITE_FEATURE'/);
assert.match(popupSource, /type: 'UI_TOGGLE_TAB_FEATURE'/);
assert.match(popupSource, /type: 'UI_OPEN_ALL_SETTINGS'/);
assert.match(popupSource, /retryRead\(\(\) => reload/);
assert.doesNotMatch(popupSource, /if \(reloadAfter\) await reload\(/);
assert.doesNotMatch(popupSource, /chrome\.storage|chrome\.tabs\./);
assert.doesNotMatch(popupSource, /showView\(state\.videoDownload\?\.active/);
assert.match(popupSource, /scanState === 'paused' \? 'off' : 'active'/);
assert.match(popupSource, /dataset\.persistent = String\(scanState === 'active'\)/);

const settingsSource = await source('settings', 'page.js');
const settingsPreload = await source('settings', 'preload.js');
const satellitesSettings = await source('settings', 'satellites.html');
assert.match(settingsSource, /UI_SET_BEHAVIOR_RULE/);
assert.match(settingsSource, /UI_ADD_NSNA_WHITELIST_RULE/);
assert.match(settingsSource, /UI_SET_AUDIO_AUTOPLAY_ALL_SITES/);
assert.match(settingsSource, /UI_RESET_ALL_SETTINGS/);
assert.match(settingsSource, /retryRead\(\(\) => reload/);
assert.doesNotMatch(settingsSource, /chrome\.storage|chrome\.tabs\./);
assert.match(settingsPreload, /inIncognitoContext[\s\S]*disabledByDefaultInIncognito/);
assert.match(satellitesSettings, /class="incognito-status"[\s\S]*data-i18n="disabledInIncognito"/);
assert.match(satellitesSettings, /id="adMarshalNewsQqCom"[\s\S]*id="adMarshalDouyinCom"/);
for (const name of ['native-scroll.html', 'no-autoplay.html']) {
  const html = await source('settings', name);
  assert.equal([...html.matchAll(/data-behavior-card/g)].length, 1);
  assert.equal([...html.matchAll(/data-behavior-list=/g)].length, 3);
  assert.match(html, /data-behavior-list="inactiveRules"[\s\S]*data-behavior-list="standardRules"[\s\S]*data-behavior-list="enhancedRules"/);
  assert.match(html, /data-feature-id="nsna" data-list-section="whitelistRules"/);
}

const central = await source('background', 'central.js');
const config = await source('core', 'config.js');
const messageSource = await source('background', 'message-source.js');
const platform = await source('background', 'platform.js');
const provinceInterface = await source('background', 'provinces', 'interface.js');
const standing = await source('background', 'provinces', 'standing.js');
const operations = await source('background', 'provinces', 'operations.js');
const customs = await source('background', 'provinces', 'customs.js');
const customsObservation = await source('background', 'provinces', 'customs-observation.js');
const offscreenCoordinator = await source('background', 'provinces', 'customs-offscreen.js');
const runtimeHost = await source('background', 'features', 'page-runtime-host.js');
const nativeScroll = await source('background', 'products', 'standing', 'native-scroll.js');
const nativeScrollRuntime = await source('content', 'runtime.js');
const noAutoplay = await source('background', 'products', 'standing', 'no-autoplay.js');
const adMarshal = await source('background', 'products', 'standing', 'ad-marshal.js');
const adMarshalRuntime = await source('content', 'ad-marshal-runtime.js');
const anyCopy = await source('background', 'products', 'operations', 'any-copy.js');
const anyCopyEnhanced = await source('background', 'products', 'operations', 'any-copy-enhanced.js');
const satellites = await source('background', 'products', 'operations', 'satellites.js');
const administration = await source('background', 'products', 'operations', 'administration.js');
const imageDownload = await source('background', 'products', 'customs', 'image-download.js');
const videoDownload = await source('background', 'products', 'customs', 'video-download.js');
const videoScanner = await source('content', 'video-download-scanner.js');
const imageWorkspace = await source('workspaces', 'image-download', 'image-download.js');

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
assert.match(central, /setCustomsResponseIngressEnabled/);
assert.match(central, /validateMessageSource\(message, sender/);
assert.match(central, /validatePortSource\(port/);
assert.match(central, /documentId/);
assert.match(central, /Promise\.allSettled\(STATE_PRODUCTS/);
assert.match(central, /Promise\.allSettled\(PAGE_PRODUCTS/);
assert.match(central, /results\.some\(result => result\.status === 'rejected'\)/);
assert.match(central, /unavailableProductState/);
assert.match(central, /onHeadersReceived\.removeListener\(handleCustomsHeadersReceived\)/);
assert.match(central, /windowCreated[\s\S]*handleWindowCreated[\s\S]*chrome\.windows\.onCreated/);
assert.doesNotMatch(central, /chrome\.storage\.(?!onChanged\.addListener)|chrome\.scripting\.executeScript|chrome\.tabs\.(?:query|create|update)|chrome\.downloads\.download\s*\(|chrome\.sidePanel|chrome\.offscreen|chrome\.declarativeNetRequest|fetch\s*\(/,
  'Central may decide and route, but must not execute product work.');

for (const method of ['initialize', 'getProductState', 'syncProduct', 'handleMessage', 'handleConnect', 'handleTabUpdated', 'handleTabRemoved', 'handleWindowCreated', 'handleWindowRemoved', 'handleDownloadChanged', 'handleDeterminingFilename', 'handleHeadersReceived', 'handleAlarm', 'handleStorageChanged', 'reset']) {
  assert.match(provinceInterface, new RegExp(method));
}
for (const [id, province] of [['standing', standing], ['operations', operations], ['customs', customs]]) {
  assert.match(province, /defineProvince\(/);
  assert.match(province, new RegExp(`id: '${id}'`));
  assert.match(province, /products/);
}
assert.match(standing, /createNativeScrollProduct[\s\S]*createNoAutoplayProduct[\s\S]*createAdMarshalProduct|createAdMarshalProduct[\s\S]*createNativeScrollProduct[\s\S]*createNoAutoplayProduct/);
assert.match(operations, /createAnyCopyProduct[\s\S]*createAnyCopyEnhancedProduct[\s\S]*createSatellitesProduct[\s\S]*createAdministrationProduct/);
assert.match(customs, /createImageDownloadProduct[\s\S]*createVideoDownloadProduct[\s\S]*createCustomsOffscreenCoordinator/);
assert.match(customs, /createCustomsObservationRegistry/);
assert.match(customs, /imageDownload\.initialize\(\)[\s\S]*videoDownload\.initialize\(\)/);
assert.match(customsObservation, /collecting\.size > 0/);
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
assert.match(nativeScrollRuntime, /RETAINED_LISTENERS_KEY[\s\S]*retainListenerRegistry/);
assert.match(noAutoplay, /content\/no-autoplay-bridge\.js[\s\S]*content\/no-autoplay-runtime\.js/);
assert.match(adMarshal, /getSessionRules[\s\S]*updateSessionRules/);
assert.match(adMarshal, /tabIds[\s\S]*universal-report\.min\.js[\s\S]*\/qqindex2021\/advertisement\//);
assert.match(adMarshal, /douyinCom[\s\S]*collect\/[\s\S]*slardar\/fe\/sdk-web\/browser\.cn\.js/);
assert.match(adMarshal, /DOUYIN_TELEMETRY_DOMAINS[\s\S]*mon\.zijieapi\.com[\s\S]*mcs\.zijieapi\.com/);
assert.match(adMarshal, /ad-marshal-empty\.js[\s\S]*ad-marshal-empty\.json[\s\S]*ad-marshal-empty\.html[\s\S]*ad-marshal-transparent\.svg/);
assert.match(adMarshal, /news\.ssp\.qq\.com[\s\S]*op\.ssp\.qq\.com[\s\S]*127\.0\.0\.1:11601\/check/);
assert.match(adMarshal, /activeTabs\.get\(tabId\) === nextSiteId[\s\S]*Promise\.resolve/,
  'Ad Marshal must avoid native rule reads on unrelated or already synchronized tabs.');
assert.match(adMarshalRuntime, /globalThis\.fetch = this\.fetchWrapper[\s\S]*XMLHttpRequest\.prototype\.open = this\.xhrOpenWrapper[\s\S]*Navigator\.prototype\.sendBeacon = this\.sendBeaconWrapper/);
assert.match(adMarshalRuntime, /TRANSPARENT_IMAGE_URL[\s\S]*HTMLImageElement\.prototype/);
assert.match(adMarshalRuntime, /127\.0\.0\.1[\s\S]*adMarshalImageSrcSet/);
assert.match(adMarshalRuntime, /tonglan-ad-channel\.ad-news[\s\S]*rectangle-ad-channel\.ad-news[\s\S]*NEWS_QQ_AD_CONTAINER_SELECTOR[\s\S]*this\.ensureStyle\(\)/);
assert.match(adMarshalRuntime, /douyinCom[\s\S]*mon\.zijieapi\.com[\s\S]*mcs\.zijieapi\.com[\s\S]*collect\/[\s\S]*browser\.cn\.js/);
assert.doesNotMatch(adMarshalRuntime, /MutationObserver|data-beacon|removeChild/,
  'Ad Marshal must not remove framework-owned DOM nodes or alter Beacon metadata.');
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
assert.match(platform, /chrome\.storage[\s\S]*refreshOpenPages[\s\S]*renderToolbar/);
assert.match(platform, /refreshTabPage[\s\S]*\[0, 80, 240\]/);
assert.match(platform, /createKeyedTaskQueue/);
assert.match(platform, /activityQueue\.run/);
assert.match(platform, /queueWrite/);
assert.match(platform, /resettingStorage/);
assert.match(platform, /clearOrphanedActivity/);
assert.match(platform, /RETAINED_DOWNLOAD_PREFIXES/);
assert.match(config, /DEFAULT_INCOGNITO_SETTINGS[\s\S]*nativeScroll:[\s\S]*enabled: false[\s\S]*noAutoplay:[\s\S]*enabled: false/);
assert.match(platform, /INCOGNITO_SETTINGS_KEY[\s\S]*chrome\.storage\.session[\s\S]*INCOGNITO_WINDOWS_KEY/);
assert.match(platform, /handleIncognitoWindowChange/);
assert.match(platform, /refreshToolbarTitles[\s\S]*readActivity\(tab\.id\)[\s\S]*renderToolbar[\s\S]*setLocale/);
assert.match(satellites, /inIncognitoContext[\s\S]*ownsDailySchedule/);
assert.match(satellites, /available: false/);
assert.match(settingsSource, /disabledByDefaultInIncognito/);
assert.match(settingsSource, /helpPanel\.hidden = false/);
assert.doesNotMatch(settingsSource, /helpPanel\.hidden = incognitoContext/);

assert.match(imageDownload, /chrome\.sidePanel\.setOptions/);
assert.match(imageDownload, /workspaces\/image-download\/image-download\.html/);
assert.match(imageDownload, /UI_IMAGE_DOWNLOAD/);
assert.match(imageDownload, /observation\.setCollecting\(FEATURE_IDS\.IMAGE_DOWNLOAD/);
assert.match(imageDownload, /sessionUpdates\.run/);
assert.match(imageDownload, /imageDownloadArtifact:/);
assert.match(imageDownload, /trackImageArtifact/);
assert.match(imageDownload, /downloads\.search\(\{ id: downloadId \}\)/);
assert.match(imageDownload, /preparedImageSidePanels\.delete\(tabId\)[\s\S]*offscreen\.maybeClose\(\)/);
assert.match(videoDownload, /CG_VIDEO_CANCEL_REQUEST/);
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
assert.doesNotMatch(centralPage, /nativeScroll|noAutoplay|adMarshal|anyCopy|imageDownload|videoDownload|chrome\.storage/);
for (const bridge of ['native-scroll-bridge.js', 'no-autoplay-bridge.js', 'ad-marshal-bridge.js', 'any-copy-bridge.js', 'any-copy-enhanced-bridge.js']) {
  const value = await source('content', bridge);
  assert.doesNotMatch(value, /chrome\.storage/);
  assert.match(value, /CG_PAGE_STATE', featureId:/);
  assert.match(value, /configFailures/);
  assert.match(value, /const requestConfig = async \(\) => \{\s*if \(disposed\) return;/);
  assert.match(value, /sendMessage[\s\S]*if \(disposed\) return;/);
  assert.match(value, /sendResponse\(\{ disposed: true \}\)/);
  assert.match(value, /Configuration is temporarily unavailable/);
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
