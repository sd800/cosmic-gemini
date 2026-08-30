function childElements(element, name) {
  return Array.from(element?.children || []).filter(child => child.localName === name);
}

function firstChild(element, name) {
  return childElements(element, name)[0] || null;
}

function attr(element, name, fallback = '') {
  return element?.getAttribute?.(name) ?? fallback;
}

function number(value, fallback = 0) {
  const result = Number(value);
  return Number.isFinite(result) ? result : fallback;
}

function absoluteUrl(value, base) {
  try { return new URL(value, base).href; }
  catch { return ''; }
}

export function parseIsoDuration(value) {
  const match = String(value || '').match(/^P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/i);
  if (!match) return 0;
  return number(match[1]) * 86400 + number(match[2]) * 3600 + number(match[3]) * 60 + number(match[4]);
}

export function expandDashTemplate(template, values = {}) {
  const escaped = String(template || '').replace(/\$\$/g, '\u0000');
  return escaped.replace(/\$(RepresentationID|Bandwidth|Number|Time)(?:%0(\d+)d)?\$/g, (_, key, width) => {
    const raw = String(values[key] ?? '');
    return width ? raw.padStart(Number(width), '0') : raw;
  }).replace(/\u0000/g, '$');
}

function inheritedBaseUrl(chain, manifestUrl) {
  let base = manifestUrl;
  for (const element of chain) {
    const node = firstChild(element, 'BaseURL');
    if (node?.textContent?.trim()) base = absoluteUrl(node.textContent.trim(), base);
  }
  return base;
}

function combinedTemplate(adaptation, representation) {
  const parent = firstChild(adaptation, 'SegmentTemplate');
  const own = firstChild(representation, 'SegmentTemplate');
  if (!parent && !own) return null;
  const get = name => attr(own, name, attr(parent, name));
  return {
    initialization: get('initialization'),
    media: get('media'),
    timescale: number(get('timescale'), 1),
    duration: number(get('duration')),
    startNumber: number(get('startNumber'), 1),
    presentationTimeOffset: number(get('presentationTimeOffset')),
    timeline: firstChild(own, 'SegmentTimeline') || firstChild(parent, 'SegmentTimeline')
  };
}

function templateParts(template, representation, baseUrl, periodDuration) {
  if (!template?.media) return [];
  const values = {
    RepresentationID: attr(representation, 'id'),
    Bandwidth: attr(representation, 'bandwidth'),
    Number: template.startNumber,
    Time: 0
  };
  const parts = [];
  if (template.initialization) {
    parts.push({ url: absoluteUrl(expandDashTemplate(template.initialization, values), baseUrl), range: null, initialization: true });
  }
  if (template.timeline) {
    const entries = childElements(template.timeline, 'S');
    let time = 0;
    let sequence = template.startNumber;
    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index];
      const duration = number(attr(entry, 'd'));
      if (!duration) continue;
      if (attr(entry, 't') !== '') time = number(attr(entry, 't'));
      let repeat = number(attr(entry, 'r'));
      if (repeat < 0) {
        const nextTime = number(attr(entries[index + 1], 't'));
        const end = nextTime || Math.ceil(periodDuration * template.timescale);
        repeat = Math.max(0, Math.ceil((end - time) / duration) - 1);
      }
      repeat = Math.min(repeat, 100000);
      for (let repeated = 0; repeated <= repeat; repeated += 1) {
        values.Number = sequence;
        values.Time = time;
        parts.push({ url: absoluteUrl(expandDashTemplate(template.media, values), baseUrl), range: null, initialization: false });
        time += duration;
        sequence += 1;
      }
    }
  } else if (template.duration && periodDuration) {
    const count = Math.min(100000, Math.ceil(periodDuration * template.timescale / template.duration));
    for (let index = 0; index < count; index += 1) {
      values.Number = template.startNumber + index;
      values.Time = index * template.duration;
      parts.push({ url: absoluteUrl(expandDashTemplate(template.media, values), baseUrl), range: null, initialization: false });
    }
  }
  return parts.filter(part => part.url);
}

function parseRange(value) {
  const match = String(value || '').match(/^(\d+)-(\d+)$/);
  return match ? { start: Number(match[1]), end: Number(match[2]) } : null;
}

function listParts(adaptation, representation, baseUrl) {
  const list = firstChild(representation, 'SegmentList') || firstChild(adaptation, 'SegmentList');
  if (!list) return [];
  const parts = [];
  const initialization = firstChild(list, 'Initialization');
  if (initialization) {
    parts.push({
      url: absoluteUrl(attr(initialization, 'sourceURL') || baseUrl, baseUrl),
      range: parseRange(attr(initialization, 'range')),
      initialization: true
    });
  }
  for (const segment of childElements(list, 'SegmentURL')) {
    parts.push({
      url: absoluteUrl(attr(segment, 'media') || baseUrl, baseUrl),
      range: parseRange(attr(segment, 'mediaRange')),
      initialization: false
    });
  }
  return parts.filter(part => part.url);
}

