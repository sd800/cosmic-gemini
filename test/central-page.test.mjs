import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

test('Central page synchronization reruns after a newer request arrives in flight', async () => {
  let resolveFirst;
  let pageListener;
  let requests = 0;
  const first = new Promise(resolve => { resolveFirst = resolve; });
  const context = {
    chrome: {
      runtime: {
        sendMessage() {
          requests += 1;
          return requests === 1 ? first : Promise.resolve({ ok: true });
        },
        onMessage: { addListener(listener) { pageListener = listener; } }
      }
    },
    window: { addEventListener() {} },
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
  let alive;
  pageListener({ type: 'CG_PAGE_ALIVE' }, {}, response => { alive = response; });
  assert.equal(alive.url, context.location.href,
    'an existing page document can be distinguished from a Chrome error page');
  const latest = controller.sync();
  resolveFirst({ ok: true });
  await latest;
  assert.equal(requests, 2);
});

test('history restore refreshes policy and hidden documents do not keep retrying', async () => {
  const listeners=new Map(),timers=new Map();let requests=0,settle;
  const context={window:{addEventListener(type,fn){listeners.set(type,fn);}},location:{href:'https://example.com'},
    setTimeout(fn){timers.set(1,fn);return 1;},clearTimeout(id){timers.delete(id);},
    chrome:{runtime:{sendMessage(){requests++;return requests===1?new Promise(resolve=>{settle=resolve;}):Promise.resolve({ok:true});},onMessage:{addListener(){}}}}};
  vm.createContext(context);vm.runInContext(await readFile(new URL('../extension/content/central-page.js',import.meta.url),'utf8'),context);
  const central=context[Symbol.for('cosmic-gemini.central')];
  listeners.get('pagehide')();settle({ok:false});await new Promise(resolve=>setImmediate(resolve));
  await central.sync();assert.equal(requests,1);assert.equal(timers.size,0);
  listeners.get('pageshow')({persisted:true});await new Promise(resolve=>setImmediate(resolve));
  assert.equal(requests,2,'returning from BFCache reads the current settings');
  listeners.get('pageshow')({persisted:false});assert.equal(requests,2,'ordinary initial pageshow does not duplicate startup');
});
