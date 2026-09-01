export const VIDEO_SESSION_PREFIX = 'videoDownloadSession:';

export function recoverInterruptedVideoCandidates(candidates = []) {
  const requestIds = [];
  let changed = false;
  const recovered = candidates.map(candidate => {
    if (candidate?.status !== 'preparing') return candidate;
    const requestId = String(candidate.processingRequestId || '');
    if (requestId) requestIds.push(requestId);
    changed = true;
    return {
      ...candidate,
      status: 'ready',
      progress: 0,
      processingRequestId: '',
      error: ''
    };
  });
  return { candidates: recovered, requestIds, changed };
}

const DIRECT_EXTENSIONS = new Set(['mp4', 'webm', 'mov', 'mkv', 'm4v', 'ogv']);
const SEGMENT_EXTENSIONS = new Set(['m4s', 'cmfv', 'cmfa', 'ts', 'aac']);
const HLS_MIME = new Set([
  'application/vnd.apple.mpegurl',
  'application/x-mpegurl',
  'audio/mpegurl',
  'audio/x-mpegurl'
]);

function cleanMime(value) {
  return String(value || '').slice(0, 1000).split(';', 1)[0].trim().toLowerCase();
}

function safeUrl(value, base) {
  try {
    const url = new URL(value, base);
    return ['http:', 'https:'].includes(url.protocol) && url.href.length <= 32_000 ? url.href : '';
  } catch { return ''; }
}

function safeUrlList(values, base, exclude = '') {
  const list = (Array.isArray(values) ? values : values ? [values] : []).slice(0, 16);
  return [...new Set(list.map(value => safeUrl(value, base)).filter(value => value && value !== exclude))].slice(0, 8);
}

function extensionFromUrl(value) {
  try {
    const match = new URL(value).pathname.match(/\.([a-z0-9]{2,5})$/i);
    return match ? match[1].toLowerCase() : '';
  } catch { return ''; }
}

