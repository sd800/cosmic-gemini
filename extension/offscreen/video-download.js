import { parseHlsMaster, parseHlsMedia, selectHlsVariant } from '../core/video-download.js';
import { findDashTracks, parseDashManifest } from '../core/dash.js';
import { youtubeCandidates } from '../core/youtube-video.js';
import { unwrapObfuscatedHls } from '../core/obfuscated-hls.js';
import { imageExtension } from '../core/image-download.js';
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
const activeVideoRequests = new Map();
const pendingVideoCancellations = new Set();
let youtubeModulePromise;

function token() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

function beginVideoRequest(requestId) {
  const current = activeVideoRequests.get(requestId);
  current?.controller.abort();
  const request = { controller: new AbortController(), cancelled: false };
  activeVideoRequests.set(requestId, request);
  if (pendingVideoCancellations.delete(requestId)) {
    request.cancelled = true;
    request.controller.abort();
  }
  return request;
}

function cancelVideoRequest(requestId) {
  const request = activeVideoRequests.get(requestId);
  if (!request) {
    if (!requestId) return false;
    pendingVideoCancellations.add(requestId);
    setTimeout(() => pendingVideoCancellations.delete(requestId), 60_000);
    return true;
  }
  request.cancelled = true;
  request.controller.abort();
  return true;
}

function videoRequest(requestId) {
  return requestId ? activeVideoRequests.get(requestId) : null;
}

function videoRequestCancelled(requestId) {
  const request = videoRequest(requestId);
  return request?.cancelled === true || request?.controller.signal.aborted === true;
}

function throwIfVideoRequestCancelled(requestId) {
  if (!videoRequestCancelled(requestId)) return;
  throw new DOMException('Video processing was canceled.', 'AbortError');
}

async function runVideoRequest(message, task) {
  const requestId = String(message.requestId || '');
  if (!requestId) return task();
  const request = beginVideoRequest(requestId);
  try {
    throwIfVideoRequestCancelled(requestId);
    return await task();
  }
  finally {
    if (activeVideoRequests.get(requestId) === request) activeVideoRequests.delete(requestId);
  }
}

async function mediaFetch(url, pageUrl, options = {}, requestId = '') {
  throwIfVideoRequestCancelled(requestId);
  const headers = new Headers(options.headers || {});
  const signal = options.signal || videoRequest(requestId)?.controller.signal;
  const response = await fetch(url, {
    cache: 'no-store',
    credentials: 'include',
    redirect: 'follow',
    ...options,
    headers,
    ...(signal ? { signal } : {})
  });
  if (!response.ok) throw new Error(`Media request failed (${response.status}).`);
  return response;
}

