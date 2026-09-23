// Usage: npm ci --prefix <build-dir> --ignore-scripts, using the package files
// in docs/document-renderer-build; then run this script with <build-dir>.
import { createRequire } from 'node:module';
import { readFile, writeFile, readdir, access, mkdir } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { Transform } from 'node:stream';
import { realpathSync } from 'node:fs';

const dependencies = resolve(process.argv[2] || '');
if (!process.argv[2]) throw Error('Pass the directory containing the locked build dependencies.');
const require = createRequire(join(dependencies, 'package.json'));
const browserify = require('browserify'), { minify } = require('terser');
const bundle = browserify(new URL('./document-renderer/entry.cjs', import.meta.url).pathname, { standalone: 'mammoth', paths: [join(dependencies,'node_modules')] });
// Small, version-checked hooks carry formatting beside Mammoth's existing content
// model. Upstream files on disk are untouched; a changed hook fails the build.
const hooks = new Map([
  [require.resolve('mammoth/lib/docx/docx-reader'), [
    ['docxFile: docxFile,\n        files: files', 'docxFile: docxFile,\n        cgFormatting: options.cgFormatting,\n        files: files'],
    ['files: options.files', 'files: options.files,\n            cgFormatting: options.cgFormatting && options.cgFormatting.forPart(filename)']
  ]],
  [require.resolve('mammoth/lib/docx/body-reader'), [
    ['var handler = xmlElementReaders[element.name];', 'if (options.cgFormatting && options.cgFormatting.isSpecial(element)) return options.cgFormatting.wrap(element, emptyResult);\n            var handler = xmlElementReaders[element.name];'],
    ['return handler(element);', 'return options.cgFormatting ? options.cgFormatting.wrap(element, function() { return handler(element); }) : handler(element);']
  ]],
  [require.resolve('mammoth/lib/document-to-html'), [
    ['return handler(element, messages, options);', 'var nodes = handler(element, messages, options);\n            return formatting ? formatting.decorate(element, nodes) : nodes;'],
    ['var noteNumber = 1;', 'var formatting = options.cgFormatting;\n    var noteNumber = 1;']
  ]],
  [require.resolve('mammoth/lib/docx/office-xml-reader'), [
    ['var xmlNamespaceMap = {', 'var xmlNamespaceMap = {\n    "http://schemas.openxmlformats.org/officeDocument/2006/math": "m",\n    "http://purl.oclc.org/ooxml/officeDocument/math": "m",'],
    ['function readXmlFromZipFile(docxFile, path) {', 'function readXmlFromZipFile(docxFile, path) {\n    if (docxFile.cgXmlCache && docxFile.cgXmlCache.has(path)) return promises.resolve(docxFile.cgXmlCache.get(path));'],
    ['function read(xmlString) {', 'function read(xmlString) {\n    if (/<!DOCTYPE|<!ENTITY/i.test(xmlString)) throw new Error("Unsupported XML declaration");']
  ]]
]);
const appliedHooks=new Set();
bundle.transform(file => {
  file = realpathSync(file);
  let source='';
  return new Transform({transform(chunk,_encoding,done){source+=chunk;done();},flush(done){
    try {for(const [from,to] of hooks.get(file)||[]) {if(source.split(from).length!==2)throw Error('Renderer hook changed: '+file);source=source.replace(from,to);appliedHooks.add(file);}this.push(source);done();}catch(error){done(error);}
  }});
},{global:true});
const files = new Set();
bundle.pipeline.get('deps').on('data', row => files.add(row.file));
const input = await new Promise((done, reject) => bundle.bundle((error, bytes) => error ? reject(error) : done(bytes.toString())));
if(appliedHooks.size!==hooks.size)throw Error('Renderer hooks missing: '+JSON.stringify([...hooks.keys()].filter(file=>!appliedHooks.has(file)))+'; resolved files: '+JSON.stringify([...files].filter(file=>/body-reader|docx-reader|document-to-html|office-xml-reader/.test(file))));
const packages = new Map();
for (const file of files) {
  if(file.startsWith(new URL('./document-renderer/',import.meta.url).pathname)) continue;
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

// SheetJS is loaded separately and only for legacy XLS; other previews do not
// parse its bundle. The full build includes legacy character encoding tables.
const sheetjsDir = dirname(require.resolve('xlsx'));
const sheetjsVendor = new URL('../extension/vendor/sheetjs/', import.meta.url);
await mkdir(sheetjsVendor, { recursive: true });
const sheetjs = await readFile(join(sheetjsDir, 'dist/xlsx.full.min.js'));
await writeFile(new URL('xlsx.full.min.js', sheetjsVendor), sheetjs);
await writeFile(new URL('LICENSE', sheetjsVendor), await readFile(join(sheetjsDir, 'LICENSE')));
await writeFile(new URL('NOTICE.md', sheetjsVendor), `# SheetJS Community Edition\n\nVersion 0.20.3. Apache-2.0. Copyright SheetJS LLC.\nSource: https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz\nDocumentation: https://docs.sheetjs.com/\n\nUnmodified standalone full browser build with its legacy codepage support.\nLoaded only by the Document Preview worker for legacy Excel workbooks.\nOnly cached cell values are displayed; formulas, macros and external links never execute.\n\nSHA-256: \`${createHash('sha256').update(sheetjs).digest('hex')}\`\n`);
