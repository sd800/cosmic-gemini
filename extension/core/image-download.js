const IMAGE_MIME_EXTENSIONS = Object.freeze({
  'image/avif': 'avif',
  'image/bmp': 'bmp',
  'image/gif': 'gif',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/svg+xml': 'svg',
  'image/tiff': 'tiff',
  'image/vnd.microsoft.icon': 'ico',
  'image/webp': 'webp',
  'image/x-icon': 'ico'
});

const IMAGE_EXTENSIONS = new Set(Object.values(IMAGE_MIME_EXTENSIONS));
const FAMILY_QUERY_KEYS = new Set([
  'auto', 'crop', 'dpr', 'fit', 'fm', 'format', 'h', 'height', 'q', 'quality',
  'resize', 'size', 'thumbnail', 'w', 'width'
]);

function stableHash(value) {
  let hash = 0x811c9dc5;
  const text = String(value || '');
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function cleanNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.round(number) : 0;
}

function normalizedImageUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^data:image\//i.test(raw)) return raw.length <= 1_500_000 ? raw : '';
  if (/^blob:/i.test(raw)) return raw;
  try {
    const url = new URL(raw);
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    url.hash = '';
    return url.href;
  } catch { return ''; }
}

export function imageExtension(value, mime = '') {
  const normalizedMime = String(mime || '').split(';')[0].trim().toLowerCase();
  if (IMAGE_MIME_EXTENSIONS[normalizedMime]) return IMAGE_MIME_EXTENSIONS[normalizedMime];
  const raw = String(value || '');
  const dataMatch = raw.match(/^data:(image\/[a-z0-9.+-]+)/i);
  if (dataMatch && IMAGE_MIME_EXTENSIONS[dataMatch[1].toLowerCase()]) {
    return IMAGE_MIME_EXTENSIONS[dataMatch[1].toLowerCase()];
  }
  try {
    const match = new URL(raw).pathname.match(/\.([a-z0-9]{2,5})$/i);
    const extension = match?.[1]?.toLowerCase() === 'jpeg' ? 'jpg' : match?.[1]?.toLowerCase();
    return IMAGE_EXTENSIONS.has(extension) ? extension : '';
  } catch { return ''; }
}

export function imageMimeFromHeaders(headers = []) {
  const value = (Array.isArray(headers) ? headers : []).find(header =>
    String(header?.name || '').toLowerCase() === 'content-type')?.value || '';
  const mime = String(value).split(';')[0].trim().toLowerCase();
  return mime.startsWith('image/') ? mime : '';
}

export function imageContentLength(headers = []) {
  const list = Array.isArray(headers) ? headers : [];
  const range = list.find(header => String(header?.name || '').toLowerCase() === 'content-range')?.value || '';
  const total = Number(String(range).match(/\/(\d+)\s*$/)?.[1]);
  if (Number.isFinite(total) && total > 0) return total;
  const length = Number(list.find(header => String(header?.name || '').toLowerCase() === 'content-length')?.value);
  return Number.isFinite(length) && length > 0 ? length : 0;
}

export function canonicalImageFamilyKey(value) {
  const normalized = normalizedImageUrl(value);
  if (!normalized) return '';
  if (/^(?:data|blob):/i.test(normalized)) return 'inline:' + stableHash(normalized.slice(0, 8192));
  try {
    const url = new URL(normalized);
    for (const key of [...url.searchParams.keys()]) {
      if (FAMILY_QUERY_KEYS.has(key.toLowerCase())) url.searchParams.delete(key);
    }
    url.pathname = url.pathname
      .replace(/[_-]\d{2,5}x\d{2,5}(?=([_\-.\/]|$))/gi, '')
      .replace(/\/\d{2,5}x\d{2,5}(?=\/)/gi, '/')
      .replace(/[_-](thumb(?:nail)?|small|medium|large|original|full|hires)(?=([_\-.]|$))/gi, '')
      .replace(/\/{2,}/g, '/');
    url.searchParams.sort();
    return url.hostname.toLowerCase() + url.pathname + (url.search ? url.search : '');
  } catch { return normalized; }
}

function imageRecommendationScore(candidate) {
  const area = candidate.width && candidate.height ? candidate.width * candidate.height : 0;
  const descriptor = candidate.descriptorWidth || 0;
  const sourceRank = {
    'original-attribute': 950,
    'linked-image': 900,
    'structured-data': 850,
    'srcset': 780,
    'picture': 760,
    'current-src': 720,
    'image': 680,
    'network': 640,
    'css': 560,
    'inline-svg': 520,
    'canvas': 500,
    'page-resource': 420
  }[candidate.source] || 400;
  const url = candidate.url.toLowerCase();
  const positive = /(?:original|orig|full|large|hires|raw|download)/.test(url) ? 650 : 0;
  const negative = /(?:thumb|thumbnail|small|tiny|avatar|icon|sprite)/.test(url) ? 900 : 0;
  return candidate.originalHint * 1800 + sourceRank + positive - negative
    + Math.log2(Math.max(1, area)) * 55 + Math.log2(Math.max(1, descriptor)) * 35;
}