function numberOrZero(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function responseContentLength(input) {
  const contentRange = headerValue(input.responseHeaders, 'content-range');
  const total = contentRange.match(/\/(\d+)\s*$/)?.[1];
  return numberOrZero(total)
    || numberOrZero(input.contentLength || headerValue(input.responseHeaders, 'content-length'));
}

export function stableVideoCandidateId(value) {
  const text = String(value || '');
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return 'video_' + (hash >>> 0).toString(36) + '_' + text.length.toString(36);
}

export function mediaRequestUrls(candidate = {}) {
  return [...new Set([
    candidate.url,
    candidate.videoUrl,
    candidate.audioUrl,
    candidate.manifestUrl,
    candidate.manifestBaseUrl,
    ...(Array.isArray(candidate.videoBackupUrls) ? candidate.videoBackupUrls : []),
    ...(Array.isArray(candidate.audioBackupUrls) ? candidate.audioBackupUrls : [])
  ].map(value => safeUrl(value)).filter(Boolean))];
}

export function mediaRequestDirectoryFilters(candidate = {}) {
  return [...new Set(mediaRequestUrls(candidate).map(value => {
    try { return new URL('.', value).href + '*'; }
    catch { return ''; }
  }).filter(Boolean))];
}

export function mediaRequestReferrer(pageUrl) {
  try {
    const url = new URL(pageUrl);
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    url.search = '';
    url.hash = '';
    return url.href;
  } catch { return ''; }
}

export function headerValue(headers, name) {
  const target = String(name || '').toLowerCase();
  const entry = (Array.isArray(headers) ? headers.slice(0, 100) : []).find(header =>
    String(header?.name || '').toLowerCase() === target);
  return String(entry?.value || '');
}

export function classifyVideoResource(input = {}) {
  const videoUrl = safeUrl(input.videoUrl || input.url);
  const audioUrl = safeUrl(input.audioUrl);
  const url = safeUrl(input.url || videoUrl);
  if (!url) return null;
  const mime = cleanMime(input.mime || headerValue(input.responseHeaders, 'content-type'));
  const extension = String(input.extension || extensionFromUrl(url)).toLowerCase();
  let kind = '';

  if (['hls', 'dash', 'direct', 'muxed', 'audio', 'subtitle'].includes(input.kind)) kind = input.kind;
  else if (HLS_MIME.has(mime) || extension === 'm3u8') kind = 'hls';
  else if (mime === 'application/dash+xml' || extension === 'mpd') kind = 'dash';
  else if (mime.startsWith('video/') || DIRECT_EXTENSIONS.has(extension)) kind = 'direct';
  else if (SEGMENT_EXTENSIONS.has(extension)) return null;
  else return null;

  const width = numberOrZero(input.width);
  const height = numberOrZero(input.height);
  const duration = numberOrZero(input.duration);
  const contentLength = responseContentLength(input);
  const title = String(input.title || '').trim().slice(0, 240);
  const signature = [
    kind,
    url,
    videoUrl,
    audioUrl,
    String(input.qualityId || '').slice(0, 40),
    String(input.videoCodec || '').slice(0, 120),
    String(input.representationId || '').slice(0, 240),
    String(input.inlineId || '').slice(0, 240)
  ].join('|');
  return {
    id: String(input.id || stableVideoCandidateId(signature)).slice(0, 240),
    url,
    videoUrl: videoUrl || url,
    audioUrl,
    videoBackupUrls: safeUrlList(input.videoBackupUrls || input.backupUrls, undefined, videoUrl || url),
    audioBackupUrls: safeUrlList(input.audioBackupUrls, undefined, audioUrl),
    kind,
    mime,
    extension,
    width,
    height,
    duration,
    contentLength,
    bandwidth: numberOrZero(input.bandwidth),
    title,
    source: String(input.source || 'network').slice(0, 80),
    downloadable: typeof input.downloadable === 'boolean' ? input.downloadable : kind !== 'dash',
    status: String(input.status || 'ready').slice(0, 30),
    progress: numberOrZero(input.progress),
    codecs: String(input.codecs || '').slice(0, 300),
    videoCodec: String(input.videoCodec || '').slice(0, 120),
    audioCodec: String(input.audioCodec || '').slice(0, 120),
    hasAudio: input.hasAudio === true || Boolean(audioUrl),
    audioLanguage: String(input.audioLanguage || '').slice(0, 80),
    languageLabel: String(input.languageLabel || '').slice(0, 160),
    codecLabel: String(input.codecLabel || '').slice(0, 160),
    qualityId: numberOrZero(input.qualityId),
    qualityLabel: String(input.qualityLabel || '').slice(0, 160),
    frameRate: String(input.frameRate || '').slice(0, 40),
    outputContainer: String(input.outputContainer || '').slice(0, 20),
    inlineId: String(input.inlineId || '').slice(0, 240),
    manifestText: String(input.manifestText || '').slice(0, 2 * 1024 * 1024),
    manifestBaseUrl: safeUrl(input.manifestBaseUrl || input.manifestUrl || url),
    representationId: String(input.representationId || '').slice(0, 240),
    audioRepresentationId: String(input.audioRepresentationId || '').slice(0, 240),
    manifestUrl: safeUrl(input.manifestUrl),
    protected: input.protected === true,
    master: input.master === true
  };
}

export function limitVideoCandidatesForSession(candidates, maxCount = 80, maxCharacters = 2_500_000) {
  const list = Array.isArray(candidates) ? candidates : [];
  const retainedStatus = new Set(['preparing', 'downloading', 'complete']);
  const required = list.filter(candidate => candidate?.artifactId || retainedStatus.has(candidate?.status));
  const optional = list.filter(candidate => !candidate?.artifactId && !retainedStatus.has(candidate?.status));
  const selected = new Set();
  let characters = 0;
  for (const candidate of required) {
    if (!candidate) continue;
    let size;
    try { size = JSON.stringify(candidate).length; }
    catch { continue; }
    selected.add(candidate);
    characters += size;
  }
  for (const candidate of optional) {
    if (!candidate || selected.size >= maxCount) break;
    let size;
    try { size = JSON.stringify(candidate).length; }
    catch { continue; }
    if (characters + size > maxCharacters) continue;
    selected.add(candidate);
    characters += size;
  }
  return list.filter(candidate => selected.has(candidate));
}

export function mergeVideoCandidate(existing, incoming) {
  if (!existing) return { ...incoming };
  const preferred = { ...existing };
  for (const key of [
    'mime', 'extension', 'title', 'source', 'videoUrl', 'audioUrl', 'codecs',
    'videoCodec', 'audioCodec', 'audioLanguage', 'languageLabel', 'codecLabel', 'qualityLabel', 'frameRate',
    'representationId', 'audioRepresentationId', 'manifestUrl', 'outputContainer',
    'inlineId', 'manifestText', 'manifestBaseUrl'
  ]) {
    if (!preferred[key] && incoming[key]) preferred[key] = incoming[key];
  }
  for (const key of ['videoBackupUrls', 'audioBackupUrls']) {
    preferred[key] = [...new Set([...(preferred[key] || []), ...(incoming[key] || [])])].slice(0, 8);
  }
  for (const key of ['width', 'height', 'duration', 'contentLength', 'bandwidth', 'qualityId']) {
    preferred[key] = Math.max(numberOrZero(preferred[key]), numberOrZero(incoming[key]));
  }
  if (existing.kind === 'direct' && incoming.kind !== 'direct') preferred.kind = incoming.kind;
  if (incoming.downloadable === true) preferred.downloadable = true;
  else if (incoming.downloadable === false && preferred.downloadable !== true) preferred.downloadable = false;
  if (incoming.protected === true) preferred.protected = true;
  if (incoming.hasAudio === true) preferred.hasAudio = true;
  return preferred;
}

function parseAttributeList(value) {
  const result = {};
  const pattern = /([A-Z0-9-]+)=((?:"[^"]*")|(?:[^,]*))(?:,|$)/gi;
  for (const match of String(value || '').matchAll(pattern)) {
    const raw = match[2].trim();
    result[match[1].toUpperCase()] = raw.startsWith('"') && raw.endsWith('"') ? raw.slice(1, -1) : raw;
  }
  return result;
}

export function parseHlsMaster(text, manifestUrl) {
  const lines = String(text || '').replace(/\r/g, '').split('\n');
  const variants = [];
  const audioGroups = new Map();
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line.startsWith('#EXT-X-MEDIA:')) continue;
    const attributes = parseAttributeList(line.slice(line.indexOf(':') + 1));
    if (String(attributes.TYPE || '').toUpperCase() !== 'AUDIO' || !attributes.URI || !attributes['GROUP-ID']) continue;
    const item = {
      url: safeUrl(attributes.URI, manifestUrl),
      name: String(attributes.NAME || ''),
      language: String(attributes.LANGUAGE || ''),
      preferred: String(attributes.DEFAULT || '').toUpperCase() === 'YES'
    };
    if (!item.url) continue;
    const group = audioGroups.get(attributes['GROUP-ID']) || [];
    group.push(item);
    audioGroups.set(attributes['GROUP-ID'], group);
  }
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line.startsWith('#EXT-X-STREAM-INF:')) continue;
    const attributes = parseAttributeList(line.slice(line.indexOf(':') + 1));
    let uri = '';
    for (let next = index + 1; next < lines.length; next += 1) {
      const value = lines[next].trim();
      if (!value || value.startsWith('#')) continue;
      uri = safeUrl(value, manifestUrl);
      index = next;
      break;
    }
    if (!uri) continue;
    const resolution = String(attributes.RESOLUTION || '').match(/^(\d+)x(\d+)$/i);
    const audio = (audioGroups.get(attributes.AUDIO) || [])
      .sort((left, right) => Number(right.preferred) - Number(left.preferred))[0];
    variants.push({
      url: uri,
      videoUrl: uri,
      audioUrl: audio?.url || '',
      audioLanguage: audio?.language || '',
      bandwidth: numberOrZero(attributes['AVERAGE-BANDWIDTH'] || attributes.BANDWIDTH),
      width: resolution ? numberOrZero(resolution[1]) : 0,
      height: resolution ? numberOrZero(resolution[2]) : 0,
      codecs: String(attributes.CODECS || ''),
      name: String(attributes.NAME || '')
    });
  }
  return variants.sort((a, b) => (b.height - a.height) || (b.bandwidth - a.bandwidth));
}