async function fetchBytes(url, pageUrl, range, requestId = '') {
  const headers = new Headers();
  if (range) headers.set('Range', `bytes=${range.start}-${range.end}`);
  const response = await mediaFetch(url, pageUrl, { headers }, requestId);
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

async function resolveHls(url, pageUrl, preferredQuality, depth = 0, requestId = '') {
  if (depth > 3) throw new Error('The HLS playlist redirects through too many master playlists.');
  const response = await mediaFetch(url, pageUrl, {}, requestId);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const text = unwrapObfuscatedHls(bytes) || new TextDecoder().decode(bytes);
  const variants = parseHlsMaster(text, response.url || url);
  if (!variants.length) return { text, url: response.url || url };
  const selected = selectHlsVariant(variants, preferredQuality);
  if (!selected) throw new Error('No playable HLS variant was found.');
  return resolveHls(selected.url, pageUrl, preferredQuality, depth + 1, requestId);
}

async function resolveHlsCandidate(candidate, pageUrl, preferredQuality, requestId = '') {
  if (candidate.manifestText) {
    const baseUrl = candidate.manifestBaseUrl || candidate.manifestUrl || candidate.url || pageUrl;
    const variants = parseHlsMaster(candidate.manifestText, baseUrl);
    if (!variants.length) return { text: candidate.manifestText, url: baseUrl };
    const selected = selectHlsVariant(variants, preferredQuality);
    if (!selected) throw new Error('No playable HLS variant was found.');
    return resolveHls(selected.url, pageUrl, preferredQuality, 1, requestId);
  }
  return resolveHls(candidate.url, pageUrl, preferredQuality, 0, requestId);
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
  if (artifact) {
    artifacts.delete(artifactId);
    URL.revokeObjectURL(artifact.url);
    try { await artifact.root.removeEntry(artifact.name); } catch {}
    return;
  }
  try {
    const root = await navigator.storage.getDirectory();
    await root.removeEntry(String(artifactId || ''));
  } catch {}
}

async function publishProgress(requestId, tabId, candidateId, completed, total) {
  if (videoRequestCancelled(requestId)) return;
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
  const artifactId = artifact.name;
  artifacts.set(artifactId, { root: artifact.root, name: artifact.name, url });
  setTimeout(() => void cleanupArtifact(artifactId), 60 * 60 * 1000);
  return { artifactId, url, extension, bytes: file.size, ...details };
}

function imageOutputMime(format) {
  if (format === 'jpg') return 'image/jpeg';
  if (format === 'png') return 'image/png';
  if (format === 'webp') return 'image/webp';
  return '';
}

function replaceFilenameExtension(filename, extension) {
  const base = String(filename || 'Image').replace(/\.[a-z0-9]{2,5}$/i, '');
  return `${base}.${extension}`;
}

async function fetchImageBlob(url, pageUrl) {
  const response = await mediaFetch(url, pageUrl, { headers: { Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8' } });
  const blob = await response.blob();
  const type = String(blob.type || response.headers.get('content-type') || '').split(';')[0].toLowerCase();
  if (type && !type.startsWith('image/')) throw new Error('The selected address did not return an image.');
  return new Blob([blob], { type: type || 'application/octet-stream' });
}

async function convertImageBlob(blob, format) {
  if (format === 'original') return { blob, extension: imageExtension('', blob.type) || 'jpg' };
  const mime = imageOutputMime(format);
  if (!mime) throw new Error('The selected image format is unavailable.');
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext('2d', { alpha: format !== 'jpg' });
    if (!context) throw new Error('Image conversion is unavailable.');
    if (format === 'jpg') {
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, bitmap.width, bitmap.height);
    }
    context.drawImage(bitmap, 0, 0);
    return { blob: await canvas.convertToBlob({ type: mime, quality: 0.95 }), extension: format };
  } finally { bitmap.close(); }
}

async function prepareImageFile(file, pageUrl, outputFormat) {
  const original = await fetchImageBlob(file.candidate.url, pageUrl);
  const converted = await convertImageBlob(original, outputFormat || 'original');
  const extension = outputFormat === 'original'
    ? imageExtension(file.candidate.url, original.type) || converted.extension
    : converted.extension;
  return {
    blob: converted.blob,
    extension,
    filename: replaceFilenameExtension(file.filename, extension)
  };
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date = new Date()) {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  };
}

function zipLocalHeader(nameBytes, checksum, size, time, date) {
  const bytes = new Uint8Array(30 + nameBytes.length);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x04034b50, true);
  view.setUint16(4, 20, true);
  view.setUint16(6, 0x0800, true);
  view.setUint16(8, 0, true);
  view.setUint16(10, time, true);
  view.setUint16(12, date, true);
  view.setUint32(14, checksum, true);
  view.setUint32(18, size, true);
  view.setUint32(22, size, true);
  view.setUint16(26, nameBytes.length, true);
  view.setUint16(28, 0, true);
  bytes.set(nameBytes, 30);
  return bytes;
}

