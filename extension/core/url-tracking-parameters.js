// Product-owned data/helper, also usable by the small classic page runtime.
(() => {
  const key = Symbol.for('cosmic-gemini.url-tracking-cleaner.parameters');
  if (globalThis[key]) return;
  const names = Object.freeze(['utm_source', 'utm_medium', 'utm_campaign', 'utm_id', 'utm_term',
    'utm_content', 'utm_source_platform', 'utm_creative_format', 'utm_marketing_tactic']);
  const keys = new Set(names);
  function clean(value, options = {}) {
    if (typeof value !== 'string' || value.length > 65536) return '';
    const utm = options.utmParameters !== false;
    const bilibili = options.bilibiliParameters === true;
    if (!(utm && /[?&](?:utm_|%[0-9a-f]{2})/i.test(value))
      && !(bilibili && value.includes('?') && /bilibili\.com/i.test(value))) return '';
    let url; try { url = new URL(value); } catch { return ''; }
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    const href = url.href, hashAt = href.indexOf('#'), end = hashAt < 0 ? href.length : hashAt;
    const queryAt = href.indexOf('?');
    if (queryAt < 0 || queryAt >= end) return '';
    const hostname = url.hostname.replace(/\.$/, '');
    if (bilibili && (hostname === 'bilibili.com' || hostname.endsWith('.bilibili.com'))) return href.slice(0, queryAt);
    if (!utm) return '';
    let changed = false;
    const kept = href.slice(queryAt + 1, end).split('&').filter(part => {
      let name; try { name = decodeURIComponent(part.split('=', 1)[0]).toLowerCase(); } catch { return true; }
      if (!keys.has(name)) return true;
      changed = true; return false;
    });
    return changed ? href.slice(0, queryAt) + (kept.length ? '?' + kept.join('&') : '') + href.slice(end) : '';
  }
  Object.defineProperty(globalThis,key,{value:Object.freeze({names,clean}),configurable:true});
})();
