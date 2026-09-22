import { FEATURE_IDS, SETTINGS_KEY, INCOGNITO_SETTINGS_KEY, updateFeature } from '../../../core/config.js';
import { CACHE_LIMIT, DOCUMENT_PREVIEW_PATH, DOCUMENT_CLEANUP_ALARM_PREFIX, DOCUMENT_CLOSED_RETENTION, DOCX_MIME, docxFilename, readDocumentResponse } from '../../../core/document-preview.js';
import { documentStore } from '../../../core/document-preview-store.js';
import { siteKey } from '../../../core/site-key.js';
import { DOCUMENT_APPEARANCES, normalizeDocumentAppearance } from '../../../core/document-appearance.js';
import { translator } from '../../../shared/localization.js';
import { showDocumentChoice } from '../../../content/document-preview-dialog.js';
import { createDocumentRequestIngress } from '../../features/document-request-ingress.js';

export function createDocumentPreviewProduct(platform, dependencies = {}) {
  const store = dependencies.store || documentStore;
  const ingress = dependencies.ingress || createDocumentRequestIngress();
  // Reattach synchronously on a worker wake so the waking request is not lost.
  // Initialization removes it immediately when the saved feature is disabled.
  ingress.setEnabled(true);
  const contextName = platform.isIncognitoContext?.() ? 'incognito' : 'regular';
  const sessionKey = 'documentPreview:' + contextName;
  const cleanupAlarm = DOCUMENT_CLEANUP_ALARM_PREFIX + contextName;
  let state, initialization, queue = Promise.resolve();
  const captures = new Map();
  const downloadNames = new Map();
  const serial = task => { const result = queue.then(task); queue = result.catch(() => {}); return result; };
  const persist = () => chrome.storage.session.set({ [sessionKey]: state });
  const tabsInContext = async () => (await chrome.tabs.query({})).filter(tab => !!tab.incognito === platform.isIncognitoContext());
  function previewId(url) {
    const [path, hash] = String(url || '').split('#');
    return path === chrome.runtime.getURL(DOCUMENT_PREVIEW_PATH) ? new URLSearchParams(hash).get('id') : null;
  }
  async function scheduleCleanup() {
    const deadlines = state.documents.filter(doc => Number.isFinite(doc.closedAt)).map(doc => doc.closedAt + DOCUMENT_CLOSED_RETENTION);
    const when = deadlines.length ? Math.min(...deadlines) : null;
    const existing = await chrome.alarms.get(cleanupAlarm);
    if (when === null) { if (existing) await chrome.alarms.clear(cleanupAlarm); }
    else if (existing?.scheduledTime !== when) await chrome.alarms.create(cleanupAlarm, { when });
  }
  async function sourceTab(request, item) {
    const tab = await chrome.tabs.get(request.tabId).catch(() => null);
    const referrer = String(item.referrer || '').split('#')[0];
    // A target="_blank" attachment can lose its short-lived download tab.
    // Recover only a unique live referrer; never use the currently focused tab.
    const downloadTab = !siteKey(tab?.url) || [item.url, item.finalUrl].includes(tab?.url);
    if (downloadTab && siteKey(referrer)) {
      const matches = (await tabsInContext()).filter(value => String(value.url || '').split('#')[0] === referrer);
      if (matches.length === 1) return matches[0];
    }
    return tab;
  }
  async function prune(clearAll = false) {
    const tabs = clearAll ? [] : await tabsInContext();
    const sites = new Set(tabs.map(tab => siteKey(tab.url)).filter(Boolean));
    const openIds = new Set(tabs.map(tab => previewId(tab.pendingUrl || tab.url)).filter(Boolean));
    const now = Date.now();
    for (const [controller, site] of captures) if (!sites.has(site)) controller.abort();
    const expired = [], retained = [];
    let lifetimeChanged = false;
    for (const doc of state.documents) {
      if (!sites.has(doc.site) || (Number.isFinite(doc.closedAt) && doc.closedAt + DOCUMENT_CLOSED_RETENTION <= now)) {
        expired.push(doc); continue;
      }
      const closedAt = openIds.has(doc.id) ? null : (doc.closedAt ?? now);
      if (doc.closedAt !== closedAt) { doc.closedAt = closedAt; lifetimeChanged = true; }
      retained.push(doc);
    }
    const choiceCount = Object.keys(state.choices).length;
    const themeCount = Object.keys(state.themes).length;
    state.documents = retained;
    state.choices = Object.fromEntries(Object.entries(state.choices).filter(([site]) => sites.has(site)));
    state.themes = Object.fromEntries(Object.entries(state.themes).filter(([site]) => sites.has(site)));
    if (expired.length || lifetimeChanged || Object.keys(state.choices).length !== choiceCount || Object.keys(state.themes).length !== themeCount) await persist();
    for (const doc of expired) await store.remove(doc.id);
    await scheduleCleanup();
    return sites;
  }
  async function initialize() {
    if (!initialization) initialization = (async () => {
      const saved = (await chrome.storage.session.get(sessionKey))[sessionKey];
      state = saved?.epoch && Array.isArray(saved.documents)
        ? saved : { epoch: crypto.randomUUID(), documents: [], choices: {} };
      state.themes = Object.fromEntries(Object.entries(state.themes || {}).filter(([, value]) => value === 'light' || value === 'dark'));
      const enabled = (await platform.readSettings()).documentPreview?.enabled === true;
      ingress.setEnabled(enabled);
      await prune();
      // Preserve a session epoch across worker sleep, but do not create a cache
      // or install page machinery for a feature that has never been enabled.
      if (!enabled && !saved && !(await store.exists?.())) return;
      await persist();
      const ids = new Set(state.documents.map(doc => doc.id));
      for (const doc of await store.all()) {
        if (doc.context === contextName && (doc.epoch !== state.epoch || !ids.has(doc.id))) await store.remove(doc.id);
      }
    })().catch(error => { initialization = null; throw error; });
    return initialization;
  }
  async function reconcile() {
    await initialize();
    return serial(async () => {
      const enabled = (await platform.readSettings()).documentPreview?.enabled === true;
      ingress.setEnabled(enabled);
      if (!enabled) for (const controller of captures.keys()) controller.abort();
      await prune();
    });
  }
  async function currentDocument(id) {
    await initialize();
    const doc = state.documents.find(value => value.id === id);
    if (!doc || (Number.isFinite(doc.closedAt) && doc.closedAt + DOCUMENT_CLOSED_RETENTION <= Date.now())
      || !(await tabsInContext()).some(tab => siteKey(tab.url) === doc.site)) throw Error('documentExpired');
    return doc;
  }
  async function open(doc, mode = 'preview') {
    const url = chrome.runtime.getURL(DOCUMENT_PREVIEW_PATH) + '#' + new URLSearchParams({ id: doc.id, mode });
    return chrome.tabs.create({ url, active: mode !== 'download' });
  }
  async function present(doc, sourceTabId) {
    const choice = state.choices[doc.site];
    if (choice === 'preview' || choice === 'download') return open(doc, choice);
    const t = translator(await platform.getLocale());
    const payload = {
      id: doc.id, filename: doc.filename, size: doc.size,
      sizeLabel: new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(doc.size / 1024) + ' KiB',
      labels: { title: 'Document Preview', close: t('documentClose'), preview: t('documentPreviewAction'), download: t('documentDownloadAction'), remember: t('documentRemember'), failed: t('documentActionFailed') }
    };
    try {
      const tab = await chrome.tabs.get(sourceTabId);
      if (siteKey(tab.url) !== doc.site) throw Error();
      const result = await chrome.scripting.executeScript({ target: { tabId: sourceTabId, frameIds: [0] }, world: 'ISOLATED', func: showDocumentChoice, args: [payload] });
      if (result[0]?.result !== true) throw Error();
    } catch { await open(doc, 'choose'); }
  }

  // Holding filename determination has a browser deadline. Prepare a reusable,
  // validated copy within eight seconds, then cancel before releasing suggest().
  // If preparation fails, the original task continues with its original request.
  async function capture(item, suggest) {
    let released = false;
    const release = () => { if (!released) { released = true; suggest(); } };
    const controller = new AbortController();
    const deadline = setTimeout(() => { controller.abort(); release(); }, 10000);
    let savedDoc, cancelled = false;
    try {
      await initialize();
      if (!(await platform.readSettings()).documentPreview?.enabled) return;
      const request = ingress.take(item);
      if (!request || request.method !== 'GET') return;
      const tab = await sourceTab(request, item);
      const site = siteKey(tab?.url);
      if (!site || !!tab.incognito !== platform.isIncognitoContext() || state.choices[site] === 'download') return;
      captures.set(controller, site);
      const url = item.finalUrl || item.url;
      if (!/^https?:\/\//i.test(url)) return;
      const cached = state.documents.find(doc => doc.site === site && doc.url === url
        && !(Number.isFinite(doc.closedAt) && doc.closedAt + DOCUMENT_CLOSED_RETENTION <= Date.now()));
      let blob = cached && (await store.get(cached.id))?.blob;
      if (!blob) {
        const response = await fetch(url, { credentials: 'include', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8000)]) });
        const buffer = await readDocumentResponse(response);
        blob = new Blob([buffer], { type: DOCX_MIME });
      }
      if (released || controller.signal.aborted) return;
      await serial(async () => {
        const sites = await prune();
        if (!sites.has(site) || !(await platform.readSettings()).documentPreview?.enabled || controller.signal.aborted) return;
        const existing = state.documents.find(doc => doc.site === site && doc.url === url);
        if (existing && await store.get(existing.id)) savedDoc = existing;
        else {
          if (state.documents.length >= 24 || state.documents.reduce((sum, doc) => sum + doc.size, 0) + blob.size > CACHE_LIMIT) return;
          savedDoc = { id: crypto.randomUUID(), site, filename: docxFilename(item), size: blob.size, url, closedAt: Date.now() };
          await store.put({ ...savedDoc, blob, context: contextName, epoch: state.epoch });
          state.documents.push(savedDoc); await persist();
          await scheduleCleanup();
        }
        if (released || controller.signal.aborted) return;
        clearTimeout(deadline); // Do not release filename selection mid-cancellation.
        await chrome.downloads.cancel(item.id);
        cancelled = true;
      });
      if (!cancelled) return;
      release();
      await chrome.downloads.erase({ id: item.id }).catch(() => {});
      // Recheck after cancellation: a closed source site must not revive a cache.
      await currentDocument(savedDoc.id);
      await present(savedDoc, tab.id);
    } catch {
      // Before cancellation Chrome retains its original task. Afterwards expose
      // a privileged choice page if the source DOM could not host the dialog.
      if (cancelled && savedDoc) {
        try { await currentDocument(savedDoc.id); await open(savedDoc, 'choose'); } catch {}
      }
    } finally { clearTimeout(deadline); captures.delete(controller); release(); }
  }

  const product = {
    id: FEATURE_IDS.DOCUMENT_PREVIEW,
    async state(settings, url) {
      const enabled = settings.documentPreview?.enabled === true;
      if (!enabled) return { enabled: false, active: false, supported: /^https?:\/\//i.test(url || '') };
      await initialize();
      const site = siteKey(url);
      return { enabled, active: !!site, supported: !!site, site, choice: state.choices[site] || 'ask' };
    },
    sync() { return false; },
    initialize,
    handleDeterminingFilename(item, suggest) {
      const ownSource = [item.url, item.finalUrl].find(url => downloadNames.has(url));
      if (ownSource && item.byExtensionId === chrome.runtime.id) {
        suggest({ filename: downloadNames.get(ownSource).filename, conflictAction: 'uniquify' });
        downloadNames.delete(ownSource); return true;
      }
      if (!docxFilename(item) || item.byExtensionId || item.state !== 'in_progress'
        || (item.danger && !['safe', 'accepted', 'allowlistedByPolicy'].includes(item.danger))) return false;
      void capture(item, suggest);
      return true;
    },
    async handleMessage(message, context) {
      const senderUrl = String(context.sender?.url || '');
      if (message.type === 'UI_SET_DOCUMENT_APPEARANCE') {
        if (!senderUrl.startsWith(chrome.runtime.getURL('settings/'))) throw Error('Settings only.');
        if (!DOCUMENT_APPEARANCES.includes(message.appearance)) throw Error('Unknown appearance.');
        const settings = await platform.mutateSettings(current => updateFeature(current, product.id, feature => ({ ...feature, appearance: message.appearance })));
        return settings.documentPreview;
      }
      if (message.type === 'UI_SET_ENABLED') {
        if (!senderUrl.startsWith(chrome.runtime.getURL('settings/'))) throw Error('Settings only.');
        const settings = await platform.mutateSettings(current => updateFeature(current, product.id, feature => ({ ...feature, enabled: message.enabled === true })));
        await reconcile(); return settings.documentPreview;
      }
      if (message.type === 'UI_DOCUMENT_RESET_CHOICE') {
        if (!senderUrl.startsWith(chrome.runtime.getURL('popup/'))) throw Error('Popup only.');
        const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
        if (tab?.id !== message.tabId) throw Error('The current page changed.');
        await initialize();
        await serial(async () => { delete state.choices[siteKey(tab.url)]; await persist(); });
        return { reset: true };
      }
      const workspace = senderUrl.split('#')[0] === chrome.runtime.getURL(DOCUMENT_PREVIEW_PATH);
      const page = message.type === 'CG_DOCUMENT_CHOICE' && context.sender.frameId === 0;
      if (!workspace && !page) throw Error('Document action unavailable.');
      const doc = await currentDocument(String(message.id || ''));
      if (page && siteKey(context.sender.tab?.url) !== doc.site) throw Error('The source website changed.');
      if (workspace && new URLSearchParams(senderUrl.split('#')[1] || '').get('id') !== doc.id) throw Error('Wrong document.');
      if (message.type === 'UI_DOCUMENT_GET') return {
        ...doc, epoch: state.epoch, context: contextName, choice: state.choices[doc.site] || 'ask',
        appearance: normalizeDocumentAppearance((await platform.readSettings()).documentPreview?.appearance),
        siteTheme: state.themes[doc.site] || null
      };
      if (message.type === 'UI_DOCUMENT_SET_THEME') {
        if (!workspace || ![null, 'light', 'dark'].includes(message.theme)) throw Error('Unknown appearance.');
        return serial(async () => {
          await currentDocument(doc.id);
          const previous = { ...state.themes };
          if (message.theme === null) delete state.themes[doc.site];
          else state.themes[doc.site] = message.theme;
          try { await persist(); }
          catch (error) { state.themes = previous; throw error; }
          return { siteTheme: state.themes[doc.site] || null };
        });
      }
      if (['CG_DOCUMENT_CHOICE', 'UI_DOCUMENT_CHOICE'].includes(message.type)) {
        if (!['preview', 'download', 'dismiss'].includes(message.action)) throw Error('Unknown action.');
        if (message.action === 'dismiss') return { dismissed: true };
        if (message.remember) await serial(async () => {
          await currentDocument(doc.id); state.choices[doc.site] = message.action; await persist();
        });
        if (page) await open(doc, message.action);
        return { action: message.action };
      }
      if (message.type === 'UI_DOCUMENT_DOWNLOAD') {
        if (!workspace || !String(message.blobUrl).startsWith('blob:' + chrome.runtime.getURL(''))) throw Error('Invalid document source.');
        // Omit saveAs: respect Chrome's own download-location preference.
        for (const [url, value] of downloadNames) if (value.expires < Date.now()) downloadNames.delete(url);
        if (downloadNames.size >= 64) throw Error('Too many pending downloads.');
        downloadNames.set(message.blobUrl, { filename: doc.filename, expires: Date.now() + 30000 });
        try {
          const downloadId = await chrome.downloads.download({ url: message.blobUrl, filename: doc.filename, conflictAction: 'uniquify' });
          return { downloadId };
        } catch (error) { downloadNames.delete(message.blobUrl); throw error; }
      }
      throw Error('Unknown document command.');
    },
    handleTabCreated(tab) { return previewId(tab.pendingUrl || tab.url) ? reconcile() : false; },
    async handleAlarm(alarm) {
      if (alarm.name !== cleanupAlarm) return false;
      await reconcile(); return true;
    },
    handleTabUpdated(_id, change) { return change.url && (state?.documents.length || Object.keys(state?.choices || {}).length || Object.keys(state?.themes || {}).length || captures.size) ? reconcile() : false; },
    handleTabRemoved() { return state?.documents.length || Object.keys(state?.choices || {}).length || Object.keys(state?.themes || {}).length || captures.size ? reconcile() : false; },
    handleStorageChanged(changes, area) {
      const key = platform.isIncognitoContext() ? INCOGNITO_SETTINGS_KEY : SETTINGS_KEY;
      const change = changes[key];
      return area === (platform.isIncognitoContext() ? 'session' : 'local') && change
        && change.oldValue?.documentPreview?.enabled !== change.newValue?.documentPreview?.enabled ? reconcile() : false;
    },
    async reset() { await reconcile(); return serial(() => prune(true)); }
  };
  return Object.freeze(product);
}