function zipCentralHeader(entry) {
  const bytes = new Uint8Array(46 + entry.nameBytes.length);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x02014b50, true);
  view.setUint16(4, 20, true);
  view.setUint16(6, 20, true);
  view.setUint16(8, 0x0800, true);
  view.setUint16(10, 0, true);
  view.setUint16(12, entry.time, true);
  view.setUint16(14, entry.date, true);
  view.setUint32(16, entry.checksum, true);
  view.setUint32(20, entry.size, true);
  view.setUint32(24, entry.size, true);
  view.setUint16(28, entry.nameBytes.length, true);
  view.setUint16(30, 0, true);
  view.setUint16(32, 0, true);
  view.setUint16(34, 0, true);
  view.setUint16(36, 0, true);
  view.setUint32(38, 0, true);
  view.setUint32(42, entry.offset, true);
  bytes.set(entry.nameBytes, 46);
  return bytes;
}

function zipEnd(entries, centralSize, centralOffset) {
  const bytes = new Uint8Array(22);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x06054b50, true);
  view.setUint16(4, 0, true);
  view.setUint16(6, 0, true);
  view.setUint16(8, entries, true);
  view.setUint16(10, entries, true);
  view.setUint32(12, centralSize, true);
  view.setUint32(16, centralOffset, true);
  view.setUint16(20, 0, true);
  return bytes;
}

async function fetchImageArtifact(message) {
  const prepared = await prepareImageFile(message.file, message.pageUrl, message.outputFormat);
  const artifact = await createArtifact(prepared.extension);
  try {
    await artifact.writable.write(prepared.blob);
    await artifact.writable.close();
    return publishArtifact(artifact, prepared.extension, { filename: prepared.filename, bytes: prepared.blob.size });
  } catch (error) {
    try { await artifact.writable.abort(); } catch {}
    await removeArtifactFile(artifact);
    throw error;
  }
}

async function createImageZip(message) {
  const files = Array.isArray(message.files) ? message.files.slice(0, 500) : [];
  if (!files.length) throw new Error('No images were selected.');
  const artifact = await createArtifact('zip');
  const entries = [];
  const usedNames = new Set();
  let offset = 0;
  try {
    for (let index = 0; index < files.length; index += 1) {
      const prepared = await prepareImageFile(files[index], message.pageUrl, message.outputFormat);
      let filename = prepared.filename;
      let suffix = 2;
      while (usedNames.has(filename.toLowerCase())) {
        const extension = prepared.extension;
        filename = `${prepared.filename.replace(new RegExp(`\\.${extension}$`, 'i'), '')} ${suffix++}.${extension}`;
      }
      usedNames.add(filename.toLowerCase());
      const nameBytes = new TextEncoder().encode(filename);
      const data = new Uint8Array(await prepared.blob.arrayBuffer());
      if (data.byteLength > 0xffffffff || offset > 0xffffffff) throw new Error('The selected images exceed the ZIP size limit.');
      const checksum = crc32(data);
      const stamp = dosDateTime();
      const header = zipLocalHeader(nameBytes, checksum, data.byteLength, stamp.time, stamp.date);
      await artifact.writable.write(header);
      await artifact.writable.write(data);
      entries.push({ nameBytes, checksum, size: data.byteLength, time: stamp.time, date: stamp.date, offset });
      offset += header.byteLength + data.byteLength;
    }
    const centralOffset = offset;
    for (const entry of entries) {
      const header = zipCentralHeader(entry);
      await artifact.writable.write(header);
      offset += header.byteLength;
    }
    await artifact.writable.write(zipEnd(entries.length, offset - centralOffset, centralOffset));
    await artifact.writable.close();
    return publishArtifact(artifact, 'zip', { bytes: offset + 22 });
  } catch (error) {
    try { await artifact.writable.abort(); } catch {}
    await removeArtifactFile(artifact);
    throw error;
  }
}