function parseByteRange(value, previousEnd = 0) {
  const match = String(value || '').match(/^(\d+)(?:@(\d+))?$/);
  if (!match) return null;
  const length = Number(match[1]);
  const start = match[2] === undefined ? previousEnd : Number(match[2]);
  return { start, end: start + length - 1 };
}

function parseIv(value, sequence) {
  const bytes = new Uint8Array(16);
  const raw = String(value || '').replace(/^0x/i, '');
  if (/^[a-f0-9]{1,32}$/i.test(raw)) {
    const padded = raw.padStart(32, '0');
    for (let index = 0; index < 16; index += 1) bytes[index] = Number.parseInt(padded.slice(index * 2, index * 2 + 2), 16);
    return bytes;
  }
  let number = Math.max(0, Number(sequence) || 0);
  for (let index = 15; index >= 0 && number > 0; index -= 1) {
    bytes[index] = number & 255;
    number = Math.floor(number / 256);
  }
  return bytes;
}

export function parseHlsMedia(text, manifestUrl) {
  const lines = String(text || '').replace(/\r/g, '').split('\n');
  const segments = [];
  let mediaSequence = 0;
  let duration = 0;
  let pendingDuration = 0;
  let pendingRange = null;
  let previousRangeEnd = 0;
  let map = null;
  let key = null;
  let unsupportedEncryption = false;
  let ended = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith('#EXT-X-MEDIA-SEQUENCE:')) mediaSequence = numberOrZero(line.split(':')[1]);
    else if (line.startsWith('#EXTINF:')) pendingDuration = Number.parseFloat(line.slice(8)) || 0;
    else if (line.startsWith('#EXT-X-BYTERANGE:')) pendingRange = parseByteRange(line.slice(17), previousRangeEnd);
    else if (line.startsWith('#EXT-X-MAP:')) {
      const attributes = parseAttributeList(line.slice(11));
      const url = safeUrl(attributes.URI, manifestUrl);
      map = url ? { url, range: parseByteRange(attributes.BYTERANGE) } : null;
    } else if (line.startsWith('#EXT-X-KEY:')) {
      const attributes = parseAttributeList(line.slice(11));
      const method = String(attributes.METHOD || '').toUpperCase();
      if (method === 'NONE') key = null;
      else if (method === 'AES-128') {
        const url = safeUrl(attributes.URI, manifestUrl);
        key = url ? { method, url, iv: attributes.IV || '' } : null;
      } else if (method) {
        unsupportedEncryption = true;
        key = { method, url: safeUrl(attributes.URI, manifestUrl), iv: attributes.IV || '' };
      }
    } else if (line === '#EXT-X-ENDLIST') ended = true;
    else if (!line.startsWith('#')) {
      const url = safeUrl(line, manifestUrl);
      if (!url) continue;
      const sequence = mediaSequence + segments.length;
      segments.push({
        url,
        duration: pendingDuration,
        range: pendingRange,
        map,
        key: key ? { ...key, ivBytes: Array.from(parseIv(key.iv, sequence)) } : null,
        sequence
      });
      duration += pendingDuration;
      if (pendingRange) previousRangeEnd = pendingRange.end + 1;
      pendingDuration = 0;
      pendingRange = null;
    }
  }
  return { segments, duration, ended, unsupportedEncryption };
}

