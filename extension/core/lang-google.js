// Bundled from https://www.google.com/supported_domains (2026-09-21).
// Exact search hosts only: never match a lookalike domain or unrelated Google service.
const GOOGLE_DOMAINS = new Set(`
com ad ae com.af com.ag al am co.ao com.ar as at com.au az ba com.bd be bf bg com.bh bi bj
com.bn com.bo com.br bs bt co.bw by com.bz ca cd cf cg ch ci co.ck cl cm cn com.co co.cr
com.cu cv com.cy cz de dj dk dm com.do dz com.ec ee com.eg es com.et fi com.fj fm fr ga
ge gg com.gh com.gi gl gm gr com.gt gy com.hk hn hr ht hu co.id ie co.il im co.in iq is
it je com.jm jo co.jp co.ke com.kh ki kg co.kr com.kw kz la com.lb li lk co.ls lt lu lv
com.ly co.ma md me mg mk ml com.mm mn com.mt mu mv mw com.mx com.my co.mz com.na com.ng
com.ni ne nl no com.np nr nu co.nz com.om com.pa com.pe com.pg com.ph com.pk pl pn com.pr
ps pt com.py com.qa ro ru rw com.sa com.sb sc se com.sg sh si sk com.sl sn so sm sr st
com.sv td tg co.th com.tj tl tm tn to com.tr tt com.tw co.tz com.ua co.ug co.uk com.uy
co.uz com.vc co.ve co.vi com.vn vu ws rs co.za co.zm co.zw cat
`.trim().split(/\s+/).map(suffix => `google.${suffix}`));

// Google result-language collections, distinct from interface-language (hl) codes.
// https://www.google.com/advanced_search?hl=en (2026-09-21).
// OR syntax: https://developers.google.com/custom-search/docs/xml_results_appendices
const LANGUAGES = new Set(`af ar be bg ca cs da de el en eo es et fa fi fr hi hr hu hy id
is it iw ja ko lt lv nl no pl pt ro ru sk sl sr sv sw th tl tr uk vi`.split(/\s+/));

export function googleSearchUrl(value) {
  let url;
  try { url = new URL(value); } catch { return null; }
  const host = url.hostname.replace(/\.$/, '').replace(/^(?:www|images|video)\./, '');
  return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password
    && GOOGLE_DOMAINS.has(host) && /^\/(?:search|webhp)\/?$/.test(url.pathname)
    && url.searchParams.getAll('q').length === 1 ? url : null;
}

export function googleResultLanguage(value) {
  const code = String(value).toLowerCase().replaceAll('_', '-');
  if (code === 'zhs') return 'lang_zh-CN';
  if (code === 'zht') return 'lang_zh-TW';
  let locale;
  try { locale = new Intl.Locale(code); } catch { return ''; }
  if (locale.language === 'zh') {
    // Explicit script wins over region (e.g. zh-Hant-CN and zh-Hans-HK).
    const script = locale.script || locale.maximize().script;
    return script === 'Hant' ? 'lang_zh-TW' : script === 'Hans' ? 'lang_zh-CN' : '';
  }
  const language = ({ he: 'iw', nb: 'no', nn: 'no', fil: 'tl' })[locale.language] || locale.language;
  return LANGUAGES.has(language) ? `lang_${language}` : '';
}

export function rewriteGoogleSearchUrl(value) {
  const url = googleSearchUrl(value);
  if (!url) return null;
  const query = url.searchParams.get('q');
  if (!/lang:/i.test(query)) return null;
  const languages = new Set();
  const removals = [];
  // Keep quoted phrases and unsupported commands intact. Only entire, unquoted
  // whitespace-delimited commands belong to this feature, not URLs or -lang:en.
  const tokens = query.matchAll(/"(?:\\.|[^"\\])*"?|[^\s"]+/g);
  for (const token of tokens) {
    const match = /^lang:([a-z0-9_-]+(?:,[a-z0-9_-]+)*)$/i.exec(token[0]);
    if (!match || (token.index > 0 && !/\s/.test(query[token.index - 1]))
      || (token.index + token[0].length < query.length && !/\s/.test(query[token.index + token[0].length]))) continue;
    const values = match[1].split(',').map(googleResultLanguage);
    if (values.some(language => !language)) continue;
    for (const language of values) languages.add(language);
    removals.push([token.index, token.index + token[0].length]);
  }
  if (!languages.size) return null;
  let cleaned = query;
  // Remove only the commands and their adjoining separator, preserving quoted
  // phrases and the spacing within all remaining search terms.
  for (const [start, end] of removals.reverse()) {
    let after = end;
    while (/\s/.test(cleaned[after] || '') && after < cleaned.length) after += 1;
    cleaned = cleaned.slice(0, start) + cleaned.slice(after);
  }
  url.searchParams.set('q', cleaned.trim());
  url.searchParams.set('lr', [...languages].join('|'));
  url.searchParams.delete('start');
  return url.href;
}
