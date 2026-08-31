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
for (const path of files.filter(path => path.endsWith('.js'))) {
  const check = spawnSync(process.execPath, ['--check', path], { encoding: 'utf8' });
  assert.equal(check.status, 0, path + '\n' + check.stderr);
}

const manifest = JSON.parse(await readFile(join(extension, 'manifest.json'), 'utf8'));
assert.equal(manifest.manifest_version, 3);
assert.equal(manifest.name, 'Cosmic Gemini');
assert.equal(manifest.version, '3.5.1');
assert.equal(manifest.description, 'A personal toolkit for the web.');
assert.deepEqual(manifest.permissions.sort(), [
  'activeTab', 'alarms', 'declarativeNetRequestWithHostAccess', 'downloads', 'offscreen', 'scripting', 'sidePanel', 'storage', 'unlimitedStorage', 'webRequest'
]);
assert.deepEqual(manifest.host_permissions.sort(), ['http://*/*', 'https://*/*']);
assert.equal(manifest.background.service_worker, 'background/central.js');
assert.equal(manifest.action.default_popup, 'popup/index.html');
assert.equal(manifest.options_page, 'settings/native-scroll.html');
assert.deepEqual(manifest.content_scripts[0].js, ['content/central-page.js']);
assert.equal(manifest.content_scripts[0].world, 'ISOLATED');
assert.equal(manifest.content_scripts[0].run_at, 'document_start');
assert.equal(manifest.content_scripts[0].all_frames, true);
assert.equal(manifest.content_scripts.length, 1);
for (const runtime of ['runtime.js', 'no-autoplay-runtime.js', 'any-copy-runtime.js', 'any-copy-enhanced-runtime.js']) {
  assert.equal(manifest.content_scripts.flatMap(entry => entry.js).some(path => path.endsWith(runtime)), false);
}

const extensionRootEntries = await readdir(extension, { withFileTypes: true });
assert.deepEqual(extensionRootEntries.filter(entry => entry.isFile()).map(entry => entry.name).sort(), ['manifest.json']);

for (const size of [16, 32, 48, 128]) {
  assert.equal(manifest.icons[String(size)], 'icons/icon-' + size + '.png');
  assert.equal(manifest.action.default_icon[String(size)], 'icons/icon-' + size + '.png');
  for (const name of ['icon-' + size + '.png', 'icon-suppressing-' + size + '.png']) {
    const png = await readFile(join(extension, 'icons', name));
    assert.equal(png.toString('hex', 0, 8), '89504e470d0a1a0a', name + ' is not a PNG');
    assert.equal(png.readUInt32BE(16), size, name + ' has the wrong width');
    assert.equal(png.readUInt32BE(20), size, name + ' has the wrong height');
  }
}