export function selectHlsVariant(variants, preferredQuality = 'best') {
  if (!Array.isArray(variants) || !variants.length) return null;
  const sorted = [...variants].sort((a, b) => (b.height - a.height) || (b.bandwidth - a.bandwidth));
  if (preferredQuality === 'best') return sorted[0];
  const limit = numberOrZero(preferredQuality);
  return sorted.find(variant => variant.height && variant.height <= limit) || sorted.at(-1);
}

export function candidateQuality(candidate = {}) {
  if (candidate.qualityLabel) return String(candidate.qualityLabel);
  if (numberOrZero(candidate.height)) return candidate.height + 'p';
  if (numberOrZero(candidate.bandwidth)) return Math.round(candidate.bandwidth / 1000) + ' kbps';
  if (candidate.kind === 'hls') return 'HLS';
  if (candidate.kind === 'dash') return 'DASH';
  return String(candidate.extension || candidate.mime || '').replace('video/', '').toUpperCase() || 'Video';
}

function candidateType(candidate) {
  if (candidate.kind === 'subtitle') return 'subtitle';
  if (candidate.kind === 'audio') return 'audio';
  return 'video';
}

function compactCandidateKey(candidate) {
  const type = candidateType(candidate);
  if (type === 'audio') return 'audio';
  if (type === 'subtitle') {
    return `subtitle:${String(candidate.languageLabel || candidate.qualityLabel || candidate.audioLanguage || 'default').trim().toLowerCase()}`;
  }
  const label = String(candidate.qualityLabel || '').trim().toLowerCase();
  if (label) return `video:${label}`;
  if (numberOrZero(candidate.height)) return `video:${numberOrZero(candidate.height)}p`;
  if (candidate.kind === 'hls') return 'video:hls';
  if (candidate.kind === 'dash') return 'video:dash';
  return `video:${String(candidate.extension || candidate.mime || 'default').toLowerCase()}`;
}

