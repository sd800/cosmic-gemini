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
assert.equal(manifest.version, '1.1.2');
assert.equal(manifest.description, 'A personal toolkit for the web.');
assert.deepEqual(manifest.permissions.sort(), ['activeTab', 'alarms', 'storage']);
assert.deepEqual(manifest.host_permissions.sort(), ['http://*/*', 'https://*/*']);
assert.equal(manifest.options_page, 'settings/native-scroll.html');
assert.deepEqual(manifest.content_scripts[0].js, ['content/runtime.js', 'content/no-autoplay-runtime.js']);
assert.equal(manifest.content_scripts[0].world, 'MAIN');
assert.equal(manifest.content_scripts[0].run_at, 'document_start');
assert.equal(manifest.content_scripts[1].world, 'ISOLATED');
assert.deepEqual(manifest.content_scripts[2].js, ['content/any-copy-runtime.js']);
assert.equal(manifest.content_scripts[2].world, 'MAIN');
assert.equal(manifest.content_scripts[2].all_frames, true);
assert.deepEqual(manifest.content_scripts[3].js, ['content/any-copy-bridge.js']);
assert.equal(manifest.content_scripts[3].world, 'ISOLATED');
assert.equal(manifest.content_scripts[3].all_frames, true);

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

for (const path of files.filter(path => path.endsWith('.css'))) {
  assert.doesNotMatch(await readFile(path, 'utf8'), /letter-spacing\s*:\s*-/i, path + ' uses negative letter spacing');
}

const sourceFiles = files.filter(path => /\.(?:js|html|css)$/.test(path));
const joined = (await Promise.all(sourceFiles.map(path => readFile(path, 'utf8')))).join('\n');
assert.doesNotMatch(joined, /fetch\s*\(|XMLHttpRequest|WebSocket\s*\(/, 'Extension source contains a network client');
assert.doesNotMatch(joined, /recent activity|最近活动/i, 'Extension exposes an activity log');
assert.equal(await stat(join(extension, 'settings', 'native-scroll.html')).then(() => true), true);
assert.equal(await stat(join(extension, 'settings', 'no-autoplay.html')).then(() => true), true);
assert.equal(await stat(join(extension, 'settings', 'any-copy.html')).then(() => true), true);
for (const name of ['native-scroll.html', 'no-autoplay.html', 'any-copy.html']) {
  const html = await readFile(join(extension, 'settings', name), 'utf8');
  assert.match(html, /<script src="\.\.\/localization-data\.js"><\/script>/);
  assert.match(html, /<script src="preload\.js"><\/script>\s*<script type="module" src="page\.js"><\/script>/);
}
assert.match(await readFile(join(extension, 'popup.html'), 'utf8'), /data-feature="nativeScroll"/);
assert.match(await readFile(join(extension, 'popup.html'), 'utf8'), /data-feature="noAutoplay"/);
assert.match(await readFile(join(extension, 'popup.html'), 'utf8'), /data-feature="anyCopy"/);
assert.doesNotMatch(await readFile(join(extension, 'popup.js'), 'utf8'), /brandIcon\.src/, 'Popup brand icon must remain static');
assert.match(await readFile(join(extension, 'settings', 'native-scroll.html'), 'utf8'), /© 2026 Songming\.org/);
assert.match(await readFile(join(project, '.gitignore'), 'utf8'), /^dist\/$/m);

console.log('Checked ' + files.length + ' extension files.');
