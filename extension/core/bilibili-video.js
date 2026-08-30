import { md5 } from './md5.js';

const MIXIN_INDEX = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35,
  27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13,
  37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4,
  22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52
];

const QUALITY_NAMES = new Map([
  [127, '8K'], [126, 'Dolby Vision'], [125, 'HDR'], [120, '4K'], [116, '1080p60'],
  [112, '1080p+'], [80, '1080p'], [74, '720p60'], [64, '720p'], [32, '480p'],
  [16, '360p'], [6, '240p']
]);

function fileUrl(value) {
  return String(value?.baseUrl || value?.base_url || value?.url || '');
}

function fileUrls(value) {
  const primary = fileUrl(value);
  const backups = value?.backupUrl || value?.backup_url || [];
  return [...new Set([primary, ...(Array.isArray(backups) ? backups : [backups])]
    .map(item => String(item || '')).filter(Boolean))];
}

function mixinKey(imageUrl, subUrl) {
  const raw = [imageUrl, subUrl].map(value => {
    try { return new URL(value).pathname.split('/').pop().split('.')[0]; }
    catch { return ''; }
  }).join('');
  return MIXIN_INDEX.map(index => raw[index] || '').join('').slice(0, 32);
}

function encodeWbi(value) {
  return encodeURIComponent(String(value)).replace(/[!'()*]/g, '');
}

export function signedBilibiliQuery(params, imageUrl, subUrl, now = Date.now()) {
  const values = { ...params, wts: Math.floor(now / 1000) };
  const query = Object.keys(values).sort().map(key => `${encodeWbi(key)}=${encodeWbi(values[key])}`).join('&');
  return `${query}&w_rid=${md5(query + mixinKey(imageUrl, subUrl))}`;
}

export function bilibiliPageContext() {
  const root = typeof window === 'object' ? window : globalThis;
  const assignedObject = name => {
    const assignment = new RegExp(`(?:window|globalThis)\\s*\\.\\s*${name}\\s*=`);
    for (const script of document.scripts || []) {
      const text = String(script.textContent || '');
      const markerAt = text.search(assignment);
      if (markerAt < 0 || text.length > 12 * 1024 * 1024) continue;
      const start = text.indexOf('{', markerAt);
      if (start < 0) continue;
      let depth = 0;
      let quoted = false;
      let escaped = false;
      for (let index = start; index < text.length; index += 1) {
        const character = text[index];
        if (quoted) {
          if (escaped) escaped = false;
          else if (character === '\\') escaped = true;
          else if (character === '"') quoted = false;
          continue;
        }
        if (character === '"') quoted = true;
        else if (character === '{') depth += 1;
        else if (character === '}' && --depth === 0) {
          try { return JSON.parse(text.slice(start, index + 1)); }
          catch { break; }
        }
      }
    }
    return null;
  };
  const jsonLd = [];
  for (const script of document.querySelectorAll?.('script[type="application/ld+json"]') || []) {
    try {
      const value = JSON.parse(script.textContent || '');
      if (Array.isArray(value)) jsonLd.push(...value);
      else if (value && typeof value === 'object') jsonLd.push(value);
    } catch {}
  }
  const href = String(root.location?.href || '');
  const urlVideoId = href.match(/\/video\/(BV[0-9A-Za-z]+|av\d+)/i)?.[1] || '';
  const embeddedVideoId = jsonLd
    .map(value => String(value?.embedUrl || value?.url || ''))
    .join(' ')
    .match(/(?:bvid=|\/video\/)(BV[0-9A-Za-z]+)/i)?.[1] || '';
  const state = root.__INITIAL_STATE__ || assignedObject('__INITIAL_STATE__') || {};
  const internationalState = root.__initialState || assignedObject('__initialState') || {};
  const playInfo = root.__playinfo__ || root.__PLAYINFO__
    || assignedObject('__playinfo__') || assignedObject('__PLAYINFO__') || null;
  const videoData = state.videoData || state.videoInfo || {};
  const epInfo = state.epInfo || {};
  const pages = Array.isArray(videoData.pages) ? videoData.pages : [];
  const currentPage = pages.find(page => Number(page.cid) === Number(videoData.cid || epInfo.cid)) || pages[0] || {};
  let pageNumber = 1;
  try { pageNumber = Math.max(1, Number(new URL(href).searchParams.get('p') || 1) || 1); }
  catch {}
  const structuredTitle = jsonLd.find(value => String(value?.['@type'] || '').toLowerCase() === 'videoobject')?.name || '';
  return {
    bvid: String(videoData.bvid || state.bvid || epInfo.bvid
      || (/^BV/i.test(urlVideoId) ? urlVideoId : '') || embeddedVideoId || ''),
    aid: Number(videoData.aid || state.aid || epInfo.aid
      || (/^av\d+$/i.test(urlVideoId) ? urlVideoId.slice(2) : 0) || 0),
    cid: Number(videoData.cid || state.cid || epInfo.cid || currentPage.cid || 0),
    pageNumber,
    internationalEpisodeId: Number(internationalState?.ogv?.epId?._value || 0),
    internationalAid: Number(internationalState?.ugc?.aid?._value || 0),
    title: String(videoData.title || epInfo.long_title || epInfo.title || structuredTitle || document.title || '').trim(),
    pageTitle: String(currentPage.part || '').trim(),
    playInfo: playInfo && typeof playInfo === 'object' ? playInfo : null
  };
}

export async function completeBilibiliPageContext(context, fetchJson) {
  if (!context || context.playInfo?.data?.dash || context.playInfo?.result?.dash || context.playInfo?.dash) return context;
  if (context.cid && (context.bvid || context.aid)) return context;
  if (!context.bvid && !context.aid) return context;
  const identifier = context.bvid
    ? `bvid=${encodeURIComponent(context.bvid)}`
    : `aid=${encodeURIComponent(context.aid)}`;
  const response = await fetchJson(`https://api.bilibili.com/x/web-interface/view?${identifier}`);
  const video = response?.data || {};
  const pages = Array.isArray(video.pages) ? video.pages : [];
  const selected = pages[Math.max(0, Number(context.pageNumber || 1) - 1)] || pages[0] || {};
  return {
    ...context,
    bvid: String(context.bvid || video.bvid || ''),
    aid: Number(context.aid || video.aid || 0),
    cid: Number(context.cid || selected.cid || video.cid || 0),
    title: String(context.title || video.title || '').trim(),
    pageTitle: String(context.pageTitle || selected.part || '').trim()
  };
}

function codecFamily(value) {
  const codec = String(value || '').toLowerCase();
  if (codec.includes('av01') || codec.includes('av1')) return 'AV1';
  if (codec.includes('hev') || codec.includes('hvc')) return 'HEVC';
  if (codec.includes('avc')) return 'AVC';
  return codec ? codec.toUpperCase() : '';
}

function audioPool(dash) {
  const audio = [...(Array.isArray(dash?.audio) ? dash.audio : [])];
  if (Array.isArray(dash?.dolby?.audio)) audio.push(...dash.dolby.audio);
  if (dash?.flac?.audio) audio.push(dash.flac.audio);
  return audio.filter(item => fileUrl(item));
}

function preferredAudio(dash) {
  const audio = audioPool(dash);
  const aac = audio.filter(item => String(item.mimeType || item.mime_type || '').includes('mp4')
    || String(item.codecs || '').toLowerCase().includes('mp4a'));
  return (aac.length ? aac : audio).sort((left, right) =>
    Number(right.bandwidth || right.size || 0) - Number(left.bandwidth || left.size || 0))[0] || null;
}

export function bilibiliDashCandidates(payload, context = {}) {
  const international = payload?.data?.playurl;
  const body = payload?.data?.dash ? payload.data : payload?.result?.dash ? payload.result : payload?.dash ? payload : null;
  const dash = international ? {
    audio: Array.isArray(international.audio_resource) ? international.audio_resource : [],
    video: Array.isArray(international.video)
      ? international.video.map(item => item?.video_resource).filter(Boolean)
      : []
  } : body?.dash;
  if (!dash || !Array.isArray(dash.video)) return [];
  const audio = preferredAudio(dash);
  const duration = Number(body?.timelength || international?.duration || context.timelength || 0)
    / (body?.timelength ? 1000 : 1);
  const title = [context.title, context.pageTitle].filter(Boolean).join(' · ');
  const candidates = dash.video.filter(video => fileUrl(video)).map(video => {
    const videoUrls = fileUrls(video);
    const audioUrls = fileUrls(audio);
    const videoUrl = videoUrls[0] || '';
    const audioUrl = audioUrls[0] || '';
    const qualityId = Number(video.id || video.quality || 0);
    const width = Number(video.width || 0);
    const height = Number(video.height || 0);
    const videoCodec = String(video.codecs || '');
    const audioCodec = String(audio?.codecs || '');
    return {
      url: videoUrl,
      videoUrl,
      audioUrl,
      videoBackupUrls: videoUrls.slice(1),
      audioBackupUrls: audioUrls.slice(1),
      kind: audioUrl ? 'muxed' : 'direct',
      source: 'bilibili',
      title,
      width,
      height,
      duration,
      bandwidth: Number(video.bandwidth || 0) + Number(audio?.bandwidth || 0),
      contentLength: Number(video.size || 0) + Number(audio?.size || 0),
      mime: 'video/mp4',
      extension: 'mp4',
      codecs: [videoCodec, audioCodec].filter(Boolean).join(', '),
      videoCodec,
      audioCodec,
      hasAudio: Boolean(audioUrl),
      qualityId,
      qualityLabel: QUALITY_NAMES.get(qualityId) || (height ? `${height}p` : ''),
      codecLabel: codecFamily(videoCodec),
      frameRate: String(video.frameRate || video.frame_rate || ''),
      downloadable: true
    };
  });
  const audioUrls = fileUrls(audio);
  if (audioUrls.length) {
    const audioMime = String(audio?.mimeType || audio?.mime_type || 'audio/mp4');
    candidates.push({
      url: audioUrls[0],
      videoBackupUrls: audioUrls.slice(1),
      kind: 'audio',
      source: 'bilibili',
      title,
      duration,
      bandwidth: Number(audio?.bandwidth || 0),
      contentLength: Number(audio?.size || 0),
      mime: audioMime,
      extension: audioMime.includes('webm') ? 'webm' : 'm4a',
      audioCodec: String(audio?.codecs || ''),
      hasAudio: true,
      downloadable: true
    });
  }
  return candidates;
}

export async function fetchBilibiliPlayInfo(context, fetchJson, now = Date.now()) {
  const embedded = context?.playInfo;
  if (embedded?.data?.dash || embedded?.result?.dash || embedded?.dash) return embedded;
  if (context?.internationalEpisodeId || context?.internationalAid) {
    const identifier = context.internationalEpisodeId
      ? `ep_id=${encodeURIComponent(context.internationalEpisodeId)}`
      : `aid=${encodeURIComponent(context.internationalAid)}`;
    return fetchJson(`https://api.bilibili.tv/intl/gateway/web/playurl?s_locale=en_US&platform=web&${identifier}&qn=64&type=0&device=wap&tf=0`);
  }
  if ((!context?.bvid && !context?.aid) || !context?.cid) throw new Error('Bilibili video information is unavailable.');
  const navigation = await fetchJson('https://api.bilibili.com/x/web-interface/nav');
  const imageUrl = navigation?.data?.wbi_img?.img_url;
  const subUrl = navigation?.data?.wbi_img?.sub_url;
  if (!imageUrl || !subUrl) throw new Error('Bilibili playback authorization is unavailable.');
  const params = {
    ...(context.bvid ? { bvid: context.bvid } : { avid: context.aid }),
    cid: context.cid,
    qn: 127,
    fnval: 4048,
    fourk: 1,
    try_look: 1
  };
  const query = signedBilibiliQuery(params, imageUrl, subUrl, now);
  return fetchJson(`https://api.bilibili.com/x/player/wbi/playurl?${query}`);
}
