// Run with an unpacked pdfjs-dist@6.3.289 directory. No dependency code executes.
import { cp, mkdir, readFile, writeFile, readdir, stat, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
const source = resolve(process.argv[2] || ''), target = resolve('extension/vendor/pdfjs');
const pkg = JSON.parse(await readFile(join(source, 'package.json'), 'utf8'));
if (pkg.name !== 'pdfjs-dist' || pkg.version !== '6.3.289') throw Error('Expected pdfjs-dist@6.3.289');
// This directory is entirely generated. Rebuilding must never accumulate stale
// codecs, duplicate font files or files removed by a newer dependency policy.
await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
for (const name of ['pdf.min.mjs', 'pdf.worker.min.mjs']) await cp(join(source, 'legacy/build', name), join(target, name));
// Only the reusable viewer, not Mozilla's application, editor or scripting engine.
await cp(join(source, 'legacy/web/pdf_viewer.mjs'), join(target, 'pdf_viewer.mjs'));
await cp(join(source, 'web/pdf_viewer.css'), join(target, 'pdf_viewer.css'));
await mkdir(join(target, 'images'), { recursive: true });
await cp(join(source, 'web/images/loading-icon.gif'), join(target, 'images/loading-icon.gif'));
for (const name of ['cmaps', 'standard_fonts']) await cp(join(source, name), join(target, name), { recursive: true });
await mkdir(join(target, 'wasm'), { recursive: true });
for (const name of await readdir(join(source, 'wasm'))) {
  if (!name.startsWith('quickjs')) await cp(join(source, 'wasm', name), join(target, 'wasm', name));
}
await cp(join(source, 'LICENSE'), join(target, 'LICENSE'));
const files = {};
async function walk(dir, prefix = '') {
  for (const name of (await readdir(dir)).sort()) {
    if (name === 'integrity.json' || name === 'NOTICE.md') continue;
    const path = join(dir, name), key = prefix + name;
    if ((await stat(path)).isDirectory()) await walk(path, key + '/');
    else files[key] = createHash('sha256').update(await readFile(path)).digest('hex');
  }
}
await walk(target);
await writeFile(join(target, 'integrity.json'), JSON.stringify(files, null, 2) + '\n');
await writeFile(join(target, 'NOTICE.md'), `# PDF.js 6.3.289\n\nMozilla PDF.js, Apache-2.0. https://github.com/mozilla/pdf.js/tree/v6.3.289\n\nSource: pdfjs-dist@6.3.289 from the npm registry. Package integrity: sha512-ZHjSVpDa3D6izMq8/04lvkhkATUmL9px6ChPaXc1k6nU2Mrhlg1/7F0bdUqCwUjw3NsPTfPZsMDUU6ZIcRaeQw==\n\nReproduce with node scripts/vendor-pdf-viewer.mjs /path/to/unpacked/package. The legacy engine and viewer support the extension's Chrome baseline. Source files are unmodified; source maps, application UI, QuickJS, editing application and remote resources are not included. Standard fonts, CMaps and image codecs are local and load only as needed. Subcomponent licenses are in their respective folders. integrity.json records every shipped dependency asset.\n`);
