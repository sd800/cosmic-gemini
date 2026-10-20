(() => {
  const KEY = Symbol.for('cosmic-gemini.mailto-capture.univ-domains');
  const DATA_KEY = Symbol.for('cosmic-gemini.mailto-capture.univ-domains-data');
  if (globalThis[KEY]) return;

  let index = null;
  const regionNames = new Map();
  const specialRegions = {
    US: ['USA', 'USA'], CN: ['China', '中国'],
    HK: ['Hong Kong, China', '中国香港'], MO: ['Macau, China', '中国澳门'],
    TW: ['Chinese Taipei', '中华台北']
  };

  function reference() {
    if (index) return index;
    const rows = globalThis[DATA_KEY];
    if (!Array.isArray(rows)) return null;
    const domains = new Map();
    for (const row of rows) {
      for (const domain of row[3]) domains.set(domain, row);
    }
    index = domains;
    return index;
  }

  function emailParts(value) {
    if (typeof value !== 'string' || value.length > 1024) return null;
    let address = value.trim();
    const display = /^[^<>\r\n]*<([^<>\r\n]+)>$/.exec(address);
    if (display) address = display[1].trim();
    const at = address.lastIndexOf('@');
    if (at < 1 || /[\r\n<>]/.test(address)) return null;
    const local = address.slice(0, at);
    // Quoted local parts may contain spaces or @; the domain must still be plain DNS.
    if (!/^"[^"\r\n]+"$/.test(local) && /[\s@"\\/?:#]/.test(local)) return null;
    let domain = address.slice(at + 1).replace(/\.$/, '');
    if (!domain || /[\s@:/\\?#%\[\]]/.test(domain)) return null;
    try { domain = new URL(`https://${domain}`).hostname.toLowerCase(); } catch { return null; }
    if (domain.length > 253 || !domain.includes('.') || domain.split('.').some(label => (
      !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)
    ))) return null;
    return { domain };
  }

  function location(row, locale) {
    const [, code, subdivision] = row;
    const chinese = locale === 'zh-CN';
    let country = specialRegions[code]?.[chinese ? 1 : 0];
    if (!country) {
      if (!regionNames.has(locale)) {
        try { regionNames.set(locale, new Intl.DisplayNames([chinese ? 'zh-CN' : 'en-US'], { type: 'region' })); }
        catch { regionNames.set(locale, null); }
      }
      try { country = regionNames.get(locale)?.of(code) || code; } catch { country = code; }
    }
    // North American locations use the institution's principal campus, never the email host.
    return subdivision ? `${subdivision}, ${country}` : country;
  }

  function lookup(value, locale = 'en-US') {
    locale = locale === 'zh-CN' ? 'zh-CN' : 'en-US';
    const parts = emailParts(value);
    if (!parts) return null;
    const data = reference();
    if (!data) return null;
    let row;
    let domain = parts.domain;
    while (domain.includes('.')) {
      row = data.get(domain);
      if (row) break;
      domain = domain.slice(domain.indexOf('.') + 1);
    }
    if (!row) return null;
    const result = { name: row[0], region: location(row, locale) };
    if (locale === 'en-US' && row[5]) result.englishName = row[5];
    const unitName = row[6]?.[domain];
    if (unitName) result.unitName = unitName;
    return result;
  }

  Object.defineProperty(globalThis, KEY, { value: Object.freeze({ lookup }), configurable: true });
})();
