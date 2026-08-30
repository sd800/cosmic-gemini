import { parseHlsMaster, parseHlsMedia, selectHlsVariant } from '../core/video-download.js';
import { findDashTracks, parseDashManifest } from '../core/dash.js';
import { youtubeCandidates } from '../core/youtube-video.js';
import { unwrapObfuscatedHls } from '../core/obfuscated-hls.js';
import {
  ALL_FORMATS,
  BlobSource,
  EncodedAudioPacketSource,
  EncodedPacketSink,
  EncodedVideoPacketSource,
  Input,
  MkvOutputFormat,
  Mp4OutputFormat,
  Output,
  StreamTarget,
  UrlSource
} from '../vendor/mediabunny/mediabunny.min.mjs';

const artifacts = new Map();
let youtubeModulePromise;

function token() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

async function mediaFetch(url, pageUrl, options = {}) {
  const headers = new Headers(options.headers || {});
  const response = await fetch(url, {
    cache: 'no-store',
    credentials: 'include',
    redirect: 'follow',
    referrer: pageUrl || undefined,
    ...options,
    headers
  });
  if (!response.ok) throw new Error(`Media request failed (${response.status}).`);
  return response;
}

async function fetchBytes(url, pageUrl, range) {
  const headers = new Headers();
  if (range) headers.set('Range', `bytes=${range.start}-${range.end}`);
  const response = await mediaFetch(url, pageUrl, { headers });
  let bytes = new Uint8Array(await response.arrayBuffer());
  if (range && response.status !== 206 && bytes.byteLength > range.end) {
    bytes = bytes.slice(range.start, range.end + 1);
  }
  return bytes;
}

async function decryptAes128(bytes, keyBytes, ivBytes) {
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-CBC' }, false, ['decrypt']);
  const result = await crypto.subtle.decrypt({ name: 'AES-CBC', iv: new Uint8Array(ivBytes) }, key, bytes);
  return new Uint8Array(result);
}

async function resolveHls(url, pageUrl, preferredQuality, depth = 0) {
  if (depth > 3) throw new Error('The HLS playlist redirects through too many master playlists.');
  const response = await mediaFetch(url, pageUrl);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const text = unwrapObfuscatedHls(bytes) || new TextDecoder().decode(bytes);
  const variants = parseHlsMaster(text, response.url || url);
  if (!variants.length) return { text, url: response.url || url };
  const selected = selectHlsVariant(variants, preferredQuality);
  if (!selected) throw new Error('No playable HLS variant was found.');
  return resolveHls(selected.url, pageUrl, preferredQuality, depth + 1);
}

async function resolveHlsCandidate(candidate, pageUrl, preferredQuality) {
  if (candidate.manifestText) {
    const baseUrl = candidate.manifestBaseUrl || candidate.manifestUrl || candidate.url || pageUrl;
    const variants = parseHlsMaster(candidate.manifestText, baseUrl);
    if (!variants.length) return { text: candidate.manifestText, url: baseUrl };
    const selected = selectHlsVariant(variants, preferredQuality);
    if (!selected) throw new Error('No playable HLS variant was found.');
    return resolveHls(selected.url, pageUrl, preferredQuality, 1);
  }
  return resolveHls(candidate.url, pageUrl, preferredQuality);
}

async function createArtifact(extension) {
  const root = await navigator.storage.getDirectory();
  const name = `video-${Date.now()}-${token()}.${extension}`;
  const handle = await root.getFileHandle(name, { create: true });
  const writable = await handle.createWritable();
  return { root, name, handle, writable };
}

async function cleanupArtifact(artifactId) {
  const artifact = artifacts.get(artifactId);
  if (!artifact) return;
  artifacts.delete(artifactId);
  URL.revokeObjectURL(artifact.url);
  try { await artifact.root.removeEntry(artifact.name); } catch {}
}

async function publishProgress(requestId, tabId, candidateId, completed, total) {
  try {
    await chrome.runtime.sendMessage({
      type: 'CG_VIDEO_DOWNLOAD_PROGRESS',
      requestId,
      tabId,
      candidateId,
      progress: total ? Math.round((completed / total) * 100) : 0
    });
  } catch {}
}

async function publishArtifact(artifact, extension, details = {}) {
  const file = await artifact.handle.getFile();
  const url = URL.createObjectURL(file);
  const artifactId = token();
  artifacts.set(artifactId, { root: artifact.root, name: artifact.name, url });
  setTimeout(() => void cleanupArtifact(artifactId), 60 * 60 * 1000);
  return { artifactId, url, extension, bytes: file.size, ...details };
}

