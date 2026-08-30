function extractVideoId(value) {
  try {
    const url = new URL(value);
    if (url.hostname === 'youtu.be') return url.pathname.split('/').filter(Boolean)[0] || '';
    if (url.searchParams.get('v')) return url.searchParams.get('v');
    const match = url.pathname.match(/\/(?:embed|shorts|live|v)\/([^/?#]+)/);
    return match?.[1] || '';
  } catch { return ''; }
}

export function youtubePageContext() {
  const config = globalThis.ytcfg?.data_ || globalThis.ytcfg?.data || {};
  const player = globalThis.ytInitialPlayerResponse || {};
  return {
    videoId: extractVideoId(location.href),
    visitorData: String(config.VISITOR_DATA || player.responseContext?.visitorData || ''),
    title: String(player.videoDetails?.title || document.title || '').trim()
  };
}

function containerFromMime(value) {
  const mime = String(value || '').split(';', 1)[0].trim().toLowerCase();
  if (mime.includes('webm')) return 'webm';
  if (mime.includes('mp4')) return 'mp4';
  return '';
}

function codecFromMime(value) {
  return String(value || '').match(/codecs="([^"]+)"/i)?.[1] || '';
}

function videoCodecLabel(value) {
  const codec = codecFromMime(value).toLowerCase();
  if (codec.includes('av01')) return 'AV1';
  if (codec.includes('vp9') || codec.includes('vp09')) return 'VP9';
  if (codec.includes('avc')) return 'AVC';
  return '';
}

function protectedFormat(format) {
  return Boolean(format?.drm_track_type || format?.drm_families?.length || format?.fair_play_key_uri);
}

function bestAudioByContainer(formats) {
  const result = new Map();
  for (const format of formats) {
    if (!format?.has_audio || format.has_video || protectedFormat(format)) continue;
    const container = containerFromMime(format.mime_type);
    if (!container) continue;
    const existing = result.get(container);
    const preferred = format.is_original === true ? 1 : 0;
    const existingPreferred = existing?.is_original === true ? 1 : 0;
    if (!existing || preferred > existingPreferred || (preferred === existingPreferred && Number(format.bitrate || 0) > Number(existing.bitrate || 0))) {
      result.set(container, format);
    }
  }
  return result;
}

async function mediaUrl(format, player, cpn) {
  const url = await format.decipher(player);
  if (!url) return '';
  try {
    const value = new URL(url);
    if (cpn && !value.searchParams.has('cpn')) value.searchParams.set('cpn', cpn);
    return value.href;
  } catch { return url; }
}

export async function youtubeCandidates(info, innertube, titleFallback = '') {
  const streaming = info?.streaming_data;
  if (!streaming) return [];
  const formats = [...(streaming.adaptive_formats || []), ...(streaming.formats || [])];
  const audioByContainer = bestAudioByContainer(formats);
  const title = String(info.basic_info?.title || titleFallback || 'Video');
  const duration = Number(info.basic_info?.duration || 0);
  const candidates = [];
  if (streaming.hls_manifest_url) {
    candidates.push({
      url: streaming.hls_manifest_url,
      kind: 'hls',
      source: 'youtube',
      title,
      duration,
      qualityLabel: info.basic_info?.is_live ? 'Live' : 'HLS',
      downloadable: true
    });
  }
  for (const format of formats) {
    if (!format?.has_video) continue;
    const protectedMedia = protectedFormat(format);
    const container = containerFromMime(format.mime_type);
    const audio = format.has_audio ? null : audioByContainer.get(container);
    const videoUrl = protectedMedia ? '' : await mediaUrl(format, innertube.session.player, info.cpn).catch(() => '');
    const audioUrl = audio ? await mediaUrl(audio, innertube.session.player, info.cpn).catch(() => '') : '';
    if (!videoUrl && !protectedMedia) continue;
    candidates.push({
      url: videoUrl || `https://www.youtube.com/watch?v=${info.basic_info?.id || ''}#format=${format.itag}`,
      videoUrl,
      audioUrl,
      kind: audioUrl ? 'muxed' : 'direct',
      source: 'youtube',
      title,
      mime: String(format.mime_type || ''),
      extension: container || 'mp4',
      outputContainer: audioUrl && container === 'webm' ? 'mkv' : (container || 'mp4'),
      width: Number(format.width || 0),
      height: Number(format.height || 0),
      duration: Number(format.approx_duration_ms || 0) / 1000 || duration,
      contentLength: Number(format.content_length || 0) + Number(audio?.content_length || 0),
      bandwidth: Number(format.bitrate || 0) + Number(audio?.bitrate || 0),
      videoCodec: codecFromMime(format.mime_type),
      audioCodec: codecFromMime(audio?.mime_type),
      codecLabel: videoCodecLabel(format.mime_type),
      qualityLabel: String(format.quality_label || (format.height ? `${format.height}p` : '')),
      frameRate: String(format.fps || ''),
      protected: protectedMedia,
      downloadable: Boolean(videoUrl) && (!audio || Boolean(audioUrl)) && !protectedMedia
    });
  }
  const captionTracks = info.captions?.caption_tracks || info.page?.[0]?.captions?.caption_tracks || [];
  for (const caption of captionTracks) {
    const base = String(caption.base_url || '');
    if (!base) continue;
    const url = new URL(base);
    url.searchParams.set('fmt', 'vtt');
    const languageLabel = String(caption.name?.text || caption.display_name || caption.language_code || 'Subtitles');
    candidates.push({
      url: url.href,
      kind: 'subtitle',
      source: 'youtube-subtitle',
      title: `${title} · ${languageLabel}`,
      mime: 'text/vtt',
      extension: 'vtt',
      languageLabel,
      qualityLabel: languageLabel,
      downloadable: true
    });
  }
  return candidates;
}