function compactCandidateScore(candidate) {
  const statusRank = ['preparing', 'downloading', 'complete'].includes(candidate.status) ? 500 : candidate.status === 'failed' ? -100 : 0;
  const kindRank = { direct: 45, muxed: 40, hls: 30, dash: 25, audio: 20, subtitle: 10 };
  const codec = String(candidate.codecLabel || candidate.videoCodec || candidate.audioCodec || '').toLowerCase();
  const codecRank = codec.includes('avc') || codec.includes('h264') ? 8
    : codec.includes('mp4a') || codec.includes('aac') ? 8
    : codec.includes('vp9') || codec.includes('vp09') ? 6
    : codec.includes('opus') ? 6
    : codec.includes('av1') || codec.includes('av01') ? 5
    : codec.includes('hev') || codec.includes('hvc') ? 4 : 0;
  return statusRank
    + (candidate.downloadable === false ? -1000 : 100)
    + (candidate.protected ? -500 : 0)
    + (candidate.hasAudio ? 20 : 0)
    + (kindRank[candidate.kind] || 0)
    + codecRank
    + Math.min(9, Math.round(numberOrZero(candidate.bandwidth) / 1_000_000));
}

export function compactVideoCandidates(candidates, preferredId = '') {
  const groups = new Map();
  for (const candidate of Array.isArray(candidates) ? candidates : []) {
    if (!candidate || candidate.master) continue;
    const key = compactCandidateKey(candidate);
    const current = groups.get(key);
    if (!current || candidate.id === preferredId
      || (current.id !== preferredId && compactCandidateScore(candidate) > compactCandidateScore(current))) {
      groups.set(key, candidate);
    }
  }
  const typeRank = { video: 0, audio: 1, subtitle: 2 };
  return [...groups.values()].sort((left, right) => {
    const leftType = candidateType(left);
    const rightType = candidateType(right);
    return typeRank[leftType] - typeRank[rightType]
      || numberOrZero(right.height) - numberOrZero(left.height)
      || numberOrZero(right.qualityId) - numberOrZero(left.qualityId)
      || numberOrZero(right.bandwidth) - numberOrZero(left.bandwidth)
      || String(left.languageLabel || '').localeCompare(String(right.languageLabel || ''));
  });
}

export function formatMediaDuration(value) {
  const seconds = Math.round(numberOrZero(value));
  if (!seconds) return '';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  if (hours) return `${hours}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
  return `${minutes}:${String(remainder).padStart(2, '0')}`;
}

export function sanitizeVideoFilename(title, extension = 'mp4') {
  const safeExtension = /^[a-z0-9]{2,5}$/i.test(extension) ? extension.toLowerCase() : 'mp4';
  const base = String(title || 'Video')
    .normalize('NFKC')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
    .replace(/[. ]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 150) || 'Video';
  return `${base}.${safeExtension}`;
}

export function videoSessionKey(tabId) {
  return VIDEO_SESSION_PREFIX + tabId;
}