async function assembleHls(message) {
  const resolved = await resolveHlsCandidate(message.candidate, message.pageUrl, message.preferredQuality || 'best');
  const playlist = parseHlsMedia(resolved.text, resolved.url);
  if (!playlist.segments.length) throw new Error('The HLS playlist contains no downloadable segments.');
  if (playlist.unsupportedEncryption) throw new Error('This stream uses an unsupported protected-media method.');

  const firstUrl = playlist.segments[0].url;
  const fragmentedMp4 = playlist.segments.some(segment => segment.map) || /\.(?:m4s|mp4)(?:$|[?#])/i.test(firstUrl);
  const extension = fragmentedMp4 ? 'mp4' : 'ts';
  const artifact = await createArtifact(extension);
  const keyCache = new Map();
  const writtenMaps = new Set();

  try {
    for (let index = 0; index < playlist.segments.length; index += 1) {
      const segment = playlist.segments[index];
      if (segment.map) {
        const mapKey = `${segment.map.url}:${segment.map.range?.start || 0}:${segment.map.range?.end || 0}`;
        if (!writtenMaps.has(mapKey)) {
          await artifact.writable.write(await fetchBytes(segment.map.url, message.pageUrl, segment.map.range));
          writtenMaps.add(mapKey);
        }
      }
      let bytes = await fetchBytes(segment.url, message.pageUrl, segment.range);
      if (segment.key?.method === 'AES-128') {
        let keyBytes = keyCache.get(segment.key.url);
        if (!keyBytes) {
          keyBytes = await fetchBytes(segment.key.url, message.pageUrl);
          keyCache.set(segment.key.url, keyBytes);
        }
        bytes = await decryptAes128(bytes, keyBytes, segment.key.ivBytes);
      }
      await artifact.writable.write(bytes);
      await publishProgress(message.requestId, message.tabId, message.candidate.id, index + 1, playlist.segments.length);
    }
    await artifact.writable.close();
    return publishArtifact(artifact, extension, { liveSnapshot: !playlist.ended });
  } catch (error) {
    try { await artifact.writable.abort(); } catch {}
    try { await artifact.root.removeEntry(artifact.name); } catch {}
    throw error;
  }
}

async function fetchDirect(message) {
  const extension = /^[a-z0-9]{2,5}$/i.test(message.candidate.extension || '')
    ? message.candidate.extension.toLowerCase() : 'mp4';
  const artifact = await createArtifact(extension);
  try {
    const response = await mediaFetch(message.candidate.url, message.pageUrl);
    const total = Number(response.headers.get('content-length') || message.candidate.contentLength || 0);
    if (!response.body) {
      const bytes = new Uint8Array(await response.arrayBuffer());
      await artifact.writable.write(bytes);
      await publishProgress(message.requestId, message.tabId, message.candidate.id, bytes.byteLength, bytes.byteLength);
    } else {
      const reader = response.body.getReader();
      let completed = 0;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        await artifact.writable.write(value);
        completed += value.byteLength;
        await publishProgress(message.requestId, message.tabId, message.candidate.id, completed, total);
      }
    }
    await artifact.writable.close();
    return publishArtifact(artifact, extension);
  } catch (error) {
    try { await artifact.writable.abort(); } catch {}
    try { await artifact.root.removeEntry(artifact.name); } catch {}
    throw error;
  }
}

async function fetchDashManifest(url, pageUrl) {
  const response = await mediaFetch(url, pageUrl);
  return { text: await response.text(), url: response.url || url };
}

function dashManifestForCandidate(candidate, pageUrl) {
  if (!candidate?.manifestText) return null;
  return {
    text: candidate.manifestText,
    url: candidate.manifestBaseUrl || candidate.manifestUrl || candidate.url || pageUrl
  };
}

async function expandDash(message) {
  const manifest = dashManifestForCandidate(message.candidate, message.pageUrl)
    || await fetchDashManifest(message.candidate.manifestUrl || message.candidate.url, message.pageUrl);
  return parseDashManifest(manifest.text, manifest.url, message.candidate.title || '').map(candidate => ({
    ...candidate,
    ...(message.candidate.manifestText ? {
      manifestBaseUrl: manifest.url,
      inlineId: message.candidate.inlineId
    } : {})
  }));
}

async function discoverYoutube(message) {
  youtubeModulePromise ||= import('../vendor/youtubei/browser.js');
  const { Innertube } = await youtubeModulePromise;
  const fetchWithSession = (input, init = {}) => fetch(input, {
    ...init,
    credentials: 'include',
    cache: init.cache || 'no-store'
  });
  const innertube = await Innertube.create({
    fetch: fetchWithSession,
    visitor_data: message.context.visitorData || undefined,
    enable_session_cache: true,
    retrieve_innertube_config: false
  });
  const clients = ['WEB', 'ANDROID_VR', 'IOS', 'WEB_EMBEDDED'];
  let lastError;
  let best = [];
  for (const client of clients) {
    try {
      const info = await innertube.getBasicInfo(message.context.videoId, { client });
      const candidates = await youtubeCandidates(info, innertube, message.context.title);
      if (candidates.length > best.length) best = candidates;
      if (candidates.some(candidate => candidate.kind === 'muxed') || candidates.some(candidate => candidate.kind === 'hls')) break;
    } catch (error) { lastError = error; }
  }
  if (!best.length && lastError) throw lastError;
  return best;
}

function mediaInput(url, pageUrl) {
  return new Input({
    formats: ALL_FORMATS,
    source: new UrlSource(url, {
      requestInit: {
        cache: 'no-store',
        credentials: 'include',
        referrer: pageUrl || undefined
      },
      parallelism: 4,
      getRetryDelay: previousAttempts => previousAttempts < 2 ? 0.75 * (2 ** previousAttempts) : null
    })
  });
}

async function pipePackets(track, source, firstTimestamp, duration, progress) {
  const sink = new EncodedPacketSink(track);
  const decoderConfig = await track.getDecoderConfig();
  let first = true;
  for await (const packet of sink.packets(undefined, undefined, { verifyKeyPackets: track.type === 'video' })) {
    const timestamp = Math.max(0, packet.timestamp - firstTimestamp);
    await source.add(packet.clone({ timestamp }), first ? { decoderConfig: decoderConfig || undefined } : undefined);
    first = false;
    progress(duration ? Math.min(1, (timestamp + packet.duration) / duration) : 0);
  }
  source.close();
}

async function muxInputs(message, videoInput, audioInput) {
  const outputContainer = message.candidate.outputContainer === 'mkv'
    || /(?:vp0?8|vp0?9|av01|opus|vorbis)/i.test(`${message.candidate.videoCodec} ${message.candidate.audioCodec}`)
    ? 'mkv' : 'mp4';
  const artifact = await createArtifact(outputContainer);
  let output;
  try {
    const [videoTrack, audioTrack] = await Promise.all([
      videoInput.getPrimaryVideoTrack(),
      audioInput.getPrimaryAudioTrack()
    ]);
    if (!videoTrack || !audioTrack) throw new Error('The selected video and audio tracks could not be read.');
    const [videoCodec, audioCodec, videoStart, audioStart, videoDuration, audioDuration] = await Promise.all([
      videoTrack.getCodec(),
      audioTrack.getCodec(),
      videoTrack.getFirstTimestamp(),
      audioTrack.getFirstTimestamp(),
      videoTrack.getDurationFromMetadata({ skipLiveWait: true }),
      audioTrack.getDurationFromMetadata({ skipLiveWait: true })
    ]);
    if (!videoCodec || !audioCodec) throw new Error('The selected media codec is unsupported.');
    const videoSource = new EncodedVideoPacketSource(videoCodec);
    const audioSource = new EncodedAudioPacketSource(audioCodec);
    output = new Output({
      format: outputContainer === 'mkv'
        ? new MkvOutputFormat()
        : new Mp4OutputFormat({ fastStart: false }),
      target: new StreamTarget(artifact.writable, { chunked: true, chunkSize: 16 * 1024 * 1024 })
    });
    output.addVideoTrack(videoSource, { rotation: await videoTrack.getRotation() });
    output.addAudioTrack(audioSource);
    await output.start();
    const fractions = [0, 0];
    let lastProgress = -1;
    const update = (index, value) => {
      fractions[index] = value;
      const base = Number(message.progressBase || 0);
      const span = Number(message.progressSpan || (100 - base));
      const progress = Math.round(base + ((fractions[0] + fractions[1]) / 2) * span);
      if (progress === lastProgress) return;
      lastProgress = progress;
      void publishProgress(message.requestId, message.tabId, message.candidate.id, progress, 100);
    };
    await Promise.all([
      pipePackets(videoTrack, videoSource, videoStart, Number(videoDuration || message.candidate.duration || 0), value => update(0, value)),
      pipePackets(audioTrack, audioSource, audioStart, Number(audioDuration || message.candidate.duration || 0), value => update(1, value))
    ]);
    await output.finalize();
    await publishProgress(message.requestId, message.tabId, message.candidate.id, 100, 100);
    return publishArtifact(artifact, outputContainer);
  } catch (error) {
    try { await output?.cancel(); } catch {}
    try { await artifact.writable.abort(); } catch {}
    try { await artifact.root.removeEntry(artifact.name); } catch {}
    throw error;
  }
}

async function muxSeparatedMedia(message) {
  const videoUrl = message.candidate.videoUrl || message.candidate.url;
  const audioUrl = message.candidate.audioUrl;
  if (!videoUrl || !audioUrl) throw new Error('The separated video or audio track is missing.');
  const videoInput = mediaInput(videoUrl, message.pageUrl);
  const audioInput = mediaInput(audioUrl, message.pageUrl);
  try { return await muxInputs(message, videoInput, audioInput); }
  finally {
    videoInput.dispose();
    audioInput.dispose();
  }
}

async function removeArtifactFile(artifact) {
  if (!artifact) return;
  try { await artifact.root.removeEntry(artifact.name); } catch {}
}

async function assembleDashTrack(track, message, label, offset, span) {
  if (!track?.parts?.length) return { input: mediaInput(track.url, message.pageUrl), artifact: null };
  const artifact = await createArtifact('m4s');
  try {
    for (let index = 0; index < track.parts.length; index += 1) {
      const part = track.parts[index];
      await artifact.writable.write(await fetchBytes(part.url, message.pageUrl, part.range));
      await publishProgress(
        message.requestId,
        message.tabId,
        message.candidate.id,
        offset + ((index + 1) / track.parts.length) * span,
        100
      );
    }
    await artifact.writable.close();
    const file = await artifact.handle.getFile();
    return {
      input: new Input({ formats: ALL_FORMATS, source: new BlobSource(file) }),
      artifact,
      label
    };
  } catch (error) {
    try { await artifact.writable.abort(); } catch {}
    await removeArtifactFile(artifact);
    throw error;
  }
}

async function assembleDash(message) {
  const manifest = dashManifestForCandidate(message.candidate, message.pageUrl)
    || await fetchDashManifest(message.candidate.manifestUrl || message.candidate.url, message.pageUrl);
  const tracks = findDashTracks(
    manifest.text,
    manifest.url,
    message.candidate.representationId,
    message.candidate.audioRepresentationId
  );
  if (!tracks.video || tracks.video.protected || tracks.audio?.protected) {
    throw new Error('This DASH format is protected or no longer available.');
  }
  const video = await assembleDashTrack(tracks.video, message, 'video', 0, tracks.audio ? 35 : 90);
  let audio = null;
  try {
    if (!tracks.audio) {
      if (!video.artifact) throw new Error('The selected DASH format has no downloadable audio track.');
      await publishProgress(message.requestId, message.tabId, message.candidate.id, 100, 100);
      return publishArtifact(video.artifact, 'mp4');
    }
    audio = await assembleDashTrack(tracks.audio, message, 'audio', 35, 35);
    const muxMessage = {
      ...message,
      progressBase: 70,
      progressSpan: 30,
      candidate: { ...message.candidate, duration: tracks.video.duration || message.candidate.duration }
    };
    return await muxInputs(muxMessage, video.input, audio.input);
  } finally {
    video.input.dispose();
    audio?.input.dispose();
    if (tracks.audio) {
      await removeArtifactFile(video.artifact);
      await removeArtifactFile(audio?.artifact);
    }
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.target !== 'video-download-offscreen') return false;
  void (async () => {
    if (message.type === 'CG_VIDEO_ASSEMBLE_HLS') {
      sendResponse({ ok: true, result: await assembleHls(message) });
      return;
    }
    if (message.type === 'CG_VIDEO_FETCH_DIRECT') {
      sendResponse({ ok: true, result: await fetchDirect(message) });
      return;
    }
    if (message.type === 'CG_VIDEO_MUX_TRACKS') {
      sendResponse({ ok: true, result: await muxSeparatedMedia(message) });
      return;
    }
    if (message.type === 'CG_VIDEO_EXPAND_DASH') {
      sendResponse({ ok: true, result: await expandDash(message) });
      return;
    }
    if (message.type === 'CG_VIDEO_DISCOVER_YOUTUBE') {
      sendResponse({ ok: true, result: await discoverYoutube(message) });
      return;
    }
    if (message.type === 'CG_VIDEO_ASSEMBLE_DASH') {
      sendResponse({ ok: true, result: await assembleDash(message) });
      return;
    }
    if (message.type === 'CG_VIDEO_CLEANUP_ARTIFACT') {
      await cleanupArtifact(message.artifactId);
      sendResponse({ ok: true });
      return;
    }
    throw new Error('Unknown offscreen video task.');
  })().catch(error => sendResponse({ ok: false, error: error.message }));
  return true;
});
