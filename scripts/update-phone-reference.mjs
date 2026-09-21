import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const METADATA_VERSION = '1.13.13';
const LIBPHONENUMBER_VERSION = '9.0.39';
const METADATA_URL = `https://raw.githubusercontent.com/catamphetamine/libphonenumber-js/v${METADATA_VERSION}/metadata.min.json`;
const CHINA_GEOCODING_EN_URL = `https://raw.githubusercontent.com/google/libphonenumber/v${LIBPHONENUMBER_VERSION}/resources/geocoding/en/86.txt`;
const CHINA_GEOCODING_ZH_URL = `https://raw.githubusercontent.com/google/libphonenumber/v${LIBPHONENUMBER_VERSION}/resources/geocoding/zh/86.txt`;
const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const destination = resolve(project, 'extension/content/mailto-capture-phone.js');

async function sourceText(path, url) {
  if (path) return readFile(resolve(path), 'utf8');
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Phone reference download failed: HTTP ${response.status} (${url})`);
  return response.text();
}

function chinaFixedLineAreas(chinaGeocoding) {
  const areas = {};
  for (const line of chinaGeocoding.split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('|');
    if (separator < 0) continue;
    const prefix = line.slice(0, separator);
    const locality = line.slice(separator + 1);
    const isTwoDigitArea = prefix.length === 4;
    const isThreeDigitArea = prefix.length === 5 && /^[3-9]/.test(prefix.slice(2));
    if (prefix.startsWith('86') && (isTwoDigitArea || isThreeDigitArea)) {
      areas[prefix.slice(2)] = locality;
    }
  }
  return areas;
}

function chineseAreaParts(value) {
  const text = String(value || '');
  const municipality = /^(北京|上海|天津|重庆)市$/.exec(text);
  if (municipality) return [municipality[1], ''];
  let province = '';
  let locality = '';
  const ordinary = /^(.+?)省(.+)$/.exec(text);
  if (ordinary) [province, locality] = ordinary.slice(1);
  else {
    const autonomous = ['内蒙古', '广西', '西藏', '宁夏', '新疆'].find(name => text.startsWith(name));
    if (autonomous) {
      province = autonomous;
      locality = text.slice(autonomous.length);
    }
  }
  if (!province) return [text.replace(/市$/, ''), ''];
  locality = locality.split('、').map(name => (
    name.replace(/(?:特别行政区|自治州|地区|盟|市|县)$/, '')
  )).join('/');
  return [province, locality];
}

function chineseCountryNames(metadata) {
  const displayNames = new Intl.DisplayNames(['zh-CN'], { type: 'region' });
  const countries = new Set(Object.values(metadata.country_calling_codes).flat());
  const overrides = Object.freeze({ HK: '香港', MO: '澳门', PS: '巴勒斯坦' });
  return Object.fromEntries([...countries].map(country => [
    country,
    overrides[country] || displayNames.of(country) || country
  ]));
}

function compactReference(metadata, chinaGeocodingEn, chinaGeocodingZh) {
  const sharedCountries = new Set(Object.values(metadata.country_calling_codes)
    .filter(countries => countries.length > 1)
    .flat());
  const sharedPlans = {};
  for (const country of sharedCountries) {
    const plan = metadata.countries[country];
    sharedPlans[country] = [plan[2], plan[3], plan[10] || 0];
  }

  const formats = {};
  for (const [callingCode, countries] of Object.entries(metadata.country_calling_codes)) {
    const planFormats = metadata.countries[countries[0]][4] || [];
    formats[callingCode] = planFormats.map(format => [
      format[0],
      format[1],
      format[2] || 0,
      format[5] || 0
    ]);
  }
  for (const [callingCode, plan] of Object.entries(metadata.nonGeographic || {})) {
    formats[callingCode] = (plan[4] || []).map(format => [
      format[0],
      format[1],
      format[2] || 0,
      format[5] || 0
    ]);
  }

  const chinaAreasEn = chinaFixedLineAreas(chinaGeocodingEn);
  const chinaAreasZh = chinaFixedLineAreas(chinaGeocodingZh);
  const chinaAreas = {};
  const chinaRegions = [];
  const chinaRegionIndexes = new Map();
  for (const [prefix, english] of Object.entries(chinaAreasEn)) {
    const chinese = chinaAreasZh[prefix];
    if (!chinese) throw new Error(`Missing Chinese China fixed-line location for ${prefix}.`);
    const [region, locality] = chineseAreaParts(chinese);
    if (!chinaRegionIndexes.has(region)) {
      chinaRegionIndexes.set(region, chinaRegions.length);
      chinaRegions.push(region);
    }
    chinaAreas[prefix] = [english, chinaRegionIndexes.get(region), locality];
  }
  if (Object.keys(chinaAreas).length < 300 || chinaAreas['10']?.[0] !== 'Beijing') {
    throw new Error('The China fixed-line geocoding reference is incomplete.');
  }

  return {
    calling: metadata.country_calling_codes,
    sharedPlans,
    formats,
    nonGeographic: Object.keys(metadata.nonGeographic || {}),
    chinaAreas,
    chinaRegions,
    countryNamesZh: chineseCountryNames(metadata)
  };
}

const metadataText = await sourceText(process.argv[2], METADATA_URL);
const chinaGeocodingEnText = await sourceText(process.argv[3], CHINA_GEOCODING_EN_URL);
const chinaGeocodingZhText = await sourceText(process.argv[4], CHINA_GEOCODING_ZH_URL);
const metadata = JSON.parse(metadataText);
if (metadata.version !== 4 || Object.keys(metadata.country_calling_codes || {}).length < 200) {
  throw new Error('The international telephone metadata is incomplete.');
}
const reference = compactReference(metadata, chinaGeocodingEnText, chinaGeocodingZhText);
const data = JSON.stringify(reference);
const digest = createHash('sha256')
  .update(metadataText).update('\0')
  .update(chinaGeocodingEnText).update('\0')
  .update(chinaGeocodingZhText)
  .digest('hex');

const output = `(() => {
  const KEY = Symbol.for('cosmic-gemini.mailto-capture.phone');
  const NANP_KEY = Symbol.for('cosmic-gemini.mailto-capture.nanp');
  if (globalThis[KEY]) return;
  // Generated by scripts/update-phone-reference.mjs. Do not edit directly.
  // Formatting metadata: libphonenumber-js ${METADATA_VERSION} / Google libphonenumber ${LIBPHONENUMBER_VERSION}.
  // Sources: ${METADATA_URL}
  //          ${CHINA_GEOCODING_EN_URL}
  //          ${CHINA_GEOCODING_ZH_URL}
  // Licenses: MIT and Apache License 2.0. Combined source SHA-256: ${digest}
  const data = ${data};
  const nonGeographicNames = Object.freeze({
    800: ['International Freephone Service', '国际免费电话业务'],
    808: ['International Shared Cost Service', '国际分摊付费业务'],
    870: ['Inmarsat', '国际海事卫星'],
    878: ['Universal Personal Telecommunications', '全球个人通信'],
    881: ['Global Mobile Satellite System', '全球移动卫星系统'],
    882: ['International Networks', '国际网络'],
    883: ['International Networks', '国际网络'],
    888: ['Telecommunications for Disaster Relief', '救灾通信'],
    979: ['International Premium Rate Service', '国际高资费业务']
  });
  const mexicoZones = Object.freeze({
    2: ['East', '东部'], 3: ['West', '西部'], 4: ['North', '北部'], 5: ['Center', '中部'],
    6: ['Northwest', '西北部'], 7: ['Southwest', '西南部'], 8: ['Northeast', '东北部'], 9: ['Southeast', '东南部']
  });
  const expressionCache = new Map();
  const resultCache = new Map();
  let englishDisplayNames = null;

  function chinese(locale) { return locale === 'zh-CN'; }

  function expression(pattern, whole = false) {
    const key = (whole ? '=' : '^') + pattern;
    let compiled = expressionCache.get(key);
    if (!compiled) {
      compiled = new RegExp(whole ? '^(?:' + pattern + ')$' : '^(?:' + pattern + ')');
      expressionCache.set(key, compiled);
    }
    return compiled;
  }

  function splitTelephone(value) {
    const raw = String(value || '').trim();
    const parameterAt = raw.indexOf(';');
    const primary = parameterAt < 0 ? raw : raw.slice(0, parameterAt);
    const parameters = parameterAt < 0 ? [] : raw.slice(parameterAt + 1).split(';').filter(Boolean);
    return { raw, primary, parameters, digits: primary.replace(/\\D/g, '') };
  }

  function callingCodeFor(digits) {
    for (let length = 3; length > 0; length -= 1) {
      const candidate = digits.slice(0, length);
      if (data.calling[candidate] || data.nonGeographic.includes(candidate)) return candidate;
    }
    return '';
  }

  function countryFor(callingCode, national) {
    const countries = data.calling[callingCode] || [];
    if (countries.length < 2) return countries[0] || '';
    for (const country of countries) {
      const leading = data.sharedPlans[country]?.[2];
      if (leading && expression(leading).test(national)) return country;
    }
    const candidates = [...countries.slice(1), countries[0]];
    for (const country of candidates) {
      const plan = data.sharedPlans[country];
      if (!plan || !plan[1]?.includes(national.length)) continue;
      if (expression(plan[0], true).test(national)) return country;
    }
    return countries[0] || '';
  }

  function internationalNational(callingCode, national) {
    for (const format of data.formats[callingCode] || []) {
      const leadingPatterns = format[2] || [];
      const leading = leadingPatterns[leadingPatterns.length - 1];
      if (leading && !expression(leading).test(national)) continue;
      const pattern = expression(format[0], true);
      if (!pattern.test(national)) continue;
      return national.replace(pattern, format[3] || format[1])
        .replace(/[()./~_-]+/g, ' ')
        .replace(/\\s+/g, ' ')
        .trim();
    }
    return national;
  }

  function parameterSuffix(parameters) {
    let suffix = '';
    for (const parameter of parameters) {
      const extension = /^ext=(.+)$/i.exec(parameter);
      suffix += extension ? ' ext. ' + extension[1] : ';' + parameter;
    }
    return suffix;
  }

  function countryName(country, locale) {
    if (!country) return '';
    if (chinese(locale)) return data.countryNamesZh[country] || country;
    try {
      englishDisplayNames ||= new Intl.DisplayNames(['en'], { type: 'region' });
      return englishDisplayNames.of(country) || country;
    } catch {
      return country;
    }
  }

  function chinaLocation(national, locale) {
    if (/^1[3-9]\\d{9}$/.test(national)) return chinese(locale) ? '中国' : 'China';
    const area = data.chinaAreas[national.slice(0, 3)] || data.chinaAreas[national.slice(0, 2)];
    if (!area) return chinese(locale) ? '中国' : 'China';
    return chinese(locale)
      ? ['中国', data.chinaRegions[area[1]], area[2]].filter(Boolean).join(' ')
      : area[0] + ', China';
  }

  function mexicoLocation(national, locale) {
    const zone = mexicoZones[national[0]];
    if (!zone) return chinese(locale) ? '墨西哥' : 'Mexico';
    return chinese(locale) ? '墨西哥 ' + zone[1] : zone[0] + ', Mexico';
  }

  function inspect(value, locale = 'en-US') {
    const raw = String(value || '');
    const normalizedLocale = chinese(locale) ? 'zh-CN' : 'en-US';
    const cacheKey = normalizedLocale + '\\0' + raw;
    const cached = resultCache.get(cacheKey);
    if (cached) return cached;
    const parts = splitTelephone(raw);
    let result;
    if (!parts.primary.startsWith('+')) {
      const location = globalThis[NANP_KEY]?.lookup(parts.raw) || '';
      if (!location) result = Object.freeze({ display: parts.raw, location: '' });
      else {
        const national = parts.digits.length === 11 && parts.digits.startsWith('1')
          ? parts.digits.slice(1)
          : parts.digits;
        const prefix = parts.digits.length === 11 ? '+1 ' : '';
        result = Object.freeze({
          display: prefix + '(' + national.slice(0, 3) + ') ' + national.slice(3, 6) + '-' + national.slice(6) + parameterSuffix(parts.parameters),
          location
        });
      }
    } else {
      const callingCode = callingCodeFor(parts.digits);
      if (!callingCode) result = Object.freeze({ display: parts.raw, location: '' });
      else {
        const national = parts.digits.slice(callingCode.length);
        const country = countryFor(callingCode, national);
        let location;
        if (callingCode === '1') location = globalThis[NANP_KEY]?.lookup(parts.raw) || 'North American Numbering Plan';
        else if (callingCode === '52') location = mexicoLocation(national, normalizedLocale);
        else if (callingCode === '86') location = chinaLocation(national, normalizedLocale);
        else location = nonGeographicNames[callingCode]?.[chinese(normalizedLocale) ? 1 : 0]
          || countryName(country, normalizedLocale);
        const displayNational = callingCode === '1' && national.length === 10
          ? '(' + national.slice(0, 3) + ') ' + national.slice(3, 6) + '-' + national.slice(6)
          : internationalNational(callingCode, national);
        result = Object.freeze({
          display: '+' + callingCode + (national ? ' ' + displayNational : '') + parameterSuffix(parts.parameters),
          location
        });
      }
    }
    if (resultCache.size >= 64) resultCache.delete(resultCache.keys().next().value);
    resultCache.set(cacheKey, result);
    return result;
  }

  Object.defineProperty(globalThis, KEY, {
    value: Object.freeze({ inspect }),
    configurable: true
  });
})();
`;

await writeFile(destination, output);
console.log(`Wrote compact telephone reference (${Buffer.byteLength(output)} bytes, ${Object.keys(reference.chinaAreas).length} China fixed-line areas).`);
