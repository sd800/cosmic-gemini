import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

test('Central page synchronization reruns after a newer request arrives in flight', async () => {
  let resolveFirst;
  let requests = 0;
  const first = new Promise(resolve => { resolveFirst = resolve; });
  const context = {
    chrome: {
      runtime: {
        sendMessage() {
          requests += 1;
          return requests === 1 ? first : Promise.resolve({ ok: true });
        },
        onMessage: { addListener() {} }
      }
    },
    location: { href: 'https://www.xiaohongshu.com/explore' },
    setTimeout,
    clearTimeout,
    Symbol,
    Object,
    Promise,
    Error
  };
  vm.createContext(context);
  const source = await readFile(new URL('../extension/content/central-page.js', import.meta.url), 'utf8');
  vm.runInContext(source, context);
  const controller = context[Symbol.for('cosmic-gemini.central')];
  const latest = controller.sync();
  resolveFirst({ ok: true });
  await latest;
  assert.equal(requests, 2);
});