for (const htmlPath of files.filter(path => path.endsWith('.html'))) {
  const html = await readFile(htmlPath, 'utf8');
  assert.doesNotMatch(html, /<(?:script|link)[^>]+(?:src|href)=["']https?:/i, htmlPath + ' loads remote code');
  for (const match of html.matchAll(/(?:src|href)=["']([^"']+)["']/g)) {
    const reference = match[1];
    if (/^(?:#|https?:|data:)/.test(reference)) continue;
    await stat(resolve(dirname(htmlPath), reference));
  }
}

for (const jsPath of files.filter(path => path.endsWith('.js') && !path.includes(join(extension, 'vendor')))) {
  const source = await readFile(jsPath, 'utf8');
  for (const match of source.matchAll(/(?:from\s+|import\s*)["'](\.\.?\/[^"']+)["']/g)) {
    await stat(resolve(dirname(jsPath), match[1]));
  }
}

for (const path of files.filter(path => path.endsWith('.css'))) {
  assert.doesNotMatch(await readFile(path, 'utf8'), /letter-spacing\s*:\s*-/i, path + ' uses negative letter spacing');
}

const sourceFiles = files.filter(path => /\.(?:js|html|css)$/.test(path));
const sourceEntries = await Promise.all(sourceFiles.map(async path => [path, await readFile(path, 'utf8')]));
const joined = sourceEntries.map(([, source]) => source).join('\n');
const firstPartyJoined = sourceEntries
  .filter(([path]) => !path.includes(join(extension, 'vendor')))
  .map(([, source]) => source)
  .join('\n');
const centralPath = join(extension, 'background', 'central.js');
const centralOnlyBrowserApis = /chrome\.(?:storage\.|tabs\.|windows\.|scripting\.|alarms\.|downloads\.|sidePanel\.|declarativeNetRequest\.|webRequest\.)/;
for (const [path, source] of sourceEntries.filter(([path]) => path.endsWith('.js') && path !== centralPath && !path.includes(join(extension, 'vendor')))) {
  assert.doesNotMatch(source, centralOnlyBrowserApis, path + ' bypasses the central controller');
}
const networkFiles = sourceEntries.filter(([path, source]) => !path.includes(join(extension, 'vendor'))
  && /fetch\s*\(|XMLHttpRequest|WebSocket\s*\(/.test(source));
assert.deepEqual(networkFiles.map(([path]) => path).sort(), [
  join(extension, 'background', 'central.js'),
  join(extension, 'content', 'video-download-page.js'),
  join(extension, 'core', 'site-video.js'),
  join(extension, 'offscreen', 'video-download.js')
].sort());
const centralNetworkSource = networkFiles.find(([path]) => path === join(extension, 'background', 'central.js'))?.[1] || '';
assert.match(centralNetworkSource, /https:\/\/api\.bilibili\.com\/x\/web-interface\/nav/);
assert.match(await readFile(join(extension, 'core', 'bilibili-video.js'), 'utf8'), /https:\/\/api\.bilibili\.com\/x\/web-interface\/view/);
assert.match(centralNetworkSource, /https:\/\/api\.bilibili\.com\/x\/member\/web\/exp\/reward/);
assert.doesNotMatch(joined, /recent activity|最近活动/i, 'Extension exposes an activity log');
assert.equal(await stat(join(extension, 'settings', 'native-scroll.html')).then(() => true), true);
assert.equal(await stat(join(extension, 'settings', 'no-autoplay.html')).then(() => true), true);
assert.equal(await stat(join(extension, 'settings', 'any-copy.html')).then(() => true), true);
assert.equal(await stat(join(extension, 'settings', 'image-download.html')).then(() => true), true);
assert.equal(await stat(join(extension, 'settings', 'satellites.html')).then(() => true), true);
assert.equal(await stat(join(extension, 'settings', 'video-download.html')).then(() => true), true);
assert.equal(await stat(join(extension, 'settings', 'all-settings.html')).then(() => true), true);
for (const name of ['native-scroll.html', 'no-autoplay.html', 'any-copy.html', 'image-download.html', 'video-download.html', 'satellites.html', 'all-settings.html']) {
  const html = await readFile(join(extension, 'settings', name), 'utf8');
  assert.match(html, /<script src="\.\.\/shared\/localization-data\.js"><\/script>/);
  assert.match(html, /<script src="preload\.js"><\/script>\s*<script type="module" src="page\.js"><\/script>/);
}
for (const name of ['native-scroll.html', 'no-autoplay.html', 'any-copy.html', 'image-download.html', 'video-download.html', 'satellites.html', 'all-settings.html']) {
  const html = await readFile(join(extension, 'settings', name), 'utf8');
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
  const html = await readFile(join(extension, 'settings', name), 'utf8');
  assert.match(html, new RegExp('<section class="card(?: default-card)?">[\\s\\S]*?class="intro-title"[\\s\\S]*?data-section-icon="' + featureId + '"'));
}
assert.equal([...((await readFile(join(extension, 'settings', 'any-copy.html'), 'utf8')).matchAll(/data-section-icon="anyCopy"/g))].length, 1);
const popupSource = await readFile(join(extension, 'popup', 'popup.js'), 'utf8');
const imageWorkspaceSource = await readFile(join(extension, 'workspaces', 'image-download', 'image-download.js'), 'utf8');
const settingsSource = await readFile(join(extension, 'settings', 'page.js'), 'utf8');
const bridgeSource = [
  await readFile(join(extension, 'content', 'native-scroll-bridge.js'), 'utf8'),
  await readFile(join(extension, 'content', 'no-autoplay-bridge.js'), 'utf8')
].join('\n');
const centralPageSource = await readFile(join(extension, 'content', 'central-page.js'), 'utf8');
const centralSource = await readFile(join(extension, 'background', 'central.js'), 'utf8');
const popupHtml = await readFile(join(extension, 'popup', 'index.html'), 'utf8');
assert.match(popupHtml, /id="nativeScroll-status"[\s\S]*id="nativeScroll-enhanced"[\s\S]*id="noAutoplay-status"[\s\S]*id="noAutoplay-enhanced"[\s\S]*id="anyCopy-status"[\s\S]*id="anyCopyEnhanced-status"[\s\S]*id="imageDownload-status"[\s\S]*id="videoDownload-status"[\s\S]*id="all-settings"/);
assert.equal([...popupHtml.matchAll(/class="feature-row/g)].length, 4, 'Popup must contain four paired feature rows');
assert.match(popupHtml, /class="identity" hidden/);
assert.match(popupHtml, /class="popup-footer"[\s\S]*id="all-settings"/);
assert.match(popupHtml, /class="feature-status feature-toggle primary-product" id="anyCopyEnhanced-status"/);
assert.match(popupSource, /type: 'UI_TOGGLE_PAGE_FEATURE'/);
assert.match(popupSource, /type: 'UI_TOGGLE_PAGE_ENHANCED'/);
assert.match(popupSource, /dataset\.intervened = String\(intervened && !enhancedActive\)/);
assert.match(popupSource, /dataset\.intervened = String\(intervened && enhancedActive\)/);
assert.match(popupSource, /central-ui:popup[\s\S]*central-state-changed/);
assert.doesNotMatch(popupSource, /chrome\.storage/);
assert.match(popupSource, /type: 'UI_TOGGLE_SITE_FEATURE'/);
assert.match(popupSource, /type: 'UI_TOGGLE_TAB_FEATURE'/);
assert.match(popupSource, /listName: 'siteRules'/);
assert.match(popupSource, /type: 'UI_OPEN_ALL_SETTINGS'/);
assert.match(popupSource, /type: 'UI_GET_ACTIVE_PAGE_STATE'/);
assert.doesNotMatch(popupSource, /chrome\.tabs\./);
assert.match(popupSource, /if \(selectInitialView && viewMode === null\) showView\('main'\)/);
assert.doesNotMatch(popupSource, /showView\(state\.videoDownload\?\.active/);
assert.doesNotMatch(popupSource, /type: 'UI_OPEN_SETTINGS'/);
assert.match(popupSource, /let actionPending = false/);
const popupCss = await readFile(join(extension, 'popup', 'popup.css'), 'utf8');
const sharedUiCss = await readFile(join(extension, 'shared', 'ui.css'), 'utf8');
const imageWorkspaceHtml = await readFile(join(extension, 'workspaces', 'image-download', 'image-download.html'), 'utf8');
assert.match(popupCss, /feature-status\[data-state="active"\]\[data-persistent="true"\]/);
assert.match(sharedUiCss, /prefers-color-scheme: dark[\s\S]*--blue: #98beff/);
assert.match(sharedUiCss, /--on-blue: #172033/);
assert.match(popupCss, /feature-status\[data-intervened="true"\][^\n]*var\(--blue\)/);
assert.match(popupCss, /feature-status svg \{ width: 21px; height: 21px; \}[\s\S]*launcher-actions \.feature-status svg \{ width: 28px; height: 28px; \}/);
assert.match(popupCss, /launcher-actions \.feature-status \{ width: 42px; height: 42px; flex: 0 0 42px; \}/);
assert.match(popupCss, /popup-footer \.feature-status \{ width: 40px; height: 40px; \}/);
assert.match(popupCss, /popup-footer \.feature-status svg \{ width: 26px; height: 26px; \}/);
assert.match(popupCss, /feature-status\.secondary-product/);
assert.doesNotMatch(imageWorkspaceHtml, /source-title/);
assert.match(imageWorkspaceHtml, /<details class="filter-card" id="image-filters">[\s\S]*id="search"[\s\S]*id="clear-filters"[\s\S]*<\/details>/);
assert.doesNotMatch(imageWorkspaceHtml, /<details class="filter-card" id="image-filters" open>/);
assert.match(imageWorkspaceSource, /function updateFilterSummary\(\)/);
assert.match(imageWorkspaceSource, /querySelector\('#search'\)\.value\.trim\(\)/);
assert.match(imageWorkspaceHtml, /<em>at<\/em> Cosmic Gemini/);
assert.match(imageWorkspaceHtml, /brand-icon[\s\S]*workspace-product-icon[\s\S]*imageDownloadName/);
assert.match(imageWorkspaceHtml, /id="open-page"/);
assert.match(centralSource, /chrome\.sidePanel\.setOptions/);
assert.match(centralSource, /preparedImageSidePanels/);
assert.match(centralSource, /workspaces\/image-download\/image-download\.html/);
assert.doesNotMatch(centralSource, /Promise\.all\(\[configured,\s*chrome\.sidePanel\.open/);
assert.doesNotMatch(firstPartyJoined, /navigator\.mediaSession|setActionHandler\s*\(|MediaPlayPause|nativeMessaging|osascript|AppleScript/i);
assert.match(popupHtml, /video-panel-wordmark/);
assert.match(popupHtml, /video-panel-brand[\s\S]*video-panel-product-icon[\s\S]*video-panel-wordmark/);
assert.match(popupSource, /UI_VIDEO_CANCEL_PROCESSING/);
assert.match(popupCss, /\.video-processing-cancel\s*\{[^}]*var\(--danger\)/s);
assert.match(centralSource, /CG_VIDEO_CANCEL_REQUEST/);
assert.match(await readFile(join(extension, 'offscreen', 'video-download.js'), 'utf8'), /new AbortController\(\)/);
assert.equal(await stat(join(extension, 'workspaces', 'image-download', 'image-download.html')).then(() => true), true);
assert.equal(await stat(join(extension, 'offscreen', 'video-download.html')).then(() => true), true);
assert.doesNotMatch(popupSource, /brandIcon\.src/, 'Popup brand icon must remain static');
assert.match(popupSource, /#anyCopy-status[\s\S]*type: 'UI_TOGGLE_SITE_FEATURE'/);
assert.match(popupSource, /#anyCopyEnhanced-status[\s\S]*type: 'UI_TOGGLE_TAB_FEATURE'/);
assert.match(centralSource, /ANY_COPY_ENHANCED_TAB_PREFIX = 'anyCopyEnhancedTab:'/);
assert.match(centralSource, /message\.type === 'UI_TOGGLE_TAB_FEATURE'/);
assert.doesNotMatch(await readFile(join(extension, 'settings', 'any-copy.html'), 'utf8'), /data-feature-id="anyCopyEnhanced"/);
for (const id of ['imageDownload-status', 'videoDownload-status', 'all-settings', 'video-back', 'video-stop', 'video-rescan']) {
  assert.match(popupSource, new RegExp(`#${id}['"]\\)\\.addEventListener\\('click'`), `${id} is not bound`);
}
for (const id of ['focus-source', 'open-page', 'capture-area', 'rescan', 'deep-scan', 'stop', 'clear-filters', 'select-visible', 'clear-selection', 'download-selected']) {
  assert.match(imageWorkspaceSource, new RegExp(`#${id}['"]\\)\\.addEventListener\\('click'`), `${id} is not bound`);
}
assert.match(settingsSource, /remove\.addEventListener\('click'/);
assert.match(settingsSource, /form\.addEventListener\('submit'/);
assert.match(settingsSource, /pendingControls/);
assert.match(settingsSource, /data-settings-card/);
assert.match(settingsSource, /section\.dataset\.featureId/);
assert.match(settingsSource, /type: 'UI_RESET_ALL_SETTINGS'/);
for (const name of ['native-scroll.html', 'no-autoplay.html']) {
  const html = await readFile(join(extension, 'settings', name), 'utf8');
  assert.equal([...html.matchAll(/data-behavior-card/g)].length, 1);
  assert.equal([...html.matchAll(/data-behavior-list=/g)].length, 3);
  assert.equal([...html.matchAll(/class="card grouped-rule-card/g)].length, name === 'no-autoplay.html' ? 1 : 0);
  assert.doesNotMatch(html, /data-i18n="defaultBehaviorHeading"/);
  assert.match(html, /data-behavior-list="inactiveRules"[\s\S]*data-behavior-list="standardRules"[\s\S]*data-behavior-list="enhancedRules"/);
  assert.match(html, /data-i18n="exactHostnameHelp"[\s\S]*data-i18n="wildcardHostnameHelp"/);
  assert.equal([...html.matchAll(/data-feature-id="nsna" data-list-section="whitelistRules"/g)].length, 1);
  assert.match(html, /data-behavior-card[\s\S]*data-feature-id="nsna" data-list-section="whitelistRules"/);
  assert.doesNotMatch(html, /data-list-section="(?:enabledRules|standardRules|enhancedRules)"/);
}
assert.equal((await readFile(join(extension, 'settings', 'no-autoplay.html'), 'utf8')).indexOf('data-list-section="whitelistRules"') < (await readFile(join(extension, 'settings', 'no-autoplay.html'), 'utf8')).indexOf('audio-rule-card'), true);
assert.match(settingsSource, /type: 'UI_SET_BEHAVIOR_RULE'/);
assert.match(settingsSource, /type: 'UI_DELETE_BEHAVIOR_RULE'/);
assert.match(centralSource, /message\.type === 'UI_SET_BEHAVIOR_RULE'/);
assert.match(centralSource, /message\.type === 'UI_DELETE_BEHAVIOR_RULE'/);
assert.match(settingsSource, /UI_ADD_NSNA_WHITELIST_RULE/);
assert.match(settingsSource, /UI_DELETE_NSNA_WHITELIST_RULE/);
assert.match(centralSource, /UI_ADD_NSNA_WHITELIST_RULE/);
assert.match(centralSource, /UI_DELETE_NSNA_WHITELIST_RULE/);
assert.match(centralPageSource, /cosmic-gemini\.central/);
assert.match(centralPageSource, /CG_SYNC_CENTRAL/);
assert.match(centralSource, /CENTRAL_PAGE_RUNTIME_FILES/);
assert.match(centralSource, /content\/native-scroll-bridge\.js/);
assert.match(centralSource, /content\/no-autoplay-bridge\.js/);
assert.match(centralSource, /content\/any-copy-bridge\.js/);
assert.match(centralSource, /content\/any-copy-enhanced-bridge\.js/);
assert.match(centralSource, /CG_STOP_CENTRAL_FEATURE/);
assert.match(centralSource, /if \(message\.type === 'UI_RESET_ALL_SETTINGS'\)/);
assert.match(centralSource, /if \(message\.type === 'UI_SET_LOCALE'\)/);
assert.match(centralSource, /if \(message\.type === 'UI_GET_LOCALE'\)/);
assert.match(centralSource, /if \(message\.type === 'UI_GET_ACTIVE_PAGE_STATE'\)/);
assert.match(centralSource, /if \(message\.type === 'UI_OPEN_ALL_SETTINGS'\)/);
assert.match(await readFile(join(extension, 'settings', 'all-settings.html'), 'utf8'), /language-card[\s\S]*id="reset-settings-card"/);
assert.match(imageWorkspaceSource, /let scanPending = false/);
assert.match(imageWorkspaceSource, /let downloadPending = false/);
assert.doesNotMatch(bridgeSource, /AUDIO_PROMPT_COPY|CG_AUDIO|promptHost|showAudioPrompt|decideAudio/);
assert.doesNotMatch(centralSource, /CG_AUDIO_BLOCKED|CG_AUDIO_DECISION|temporaryAudioAllowed|claimAudioPrompt/);
assert.doesNotMatch(await readFile(join(extension, 'content', 'no-autoplay-runtime.js'), 'utf8'), /audioPrompted|AUDIO_BLOCKED|reportAudioBlocked/);
assert.match(settingsSource, /UI_SET_AUDIO_AUTOPLAY_ALL_SITES/);
assert.match(centralSource, /UI_SET_AUDIO_AUTOPLAY_ALL_SITES/);
assert.match(centralSource, /listName === 'permanentAudioAllowRules'[\s\S]*chrome\.runtime\.getURL\('settings\/'\)/);
assert.doesNotMatch(firstPartyJoined, /sound autoplay/i);
assert.match(centralSource, /activeVideoProcessing\.has\(processingKey\)/);
assert.match(await readFile(join(extension, 'settings', 'native-scroll.html'), 'utf8'), /© 2026 Songming\.org/);
assert.match(await readFile(join(project, '.gitignore'), 'utf8'), /^dist\/$/m);

console.log('Checked ' + files.length + ' extension files.');
