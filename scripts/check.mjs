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
  assert.equal(check.status, 0, `${path}\n${check.stderr}`);
}

const manifest = JSON.parse(await readFile(join(extension, 'manifest.json'), 'utf8'));
assert.equal(manifest.manifest_version, 3);
assert.equal(manifest.version, '0.1.0');
assert.deepEqual(manifest.permissions.sort(), ['activeTab', 'storage']);
assert.deepEqual(manifest.host_permissions.sort(), ['http://*/*', 'https://*/*']);
assert.equal(manifest.content_scripts[0].world, 'MAIN');
assert.equal(manifest.content_scripts[0].run_at, 'document_start');
assert.equal(manifest.content_scripts[1].world, 'ISOLATED');

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
    const reference = match[1];
    if (/^(?:#|https?:|data:)/.test(reference)) continue;
    await stat(resolve(dirname(htmlPath), reference));
  }
}

for (const path of files.filter(path => /\.css$/.test(path))) {
  assert.doesNotMatch(await readFile(path, 'utf8'), /letter-spacing\s*:\s*-/i, `${path} uses negative letter spacing`);
}

const sources = await Promise.all(files.filter(path => /\.(?:js|html|css)$/.test(path)).map(path => readFile(path, 'utf8')));
const joined = sources.join('\n');
assert.doesNotMatch(joined, /fetch\s*\(|XMLHttpRequest|WebSocket\s*\(/, 'Extension source contains a network client');
assert.match(await readFile(join(extension, 'popup.html'), 'utf8'), /id="power"/);
assert.match(await readFile(join(extension, 'popup.html'), 'utf8'), /id="mode"/);
assert.match(await readFile(join(extension, 'popup.html'), 'utf8'), /id="whitelist"/);
assert.match(await readFile(join(extension, 'settings.html'), 'utf8'), /© 2026 Songming\.org/);

console.log(`Checked ${files.length} extension files.`);