async function cropImageCapture(message) {
  const response = await fetch(message.dataUrl);
  const blob = await response.blob();
  const bitmap = await createImageBitmap(blob);
  const rect = message.rect || {};
  const scaleX = bitmap.width / Math.max(1, Number(rect.viewportWidth) || bitmap.width);
  const scaleY = bitmap.height / Math.max(1, Number(rect.viewportHeight) || bitmap.height);
  const x = Math.max(0, Math.round((Number(rect.x) || 0) * scaleX));
  const y = Math.max(0, Math.round((Number(rect.y) || 0) * scaleY));
  const width = Math.max(1, Math.min(bitmap.width - x, Math.round((Number(rect.width) || 1) * scaleX)));
  const height = Math.max(1, Math.min(bitmap.height - y, Math.round((Number(rect.height) || 1) * scaleY)));
  try {
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Image capture is unavailable.');
    context.drawImage(bitmap, x, y, width, height, 0, 0, width, height);
    const output = await canvas.convertToBlob({ type: 'image/png' });
    const artifact = await createArtifact('png');
    await artifact.writable.write(output);
    await artifact.writable.close();
    return publishArtifact(artifact, 'png', { bytes: output.size, width, height });
  } finally { bitmap.close(); }
}

async function assembleHls(message) {
  const resolved = await resolveHlsCandidate(
    message.candidate,
    message.pageUrl,
    message.preferredQuality || 'best',
    message.requestId
  );
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
      throwIfVideoRequestCancelled(message.requestId);
      const segment = playlist.segments[index];
      if (segment.map) {
        const mapKey = `${segment.map.url}:${segment.map.range?.start || 0}:${segment.map.range?.end || 0}`;
        if (!writtenMaps.has(mapKey)) {
          await artifact.writable.write(await fetchBytes(
            segment.map.url,
            message.pageUrl,
            segment.map.range,
            message.requestId
          ));
          writtenMaps.add(mapKey);
        }
      }
      let bytes = await fetchBytes(segment.url, message.pageUrl, segment.range, message.requestId);
      if (segment.key?.method === 'AES-128') {
        let keyBytes = keyCache.get(segment.key.url);
        if (!keyBytes) {
          keyBytes = await fetchBytes(segment.key.url, message.pageUrl, undefined, message.requestId);
          keyCache.set(segment.key.url, keyBytes);
        }
        bytes = await decryptAes128(bytes, keyBytes, segment.key.ivBytes);
      }
      throwIfVideoRequestCancelled(message.requestId);
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
  const urls = [...new Set([
    message.candidate.url,
    ...(message.candidate.videoBackupUrls || [])
  ].filter(Boolean))].slice(0, 8);
  let response;
  let lastError;
  for (const url of urls) {
    try {
      response = await mediaFetch(url, message.pageUrl, {}, message.requestId);
      break;
    } catch (error) {
      if (videoRequestCancelled(message.requestId)) throw error;
      lastError = error;
    }
  }
  if (!response) throw lastError || new Error('The media file is unavailable.');
  const artifact = await createArtifact(extension);
  try {
    const total = Number(response.headers.get('content-length') || message.candidate.contentLength || 0);
    if (!response.body) {
      const bytes = new Uint8Array(await response.arrayBuffer());
      throwIfVideoRequestCancelled(message.requestId);
      await artifact.writable.write(bytes);
      await publishProgress(message.requestId, message.tabId, message.candidate.id, bytes.byteLength, bytes.byteLength);
    } else {
      const reader = response.body.getReader();
      let completed = 0;
      try {
        for (;;) {
          throwIfVideoRequestCancelled(message.requestId);
          const { value, done } = await reader.read();
          if (done) break;
          await artifact.writable.write(value);
          completed += value.byteLength;
          await publishProgress(message.requestId, message.tabId, message.candidate.id, completed, total);
        }
      } catch (error) {
        try { await reader.cancel(); } catch {}
        throw error;
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

async function fetchDashManifest(url, pageUrl, requestId = '') {
  const response = await mediaFetch(url, pageUrl, {}, requestId);
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

function mediaInput(url, pageUrl, requestId = '') {
  const signal = videoRequest(requestId)?.controller.signal;
  return new Input({
    formats: ALL_FORMATS,
    source: new UrlSource(url, {
      requestInit: {
        cache: 'no-store',
        credentials: 'include',
        ...(signal ? { signal } : {})
      },
      parallelism: 4,
      getRetryDelay: previousAttempts => previousAttempts < 2 ? 0.75 * (2 ** previousAttempts) : null
    })
  });
}

async function pipePackets(track, source, firstTimestamp, duration, progress, requestId = '') {
  throwIfVideoRequestCancelled(requestId);
  const sink = new EncodedPacketSink(track);
  const decoderConfig = await track.getDecoderConfig();
  let first = true;
  for await (const packet of sink.packets(undefined, undefined, { verifyKeyPackets: track.type === 'video' })) {
    throwIfVideoRequestCancelled(requestId);
    const timestamp = Math.max(0, packet.timestamp - firstTimestamp);
    await source.add(packet.clone({ timestamp }), first ? { decoderConfig: decoderConfig || undefined } : undefined);
    first = false;
    progress(duration ? Math.min(1, (timestamp + packet.duration) / duration) : 0);
  }
  throwIfVideoRequestCancelled(requestId);
  source.close();
}

async function muxInputs(message, videoInput, audioInput) {
  throwIfVideoRequestCancelled(message.requestId);
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
    throwIfVideoRequestCancelled(message.requestId);
    if (!videoTrack || !audioTrack) throw new Error('The selected video and audio tracks could not be read.');
    const [videoCodec, audioCodec, videoStart, audioStart, videoDuration, audioDuration] = await Promise.all([
      videoTrack.getCodec(),
      audioTrack.getCodec(),
      videoTrack.getFirstTimestamp(),
      audioTrack.getFirstTimestamp(),
      videoTrack.getDurationFromMetadata({ skipLiveWait: true }),
      audioTrack.getDurationFromMetadata({ skipLiveWait: true })
    ]);
    throwIfVideoRequestCancelled(message.requestId);
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
    throwIfVideoRequestCancelled(message.requestId);
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
      pipePackets(videoTrack, videoSource, videoStart, Number(videoDuration || message.candidate.duration || 0), value => update(0, value), message.requestId),
      pipePackets(audioTrack, audioSource, audioStart, Number(audioDuration || message.candidate.duration || 0), value => update(1, value), message.requestId)
    ]);
    throwIfVideoRequestCancelled(message.requestId);
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

async function downloadTrackInput(urls, message, label, offset, span) {
  let lastError;
  for (const url of urls) {
    throwIfVideoRequestCancelled(message.requestId);
    const artifact = await createArtifact('m4s');
    let input = null;
    try {
      const response = await mediaFetch(url, message.pageUrl, {}, message.requestId);
      const total = Number(response.headers.get('content-length') || 0);
      let completed = 0;
      if (response.body) {
        const reader = response.body.getReader();
        try {
          for (;;) {
            throwIfVideoRequestCancelled(message.requestId);
            const { value, done } = await reader.read();
            if (done) break;
            await artifact.writable.write(value);
            completed += value.byteLength;
            if (total) await publishProgress(
              message.requestId,
              message.tabId,
              message.candidate.id,
              offset + (completed / total) * span,
              100
            );
          }
        } catch (error) {
          try { await reader.cancel(); } catch {}
          throw error;
        }
      } else {
        const bytes = new Uint8Array(await response.arrayBuffer());
        throwIfVideoRequestCancelled(message.requestId);
        await artifact.writable.write(bytes);
      }
      await artifact.writable.close();
      throwIfVideoRequestCancelled(message.requestId);
      const file = await artifact.handle.getFile();
      input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) });
      const track = label === 'video'
        ? await input.getPrimaryVideoTrack()
        : await input.getPrimaryAudioTrack();
      if (!track) throw new Error(`The selected ${label} track could not be read.`);
      await publishProgress(message.requestId, message.tabId, message.candidate.id, offset + span, 100);
      return { input, artifact };
    } catch (error) {
      input?.dispose();
      try { await artifact.writable.abort(); } catch {}
      await removeArtifactFile(artifact);
      if (videoRequestCancelled(message.requestId)) throw error;
      lastError = error;
    }
  }
  throw lastError || new Error(`The selected ${label} track is unavailable.`);
}

async function muxSeparatedMedia(message) {
  throwIfVideoRequestCancelled(message.requestId);
  const videoUrls = [...new Set([
    message.candidate.videoUrl || message.candidate.url,
    ...(message.candidate.videoBackupUrls || [])
  ].filter(Boolean))].slice(0, 4);
  const audioUrls = [...new Set([
    message.candidate.audioUrl,
    ...(message.candidate.audioBackupUrls || [])
  ].filter(Boolean))].slice(0, 4);
  if (!videoUrls.length || !audioUrls.length) throw new Error('The separated video or audio track is missing.');
  let video;
  let audio;
  try {
    video = await downloadTrackInput(videoUrls, message, 'video', 0, 35);
    audio = await downloadTrackInput(audioUrls, message, 'audio', 35, 25);
    return await muxInputs({ ...message, progressBase: 60, progressSpan: 40 }, video.input, audio.input);
  } finally {
    video?.input.dispose();
    audio?.input.dispose();
    await removeArtifactFile(video?.artifact);
    await removeArtifactFile(audio?.artifact);
  }
}

async function removeArtifactFile(artifact) {
  if (!artifact) return;
  try { await artifact.root.removeEntry(artifact.name); } catch {}
}

async function assembleDashTrack(track, message, label, offset, span) {
  if (!track?.parts?.length) return {
    input: mediaInput(track.url, message.pageUrl, message.requestId),
    artifact: null
  };
  const artifact = await createArtifact('m4s');
  try {
    for (let index = 0; index < track.parts.length; index += 1) {
      throwIfVideoRequestCancelled(message.requestId);
      const part = track.parts[index];
      await artifact.writable.write(await fetchBytes(part.url, message.pageUrl, part.range, message.requestId));
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
  throwIfVideoRequestCancelled(message.requestId);
  const manifest = dashManifestForCandidate(message.candidate, message.pageUrl)
    || await fetchDashManifest(
      message.candidate.manifestUrl || message.candidate.url,
      message.pageUrl,
      message.requestId
    );
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
  if (message?.target === 'image-download-offscreen') {
    void (async () => {
      if (message.type === 'CG_IMAGE_FETCH') {
        sendResponse({ ok: true, result: await fetchImageArtifact(message) });
        return;
      }
      if (message.type === 'CG_IMAGE_CREATE_ZIP') {
        sendResponse({ ok: true, result: await createImageZip(message) });
        return;
      }
      if (message.type === 'CG_IMAGE_CROP_CAPTURE') {
        sendResponse({ ok: true, result: await cropImageCapture(message) });
        return;
      }
      if (message.type === 'CG_IMAGE_CLEANUP_ARTIFACT') {
        await cleanupArtifact(message.artifactId);
        sendResponse({ ok: true });
        return;
      }
      throw new Error('Unknown offscreen image task.');
    })().catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  if (message?.target !== 'video-download-offscreen') return false;
  void (async () => {
    if (message.type === 'CG_VIDEO_CANCEL_REQUEST') {
      sendResponse({ ok: true, result: { cancelled: cancelVideoRequest(String(message.requestId || '')) } });
      return;
    }
    if (message.type === 'CG_VIDEO_ASSEMBLE_HLS') {
      sendResponse({ ok: true, result: await runVideoRequest(message, () => assembleHls(message)) });
      return;
    }
    if (message.type === 'CG_VIDEO_FETCH_DIRECT') {
      sendResponse({ ok: true, result: await runVideoRequest(message, () => fetchDirect(message)) });
      return;
    }
    if (message.type === 'CG_VIDEO_MUX_TRACKS') {
      sendResponse({ ok: true, result: await runVideoRequest(message, () => muxSeparatedMedia(message)) });
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
      sendResponse({ ok: true, result: await runVideoRequest(message, () => assembleDash(message)) });
      return;
    }
    if (message.type === 'CG_VIDEO_CLEANUP_ARTIFACT') {
      await cleanupArtifact(message.artifactId);
      sendResponse({ ok: true });
      return;
    }
    throw new Error('Unknown offscreen video task.');
  })().catch(error => sendResponse({
    ok: false,
    error: error.message,
    cancelled: error.name === 'AbortError' || /cancell?ed/i.test(error.message)
  }));
  return true;
});