function protectedTrack(adaptation, representation) {
  const nodes = [...childElements(adaptation, 'ContentProtection'), ...childElements(representation, 'ContentProtection')];
  return nodes.some(node => {
    const scheme = attr(node, 'schemeIdUri').toLowerCase();
    return scheme.includes('widevine') || scheme.includes('playready') || scheme.includes('fairplay')
      || scheme.includes('mp4protection') || Array.from(node.attributes || []).some(item => item.localName === 'default_KID');
  });
}

function trackType(adaptation, representation) {
  const value = [
    attr(representation, 'contentType'), attr(adaptation, 'contentType'),
    attr(representation, 'mimeType'), attr(adaptation, 'mimeType')
  ].join(' ').toLowerCase();
  if (value.includes('video')) return 'video';
  if (value.includes('audio')) return 'audio';
  return '';
}

function tracksFromManifest(root, manifestUrl) {
  const tracks = [];
  const totalDuration = parseIsoDuration(attr(root, 'mediaPresentationDuration'));
  for (const period of childElements(root, 'Period')) {
    const periodDuration = parseIsoDuration(attr(period, 'duration')) || totalDuration;
    for (const adaptation of childElements(period, 'AdaptationSet')) {
      for (const representation of childElements(adaptation, 'Representation')) {
        const type = trackType(adaptation, representation);
        if (!type) continue;
        const baseUrl = inheritedBaseUrl([root, period, adaptation, representation], manifestUrl);
        const template = combinedTemplate(adaptation, representation);
        const parts = template
          ? templateParts(template, representation, baseUrl, periodDuration)
          : listParts(adaptation, representation, baseUrl);
        tracks.push({
          id: attr(representation, 'id') || `${type}-${tracks.length + 1}`,
          type,
          url: baseUrl,
          parts,
          bandwidth: number(attr(representation, 'bandwidth')),
          width: number(attr(representation, 'width')),
          height: number(attr(representation, 'height')),
          codecs: attr(representation, 'codecs', attr(adaptation, 'codecs')),
          mime: attr(representation, 'mimeType', attr(adaptation, 'mimeType')),
          frameRate: attr(representation, 'frameRate', attr(adaptation, 'frameRate')),
          duration: periodDuration,
          protected: protectedTrack(adaptation, representation)
        });
      }
    }
  }
  return tracks;
}

function bestAudio(tracks) {
  return [...tracks].filter(track => track.type === 'audio' && !track.protected)
    .sort((left, right) => right.bandwidth - left.bandwidth)[0] || null;
}

export function parseDashManifest(text, manifestUrl, title = '') {
  if (typeof DOMParser !== 'function') throw new Error('DASH parsing is unavailable in this context.');
  const document = new DOMParser().parseFromString(String(text || ''), 'application/xml');
  if (document.querySelector('parsererror')) throw new Error('The DASH manifest is invalid.');
  const root = document.documentElement;
  if (root?.localName !== 'MPD') throw new Error('The selected file is not a DASH manifest.');
  const tracks = tracksFromManifest(root, manifestUrl);
  const audio = bestAudio(tracks);
  const video = tracks.filter(track => track.type === 'video');
  return video.map(track => ({
    url: `${manifestUrl}#representation=${encodeURIComponent(track.id)}`,
    videoUrl: track.url,
    audioUrl: audio?.url || '',
    kind: audio ? 'dash' : (track.parts.length ? 'dash' : 'direct'),
    manifestUrl,
    representationId: track.id,
    audioRepresentationId: audio?.id || '',
    source: 'dash-variant',
    title,
    mime: 'video/mp4',
    extension: 'mp4',
    width: track.width,
    height: track.height,
    duration: track.duration,
    bandwidth: track.bandwidth + Number(audio?.bandwidth || 0),
    videoCodec: track.codecs,
    audioCodec: audio?.codecs || '',
    codecs: [track.codecs, audio?.codecs].filter(Boolean).join(', '),
    frameRate: track.frameRate,
    protected: track.protected || audio?.protected === true,
    downloadable: !track.protected && (!audio || !audio.protected)
  }));
}

export function findDashTracks(text, manifestUrl, videoId, audioId) {
  const document = new DOMParser().parseFromString(String(text || ''), 'application/xml');
  if (document.querySelector('parsererror')) throw new Error('The DASH manifest is invalid.');
  const tracks = tracksFromManifest(document.documentElement, manifestUrl);
  return {
    video: tracks.find(track => track.type === 'video' && track.id === videoId) || null,
    audio: tracks.find(track => track.type === 'audio' && track.id === audioId) || null
  };
}
