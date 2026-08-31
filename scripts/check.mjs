import assert from 'node:assert/strict';
import { readdir, readFile, stat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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
assert.equal(manifest.version, '5.2.1');
assert.equal(manifest.description, 'A personal toolkit for the web.');
assert.deepEqual(manifest.permissions.sort(), [
  'activeTab', 'alarms', 'declarativeNetRequestWithHostAccess', 'downloads', 'offscreen', 'scripting', 'sidePanel', 'storage', 'unlimitedStorage', 'webRequest'
]);
assert.deepEqual(manifest.host_permissions.sort(), ['http://*/*', 'https://*/*']);
assert.equal(manifest.background.service_worker, 'background/central.js');
assert.equal(manifest.action.default_popup, 'popup/index.html');
assert.equal(manifest.options_page, 'settings/native-scroll.html');
assert.equal(manifest.content_scripts.length, 1);
assert.deepEqual(manifest.content_scripts[0].js, ['content/central-page.js']);
assert.equal(manifest.content_scripts[0].world, 'ISOLATED');
assert.equal(manifest.content_scripts[0].run_at, 'document_start');
assert.equal(manifest.content_scripts[0].all_frames, true);

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
const firstPartyJoined = sourceEntries.filter(([path]) => !path.includes(join(extension, 'vendor')))
  .map(([, value]) => value).join('\n');
const networkFiles = sourceEntries.filter(([path, value]) => !path.includes(join(extension, 'vendor'))
  && /fetch\s*\(|XMLHttpRequest|WebSocket\s*\(/.test(value));
assert.deepEqual(networkFiles.map(([path]) => path).sort(), [
  join(extension, 'background/products/customs/video-download.js'),
  join(extension, 'background/products/operations/satellites.js'),
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
assert.doesNotMatch(popupSource, /chrome\.storage|chrome\.tabs\./);
assert.doesNotMatch(popupSource, /showView\(state\.videoDownload\?\.active/);

const settingsSource = await source('settings', 'page.js');
assert.match(settingsSource, /UI_SET_BEHAVIOR_RULE/);
assert.match(settingsSource, /UI_ADD_NSNA_WHITELIST_RULE/);
assert.match(settingsSource, /UI_SET_AUDIO_AUTOPLAY_ALL_SITES/);
assert.match(settingsSource, /UI_RESET_ALL_SETTINGS/);
assert.doesNotMatch(settingsSource, /chrome\.storage|chrome\.tabs\./);
for (const name of ['native-scroll.html', 'no-autoplay.html']) {
  const html = await source('settings', name);
  assert.equal([...html.matchAll(/data-behavior-card/g)].length, 1);
  assert.equal([...html.matchAll(/data-behavior-list=/g)].length, 3);
  assert.match(html, /data-behavior-list="inactiveRules"[\s\S]*data-behavior-list="standardRules"[\s\S]*data-behavior-list="enhancedRules"/);
  assert.match(html, /data-feature-id="nsna" data-list-section="whitelistRules"/);
}

const central = await source('background', 'central.js');
const platform = await source('background', 'platform.js');
const provinceInterface = await source('background', 'provinces', 'interface.js');
const standing = await source('background', 'provinces', 'standing.js');
const operations = await source('background', 'provinces', 'operations.js');
const customs = await source('background', 'provinces', 'customs.js');
const customsObservation = await source('background', 'provinces', 'customs-observation.js');
const offscreenCoordinator = await source('background', 'provinces', 'customs-offscreen.js');
const runtimeHost = await source('background', 'features', 'page-runtime-host.js');
const nativeScroll = await source('background', 'products', 'standing', 'native-scroll.js');
const noAutoplay = await source('background', 'products', 'standing', 'no-autoplay.js');
const anyCopy = await source('background', 'products', 'operations', 'any-copy.js');
const anyCopyEnhanced = await source('background', 'products', 'operations', 'any-copy-enhanced.js');
const satellites = await source('background', 'products', 'operations', 'satellites.js');
const administration = await source('background', 'products', 'operations', 'administration.js');
const imageDownload = await source('background', 'products', 'customs', 'image-download.js');
const videoDownload = await source('background', 'products', 'customs', 'video-download.js');

assert.ok(central.split('\n').length < 260, 'Central must remain a compact decision and routing layer.');
assert.match(central, /PROVINCE_PRODUCTS[\s\S]*standing:[\s\S]*operations:[\s\S]*customs:/);
assert.match(central, /createStandingProvince[\s\S]*createOperationsProvince[\s\S]*createCustomsProvince/);
assert.match(central, /provinceForProduct/);
assert.match(central, /productForMessage/);
assert.match(central, /setCustomsResponseIngressEnabled/);
assert.match(central, /onHeadersReceived\.removeListener\(handleCustomsHeadersReceived\)/);
assert.doesNotMatch(central, /chrome\.storage|chrome\.scripting\.executeScript|chrome\.tabs\.(?:query|create|update)|chrome\.downloads\.download\s*\(|chrome\.sidePanel|chrome\.offscreen|chrome\.declarativeNetRequest|fetch\s*\(/,
  'Central may decide and route, but must not execute product work.');

for (const method of ['initialize', 'getProductState', 'syncProduct', 'handleMessage', 'handleConnect', 'handleTabUpdated', 'handleTabRemoved', 'handleDownloadChanged', 'handleDeterminingFilename', 'handleHeadersReceived', 'handleAlarm', 'reset']) {
  assert.match(provinceInterface, new RegExp(method));
}
for (const [id, province] of [['standing', standing], ['operations', operations], ['customs', customs]]) {
  assert.match(province, /defineProvince\(/);
  assert.match(province, new RegExp(`id: '${id}'`));
  assert.match(province, /products/);
}
assert.match(standing, /createNativeScrollProduct[\s\S]*createNoAutoplayProduct/);
assert.match(operations, /createAnyCopyProduct[\s\S]*createAnyCopyEnhancedProduct[\s\S]*createSatellitesProduct[\s\S]*createAdministrationProduct/);
assert.match(customs, /createImageDownloadProduct[\s\S]*createVideoDownloadProduct[\s\S]*createCustomsOffscreenCoordinator/);
assert.match(customs, /createCustomsObservationRegistry/);
assert.match(customs, /imageDownload\.initialize\(\)[\s\S]*videoDownload\.initialize\(\)/);
assert.match(customsObservation, /collecting\.size > 0/);
assert.match(customsObservation, /restorationReliable/);
assert.match(customsObservation, /needsRestoration/);
assert.match(offscreenCoordinator, /activeAssemblies[\s\S]*sendVideo[\s\S]*sendImage[\s\S]*maybeClose/);

assert.match(runtimeHost, /chrome\.scripting\.executeScript/);
assert.match(runtimeHost, /CG_STOP_CENTRAL_FEATURE/);
assert.match(nativeScroll, /content\/native-scroll-bridge\.js[\s\S]*content\/runtime\.js/);
assert.match(noAutoplay, /content\/no-autoplay-bridge\.js[\s\S]*content\/no-autoplay-runtime\.js/);
assert.match(anyCopy, /content\/any-copy-bridge\.js[\s\S]*content\/any-copy-runtime\.js/);
assert.match(anyCopyEnhanced, /content\/any-copy-enhanced-bridge\.js[\s\S]*content\/any-copy-enhanced-runtime\.js/);
assert.match(anyCopyEnhanced, /anyCopyEnhancedTab:/);
assert.match(satellites, /https:\/\/api\.bilibili\.com\/x\/web-interface\/nav/);
assert.match(satellites, /https:\/\/api\.bilibili\.com\/x\/member\/web\/exp\/reward/);
assert.match(administration, /UI_GET_ACTIVE_PAGE_STATE[\s\S]*UI_OPEN_ALL_SETTINGS[\s\S]*UI_RESET_ALL_SETTINGS/);
assert.match(platform, /chrome\.storage[\s\S]*refreshOpenPages[\s\S]*renderToolbar/);

assert.match(imageDownload, /chrome\.sidePanel\.setOptions/);
assert.match(imageDownload, /workspaces\/image-download\/image-download\.html/);
assert.match(imageDownload, /UI_IMAGE_DOWNLOAD/);
assert.match(imageDownload, /observation\.setCollecting\(FEATURE_IDS\.IMAGE_DOWNLOAD/);
assert.match(videoDownload, /CG_VIDEO_CANCEL_REQUEST/);
assert.match(videoDownload, /observation\.setCollecting\(FEATURE_IDS\.VIDEO_DOWNLOAD/);
assert.match(videoDownload, /activeVideoProcessing\.has\(processingKey\)/);
assert.match(videoDownload, /requestBilibiliJson/);
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
assert.doesNotMatch(centralPage, /nativeScroll|noAutoplay|anyCopy|imageDownload|videoDownload|chrome\.storage/);
for (const bridge of ['native-scroll-bridge.js', 'no-autoplay-bridge.js', 'any-copy-bridge.js', 'any-copy-enhanced-bridge.js']) {
  const value = await source('content', bridge);
  assert.doesNotMatch(value, /chrome\.storage/);
  assert.match(value, /CG_PAGE_STATE', featureId:/);
}

assert.equal(await stat(join(extension, 'workspaces/image-download/image-download.html')).then(() => true), true);
assert.equal(await stat(join(extension, 'offscreen/video-download.html')).then(() => true), true);
assert.match(await source('offscreen', 'video-download.js'), /new AbortController\(\)/);
assert.match(await source('settings', 'all-settings.html'), /language-card[\s\S]*id="reset-settings-card"/);
assert.match(await source('settings', 'native-scroll.html'), /© 2026 Songming\.org/);
assert.match(await readFile(join(project, '.gitignore'), 'utf8'), /^dist\/$/m);

console.log(`Checked ${files.length} extension files and the central → province → product → feature boundaries.`);
