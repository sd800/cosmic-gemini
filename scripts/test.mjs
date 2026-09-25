import { readdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Discover every suite, and isolate its Chrome mocks from other suites.
// Run serially to keep resource usage predictable.
const directory = new URL('../test/', import.meta.url);
const files = readdirSync(directory).filter(name => name.endsWith('.test.mjs')).sort()
  .map(name => fileURLToPath(new URL(name, directory)));
if (!files.length) throw new Error('No test suites found.');
const child = spawn(process.execPath, ['--test', '--test-concurrency=1', ...files], { stdio: 'inherit' });
child.on('error', error => { console.error(error); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
