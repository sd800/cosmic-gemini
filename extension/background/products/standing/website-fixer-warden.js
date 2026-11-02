import { websiteToolEnabled, savedToolDomains, toolChoices, toolSite } from './website-fixer-tools.js';

const KEY = 'cosmicGeminiCrashPageWardenDocuments';
const ROOT = 'content/crash-page-warden/';
const MAX_DOCUMENTS = 512;
const DEADLINE = 12_000;

export function createCrashPageWarden(platform) {
  const privateContext = platform.isIncognitoContext?.() === true;
  const registration = 'cosmic-gemini-crash-page-warden' + (privateContext ? '-incognito' : '');
  const documents = new Map(), watches = new Map(), connections = new Map(), retiring = new Map();
  let loaded, restored = false, writes = Promise.resolve();
  const load = () => loaded ||= (async () => {
    const values = platform.sessionStorage ? (await platform.sessionStorage.get(KEY))[KEY] : [];
    for (const value of Array.isArray(values) ? values.slice(-MAX_DOCUMENTS) : []) {
      if (typeof value?.documentId === 'string' && Number.isInteger(value.tabId) && value.tabId >= 0
        && Number.isInteger(value.frameId) && /^https?:\/\//.test(value.url || '')) {
        try { documents.set(value.documentId, { ...value, url: new URL(value.url).origin }); } catch {}
      }
    }
  })();
  function save() {
    const task = writes.then(async () => {
      if (!platform.sessionStorage) return;
      if (documents.size) await platform.sessionStorage.set({ [KEY]: [...documents.values()] });
      else await platform.sessionStorage.remove(KEY);
    });
    writes = task.catch(() => {});
    return task;
  }
  const origin = url => { try { return new URL(url).origin; } catch { return ''; } };
  async function bounded(task, timeout = 2000) {
    let timer;
    try { return await Promise.race([task, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Page rescue timed out.')), timeout);
    })]); } finally { clearTimeout(timer); }
  }
  function closeConnection(tabId, expected) {
    const connection = connections.get(tabId);
    if (!connection || expected && connection !== expected) return retiring.get(tabId) || Promise.resolve();
    connections.delete(tabId); connection.cancelled = true;
    const task = (async () => {
      await connection.ready?.catch(() => {});
      if (connection.attached) {
        connection.attached = false;
        await chrome.debugger.detach({ tabId }).catch(() => {});
      }
    })();
    retiring.set(tabId, task);
    void task.finally(() => { if (retiring.get(tabId) === task) retiring.delete(tabId); });
    return task;
  }
  function prepare(document) {
    const previous = connections.get(document.tabId);
    if (previous?.document === document) return previous.ready;
    if (document.debuggerBlocked || !chrome.debugger?.attach || Date.now() < (document.retryAt || 0)) return Promise.resolve(null);
    const closing = closeConnection(document.tabId);
    const connection = { document, attached: false, cancelled: false };
    connections.set(document.tabId, connection);
    connection.ready = (async () => {
      await closing;
      const target = { tabId: document.tabId };
      try {
        if (connection.cancelled) return null;
        await bounded(chrome.debugger.attach(target, '1.3').then(async () => {
          connection.attached = true;
          if (connection.cancelled) {
            await chrome.debugger.detach(target).catch(() => {}); connection.attached = false;
          }
        }));
        if (connection.cancelled) return null;
        // Establish the renderer-side session while it can still respond.
        // Attaching only after a synchronous stall leaves this handshake queued
        // behind the very execution that needs to be interrupted.
        await bounded(chrome.debugger.sendCommand(target, 'Runtime.disable'));
        // Only browser-dialog lifecycle is consumed; event payloads are never
        // inspected or retained. A user reading a prompt is not a script stall.
        await bounded(chrome.debugger.sendCommand(target, 'Page.enable'));
        if (!connection.cancelled) return connection;
      } catch {
        document.retryAt = Date.now() + 30_000;
      }
      connection.cancelled = true;
      if (connection.attached) {
        connection.attached = false;
        await chrome.debugger.detach(target).catch(() => {});
      }
      if (connections.get(document.tabId) === connection) connections.delete(document.tabId);
      return null;
    })();
    return connection.ready;
  }
  chrome.debugger?.onDetach?.addListener(target => {
    const connection = connections.get(target.tabId);
    if (!connection?.attached) return;
    connection.attached = false; connection.cancelled = true;
    connections.delete(target.tabId);
    // Respect a browser-level cancellation or DevTools taking ownership. Page
    // guards remain active, but this document will not attach again on its own.
    connection.document.debuggerBlocked = true;
    void save().catch(() => {});
  });
  chrome.debugger?.onEvent?.addListener((target, method) => {
    const connection = connections.get(target.tabId);
    if (!connection?.attached || connection.cancelled) return;
    if (method === 'Page.javascriptDialogOpening') {
      connection.dialogOpen = true;
      if (watches.get(target.tabId)?.document === connection.document) disarm(target.tabId);
    } else if (method === 'Page.javascriptDialogClosed') {
      connection.dialogOpen = false;
      if (connection.document.visible !== false) arm(connection.document);
    }
  });
  function disarm(tabId) {
    const previous = watches.get(tabId);
    if (previous?.timer) clearTimeout(previous.timer);
    watches.delete(tabId);
  }
  function arm(document) {
    disarm(document.tabId);
    if (connections.get(document.tabId)?.dialogOpen) return;
    const watch = { document, armedAt: Date.now(), timer: 0 };
    watches.set(document.tabId, watch);
    watch.timer = setTimeout(() => { void expired(watch).catch(() => {}); }, DEADLINE);
  }
  async function interrupt(watch) {
    const document = watch.document;
    const [tab, frame] = await Promise.all([
      chrome.tabs.get(document.tabId).catch(() => null),
      chrome.webNavigation.getFrame({ tabId: document.tabId, frameId: 0 }).catch(() => null)
    ]);
    if (watches.get(document.tabId) !== watch) return;
    if (!tab || tab.discarded
      || !!tab.incognito !== privateContext || origin(tab.pendingUrl || tab.url) !== origin(document.url)
      || frame?.documentId !== document.documentId || frame.documentLifecycle && frame.documentLifecycle !== 'active') {
      disarm(document.tabId); return;
    }
    if ((document.attempts || 0) >= 3) return;
    const connection = await prepare(document);
    if (!connection || connection.cancelled || watches.get(document.tabId) !== watch) return;
    document.attempts = (document.attempts || 0) + 1;
    await save();
    const target = { tabId: document.tabId };
    try {
      const current = await chrome.webNavigation.getFrame({ tabId: document.tabId, frameId: 0 });
      if (watches.get(document.tabId) !== watch || current?.documentId !== document.documentId
        || current.documentLifecycle && current.documentLifecycle !== 'active') return;
      // No profiling, source retrieval, or page evaluation: interrupt only the
      // authorized document's stuck execution target.
      await bounded(chrome.debugger.sendCommand(target, 'Runtime.terminateExecution'));
      document.interruptions = (document.interruptions || 0) + 1;
      await save();
      platform.notifyCentralUi?.();
    } catch { /* Navigation or browser policy may have released this target. */ }
  }
  async function expired(watch) {
    if (watches.get(watch.document.tabId) !== watch) return;
    const elapsed = Date.now() - watch.armedAt;
    // Sleep/wake, a suspended worker, or a large clock change is not evidence
    // that a webpage is stuck. Give its isolated heartbeat a fresh window.
    if (elapsed < DEADLINE - 1000 || elapsed > DEADLINE + 6000) { arm(watch.document); return; }
    await interrupt(watch);
    if (watches.get(watch.document.tabId) === watch) {
      if ((watch.document.attempts || 0) < 3) arm(watch.document);
      else disarm(watch.document.tabId);
    }
  }
  return {
    async reconcile(settings, tools) {
      await load();
      if (!restored) {
        restored = true;
        // Recover session-authorized documents after a worker restart, even
        // when their saved policy has since been switched off.
        const tabs = documents.size ? await chrome.tabs.query({}) : [];
        for (const tab of tabs) {
          if (!!tab.incognito !== privateContext || tab.discarded) continue;
          const frame = await chrome.webNavigation.getFrame({ tabId: tab.id, frameId: 0 }).catch(() => null);
          const document = documents.get(frame?.documentId);
          if (document?.frameId === 0 && document.tabId === tab.id && document.visible !== false) {
            arm(document); void prepare(document);
          }
        }
      }
      const rules = [...savedToolDomains(settings, 'crashPageWarden'), ...toolChoices(tools, 'crashPageWarden', true).map(site => '*.' + site)];
      const needed = rules.length;
      const bootstrap = registration + '-bootstrap';
      const registered = await chrome.scripting.getRegisteredContentScripts({ ids: [registration, bootstrap] });
      if (!needed) {
        if (registered.length) await chrome.scripting.unregisterContentScripts({ ids: registered.map(script => script.id) });
        return;
      }
      // An idle bridge validates the top-level policy in the owning context.
      // This also reaches cross-origin frames of selected pages, without
      // installing any page hooks on unrelated websites.
      const script = { id: registration, matches: ['http://*/*', 'https://*/*'], allFrames: true,
        js: [ROOT + 'bridge.js', ROOT + (privateContext ? 'incognito.js' : 'regular.js')],
        runAt: 'document_start', world: 'ISOLATED', persistAcrossSessions: !privateContext };
      const start = { id: bootstrap, matches: [...new Set(rules.map(rule => `*://${rule}/*`))].sort(),
        excludeMatches: toolChoices(tools, 'crashPageWarden', false).map(site => `*://*.${site}/*`),
        js: [ROOT + 'runtime.js'], allFrames: true, world: 'MAIN', runAt: 'document_start', persistAcrossSessions: !privateContext };
      for (const desired of [start, script]) {
        const current = registered.find(item => item.id === desired.id);
        if (!current) await chrome.scripting.registerContentScripts([desired]);
        else if (Object.entries(desired).some(([key, value]) => JSON.stringify(value) !== JSON.stringify(current[key]))) {
          await chrome.scripting.updateContentScripts([desired]);
        }
      }
    },
    async activate(settings, tools, sender) {
      await load();
      const tabId = sender.tab?.id, documentId = sender.documentId;
      if (!Number.isInteger(tabId) || typeof documentId !== 'string'
        || !!sender.tab.incognito !== privateContext || !/^https?:\/\//.test(sender.url || '')) return { active: false };
      let document = documents.get(documentId);
      if (!document && !websiteToolEnabled(settings, tools, 'crashPageWarden', sender.tab.url || sender.url)) return { active: false };
      if (document && (document.tabId !== tabId || document.frameId !== sender.frameId)) return { active: false };
      const current = await chrome.webNavigation.getFrame({ tabId, frameId: sender.frameId }).catch(() => null);
      if (current?.documentId !== documentId || current.documentLifecycle && current.documentLifecycle !== 'active') return { active: false };
      if (!document) {
        if (documents.size >= MAX_DOCUMENTS) {
          // Keep live root watches authorized when old BFCache/subframe
          // entries fill the bounded session table.
          const oldest = [...documents.values()].find(value => watches.get(value.tabId)?.document !== value);
          if (!oldest) return { active: false };
          documents.delete(oldest.documentId);
        }
        document = { tabId, documentId, frameId: sender.frameId, url: origin(sender.url),
          visible: sender.frameId === 0 && sender.tab.active !== false, attempts: 0, interruptions: 0 };
        documents.set(documentId, document);
        await save();
      }
      if (documents.get(documentId) !== document) return { active: false };
      if (sender.frameId === 0) {
        if (sender.tab.active !== false) arm(document);
        void prepare(document);
      }
      // Start the independent watchdog before this injection, which itself may
      // be waiting behind a runaway first-page script. Never await it here.
      const target = { tabId, documentIds: [documentId] };
      void chrome.scripting.executeScript({ target, world: 'MAIN', injectImmediately: true, files: [ROOT + 'runtime.js'] })
        .then(() => chrome.scripting.executeScript({ target, world: 'MAIN', injectImmediately: true,
          func: () => { globalThis[Symbol.for('cosmic-gemini.crash-page-warden')]?.activate(); } }))
        .catch(() => {});
      return { active: true };
    },
    async heartbeat(sender, visible) {
      await load();
      const document = documents.get(sender.documentId);
      if (!document || sender.frameId !== 0 || document.frameId !== 0
        || document.tabId !== sender.tab?.id || !!sender.tab.incognito !== privateContext) return { active: false };
      const epoch = document.heartbeatEpoch = (document.heartbeatEpoch || 0) + 1;
      const watch = watches.get(document.tabId);
      if (visible === true) {
        if (watch?.document !== document) {
          const current = await chrome.webNavigation.getFrame({ tabId: document.tabId, frameId: 0 }).catch(() => null);
          if (current?.documentId !== document.documentId || current.documentLifecycle && current.documentLifecycle !== 'active') return { active: false };
          if (document.heartbeatEpoch !== epoch) return { active: true };
        }
        arm(document); void prepare(document);
      } else if (watch?.document === document) disarm(document.tabId);
      if (document.visible !== (visible === true)) {
        document.visible = visible === true; await save();
      }
      return { active: true };
    },
    async syncSites(sites, settings, tools) {
      const selected = new Set(sites);
      const tabs = (await chrome.tabs.query({})).filter(tab => !!tab.incognito === privateContext && selected.has(toolSite(tab.url)));
      // Starting protection on an already frozen tab must still let the popup
      // finish saving its next-load policy. The injection can finish after rescue/reload.
      await Promise.allSettled(tabs.map(async tab => {
        const frame = await chrome.webNavigation.getFrame({ tabId: tab.id, frameId: 0 });
        if (frame?.documentId) await this.activate(settings, tools, {
          tab, frameId: 0, documentId: frame.documentId, url: frame.url
        });
        let timer;
        try { await Promise.race([
          chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, world: 'ISOLATED',
            injectImmediately: true, files: [ROOT + 'bridge.js', ROOT + (privateContext ? 'incognito.js' : 'regular.js')] }),
          new Promise(resolve => { timer = setTimeout(resolve, 1500); })
        ]); } finally { clearTimeout(timer); }
      }));
    },
    async handleTabUpdated(tabId, change) {
      if (!['loading', 'complete'].includes(change.status)) return;
      const connection = connections.get(tabId), watch = watches.get(tabId);
      const document = connection?.document || watch?.document;
      if (!document) return;
      const frame = await chrome.webNavigation.getFrame({ tabId, frameId: 0 }).catch(() => null);
      if (!frame) return;
      if (frame.documentId !== document.documentId) {
        if (watches.get(tabId) === watch) disarm(tabId);
        if (connection) await closeConnection(tabId, connection);
      } else if (change.status === 'complete' && document.visible !== false && !watches.has(tabId)) {
        arm(document); void prepare(document);
      }
    },
    async handleTabRemoved(tabId) {
      await load(); disarm(tabId); await closeConnection(tabId);
      for (const [id, document] of documents) if (document.tabId === tabId) documents.delete(id);
      await save();
    },
    async reset() {
      // Existing documents intentionally keep their protection until reload.
      await load();
      const current = await chrome.scripting.getRegisteredContentScripts({ ids: [registration, registration + '-bootstrap'] });
      if (current.length) await chrome.scripting.unregisterContentScripts({ ids: current.map(script => script.id) });
    }
  };
}