export function normalizeImageCandidate(raw = {}) {
  const url = normalizedImageUrl(raw.url);
  if (!url) return null;
  const mime = String(raw.mime || '').split(';')[0].trim().toLowerCase();
  if (mime && !mime.startsWith('image/')) return null;
  const extension = imageExtension(url, mime);
  const width = cleanNumber(raw.width);
  const height = cleanNumber(raw.height);
  const displayWidth = cleanNumber(raw.displayWidth);
  const displayHeight = cleanNumber(raw.displayHeight);
  const familyKey = String(raw.familyKey || '').slice(0, 400) || canonicalImageFamilyKey(url);
  const candidate = {
    id: 'image-' + stableHash(url),
    url,
    familyKey: familyKey || 'image-' + stableHash(url),
    source: String(raw.source || 'page-resource').slice(0, 40),
    width,
    height,
    displayWidth,
    displayHeight,
    descriptorWidth: cleanNumber(raw.descriptorWidth),
    contentLength: cleanNumber(raw.contentLength),
    mime: mime.startsWith('image/') ? mime : '',
    extension,
    alt: String(raw.alt || '').trim().slice(0, 300),
    title: String(raw.title || '').trim().slice(0, 300),
    originalHint: Math.max(0, Math.min(9, Number(raw.originalHint) || 0)),
    frameUrl: String(raw.frameUrl || '').slice(0, 1200),
    artifactId: String(raw.artifactId || '').slice(0, 160),
    discoveredAt: cleanNumber(raw.discoveredAt) || Date.now()
  };
  candidate.score = imageRecommendationScore(candidate);
  return candidate;
}

export function mergeImageCandidate(existing, incoming) {
  if (!existing) return incoming;
  if (!incoming) return existing;
  const preferred = incoming.score > existing.score ? incoming : existing;
  const merged = {
    ...existing,
    ...preferred,
    width: Math.max(existing.width || 0, incoming.width || 0),
    height: Math.max(existing.height || 0, incoming.height || 0),
    displayWidth: Math.max(existing.displayWidth || 0, incoming.displayWidth || 0),
    displayHeight: Math.max(existing.displayHeight || 0, incoming.displayHeight || 0),
    descriptorWidth: Math.max(existing.descriptorWidth || 0, incoming.descriptorWidth || 0),
    contentLength: Math.max(existing.contentLength || 0, incoming.contentLength || 0),
    originalHint: Math.max(existing.originalHint || 0, incoming.originalHint || 0),
    mime: existing.mime || incoming.mime,
    extension: existing.extension || incoming.extension,
    alt: existing.alt || incoming.alt,
    title: existing.title || incoming.title,
    artifactId: existing.artifactId || incoming.artifactId,
    discoveredAt: Math.min(existing.discoveredAt || Date.now(), incoming.discoveredAt || Date.now())
  };
  merged.score = imageRecommendationScore(merged);
  return merged;
}

export function groupImageCandidates(rawCandidates = []) {
  const byUrl = new Map();
  for (const raw of Array.isArray(rawCandidates) ? rawCandidates : []) {
    const candidate = normalizeImageCandidate(raw);
    if (!candidate) continue;
    byUrl.set(candidate.url, mergeImageCandidate(byUrl.get(candidate.url), candidate));
  }
  const groups = new Map();
  for (const candidate of byUrl.values()) {
    const key = candidate.familyKey || canonicalImageFamilyKey(candidate.url) || candidate.id;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(candidate);
  }
  return [...groups.entries()].map(([id, candidates]) => {
    candidates.sort((a, b) => b.score - a.score || b.width * b.height - a.width * a.height || a.url.localeCompare(b.url));
    return {
      id: 'family-' + stableHash(id),
      familyKey: id,
      recommended: candidates[0],
      candidates,
      selectedCandidateId: candidates[0].id
    };
  }).sort((a, b) =>
    (b.recommended.width * b.recommended.height) - (a.recommended.width * a.recommended.height)
    || b.recommended.score - a.recommended.score
    || a.id.localeCompare(b.id));
}

export function sanitizeImageFilename(value, extension = 'jpg', fallbackIndex = 1) {
  const requestedExtension = String(extension).toLowerCase();
  const ext = IMAGE_EXTENSIONS.has(requestedExtension) || requestedExtension === 'zip' ? requestedExtension : 'jpg';
  const base = String(value || '')
    .normalize('NFKC')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/g, '')
    .trim()
    .slice(0, 140);
  return `${base || `Image ${Math.max(1, Number(fallbackIndex) || 1)}`}.${ext}`;
}

export function formatImageBytes(value) {
  const bytes = Number(value) || 0;
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

export function imageLayout(width, height) {
  const w = cleanNumber(width);
  const h = cleanNumber(height);
  if (!w || !h) return 'unknown';
  if (Math.abs(w - h) / Math.max(w, h) <= 0.08) return 'square';
  return w > h ? 'wide' : 'tall';
}

export function imageSessionKey(tabId) {
  return `imageDownloadSession:${Number(tabId)}`;
}
