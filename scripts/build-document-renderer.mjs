// Usage: npm ci --prefix <build-dir> --ignore-scripts, using the package files
// in docs/document-renderer-build; then run this script with <build-dir>.
import { createRequire } from 'node:module';
import { readFile, writeFile, readdir, access } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { createHash } from 'node:crypto';

const dependencies = resolve(process.argv[2] || '');
if (!process.argv[2]) throw Error('Pass the directory containing the locked build dependencies.');
const require = createRequire(join(dependencies, 'package.json'));
const browserify = require('browserify'), { minify } = require('terser');
const bundle = browserify(require.resolve('mammoth'), { standalone: 'mammoth' });
const files = new Set();
bundle.pipeline.get('deps').on('data', row => files.add(row.file));
const input = await new Promise((done, reject) => bundle.bundle((error, bytes) => error ? reject(error) : done(bytes.toString())));
const packages = new Map();
for (const file of files) {
  let directory = dirname(file);
  for (;;) {
    try {
      await access(join(directory, 'package.json'));
      const pkg = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
      if (pkg.name && pkg.version) { packages.set(pkg.name + '@' + pkg.version, { directory, pkg }); break; }
    } catch {}
    const parent = dirname(directory); if (directory === parent) throw Error('No package owner for ' + file);
    directory = parent;
  }
}
// Some packages supply a prebuilt browser artifact with dependencies already
// inside it. Include the runtime dependency closure, not just Browserify rows.
for (const { directory, pkg } of packages.values()) {
  const localRequire = createRequire(join(directory, 'package.json'));
  for (const name of Object.keys(pkg.dependencies || {})) {
    const path = localRequire.resolve(name + '/package.json');
    const dependency = JSON.parse(await readFile(path, 'utf8'));
    const key = dependency.name + '@' + dependency.version;
    if (!packages.has(key)) packages.set(key, { directory: dirname(path), pkg: dependency });
  }
}
const notices = ['Document Preview renderer — distribution and runtime dependency notices', 'JSZip is used under its MIT license. Some CLI-only dependencies are not included in the browser bundle.'];
for (const [name, { directory, pkg }] of [...packages].sort(([a], [b]) => a.localeCompare(b, 'en'))) {
  const licenseFiles = (await readdir(directory)).filter(file => /^(?:licen[cs]e|copying|notice)/i.test(file) && !/gpl/i.test(file));
  notices.push('\n' + name + ' — ' + (typeof pkg.license === 'string' ? pkg.license : JSON.stringify(pkg.license)));
  if (!licenseFiles.length) {
    const readmeName = (await readdir(directory)).find(file => /^readme(?:\.md)?$/i.test(file));
    const readme = readmeName ? await readFile(join(directory, readmeName), 'utf8') : '';
    const start = readme.search(/^#+\s+Licen[cs]e\s*$/im);
    if (start < 0 || !/Permission is hereby|Redistribution and use/.test(readme.slice(start))) throw Error('Missing license text: ' + name);
    notices.push(readme.slice(start));
  }
  for (const file of licenseFiles.sort()) notices.push(await readFile(join(directory, file), 'utf8'));
}
const { code } = await minify(input, { compress: true, mangle: true, format: { comments: /^!|@license|@preserve/ } });
const output = code + '\n';
const vendor = new URL('../extension/vendor/mammoth/', import.meta.url);
await writeFile(new URL('mammoth.browser.min.js', vendor), output);
await writeFile(new URL('THIRD_PARTY_NOTICES.txt', vendor), notices.join('\n\n').replace(/[ \t]+$/gm, '').trim() + '\n');
console.log(JSON.stringify({ bytes: Buffer.byteLength(output), sha256: createHash('sha256').update(output).digest('hex'), packages: [...packages.keys()].sort() }, null, 2));
