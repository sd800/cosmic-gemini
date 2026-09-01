import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classifyVideoResource,
  compactVideoCandidates,
  formatMediaDuration,
  groupVideoCandidates,
  limitVideoCandidatesForSession,
  mediaRequestDirectoryFilters,
  mediaRequestReferrer,
  parseHlsMaster,
  parseHlsMedia,
  recoverInterruptedVideoCandidates,
  sanitizeVideoFilename,
  selectHlsVariant,
  stableVideoCandidateId
} from '../extension/core/video-download.js';

import {
  bilibiliDashCandidates,
  bilibiliPageContext,
  completeBilibiliPageContext,
  fetchBilibiliPlayInfo,
  signedBilibiliQuery
} from '../extension/core/bilibili-video.js';
import { md5 } from '../extension/core/md5.js';
import { expandDashTemplate, parseIsoDuration } from '../extension/core/dash.js';
import { unwrapObfuscatedHls } from '../extension/core/obfuscated-hls.js';
import { youtubeCandidates } from '../extension/core/youtube-video.js';

test('interrupted video processing recovers after a Service Worker restart', () => {
  const ready = { id: 'ready', status: 'ready' };
  const result = recoverInterruptedVideoCandidates([
    ready,
    { id: 'working', status: 'preparing', progress: 63, processingRequestId: 'request-1', error: 'old' }
  ]);
  assert.equal(result.changed, true);
  assert.deepEqual(result.requestIds, ['request-1']);
  assert.equal(result.candidates[0], ready);
  assert.deepEqual(result.candidates[1], {
    id: 'working', status: 'ready', progress: 0, processingRequestId: '', error: ''
  });
});

test('video resources are classified without treating media segments as top-level results', () => {
  assert.equal(classifyVideoResource({ url: 'https://cdn.example/video.mp4' }).kind, 'direct');
  assert.equal(classifyVideoResource({
    url: 'https://cdn.example/playback?id=1',
    responseHeaders: [{ name: 'Content-Type', value: 'application/vnd.apple.mpegurl' }]
  }).kind, 'hls');
  assert.equal(classifyVideoResource({ url: 'https://cdn.example/segment.m4s' }), null);
  assert.equal(classifyVideoResource({ url: 'blob:https://example.com/id' }), null);
  assert.equal(classifyVideoResource({ url: `https://example.com/${'a'.repeat(32_000)}.mp4` }), null);
});

test('video sessions stay bounded without dropping an active download', () => {
  const active = { id: 'active', url: 'blob:local', artifactId: 'video-1-active.mp4', status: 'downloading' };
  const candidates = [
    { id: 'large', url: 'https://example.com/large.mp4', label: 'x'.repeat(200), status: 'ready' },
    active,
    { id: 'small', url: 'https://example.com/small.mp4', status: 'ready' }
  ];
  assert.deepEqual(limitVideoCandidatesForSession(candidates, 2, 100), [active]);
});

test('video candidate metadata bounds alternate URLs and response headers', () => {
  const candidate = classifyVideoResource({
    url: 'https://example.com/video.mp4',
    backupUrls: Array.from({ length: 40 }, (_, index) => `https://backup${index}.example/video.mp4`),
    responseHeaders: [
      ...Array.from({ length: 100 }, (_, index) => ({ name: `X-Test-${index}`, value: 'x' })),
      { name: 'Content-Length', value: '999999' }
    ]
  });
  assert.equal(candidate.videoBackupUrls.length, 8);
  assert.equal(candidate.contentLength, 0);
});

test('download choices keep one user-facing option per quality plus audio', () => {
  const compact = compactVideoCandidates([
    { id: '1080-av1', kind: 'muxed', qualityLabel: '1080p', height: 1080, videoCodec: 'av01', downloadable: true, hasAudio: true },
    { id: '1080-avc', kind: 'muxed', qualityLabel: '1080p', height: 1080, videoCodec: 'avc1', downloadable: true, hasAudio: true },
    { id: '720-avc', kind: 'muxed', qualityLabel: '720p', height: 720, videoCodec: 'avc1', downloadable: true, hasAudio: true },
    { id: 'audio-opus', kind: 'audio', audioCodec: 'opus', bandwidth: 192000, downloadable: true },
    { id: 'audio-aac', kind: 'audio', audioCodec: 'mp4a.40.2', bandwidth: 128000, downloadable: true }
  ]);
  assert.deepEqual(compact.map(candidate => candidate.id), ['1080-avc', '720-avc', 'audio-aac']);
});

test('download choices remain separated when one page contains multiple videos', () => {
  const groups = groupVideoCandidates([
    { id: 'first-1080', mediaKey: 'element-1', mediaTitle: 'First', kind: 'direct', height: 1080, downloadable: true },
    { id: 'first-720', mediaKey: 'element-1', mediaTitle: 'First', kind: 'direct', height: 720, downloadable: true },
    { id: 'second-1080', mediaKey: 'element-2', mediaTitle: 'Second', kind: 'direct', height: 1080, downloadable: true },
    { id: 'second-720', mediaKey: 'element-2', mediaTitle: 'Second', kind: 'direct', height: 720, downloadable: true }
  ]);
  assert.equal(groups.length, 2);
  assert.deepEqual(groups.map(group => group.title), ['First', 'Second']);
  assert.deepEqual(groups.map(group => group.candidates.map(candidate => candidate.id)), [
    ['first-1080', 'first-720'],
    ['second-1080', 'second-720']
  ]);
});

test('video identity metadata survives candidate normalization', () => {
  const candidate = classifyVideoResource({
    url: 'https://cdn.example/video.mp4',
    mediaKey: 'frame-0:element-2',
    mediaTitle: 'Second video',
    thumbnailUrl: 'https://cdn.example/poster.jpg'
  });
  assert.equal(candidate.mediaKey, 'frame-0:element-2');
  assert.equal(candidate.mediaTitle, 'Second video');
  assert.equal(candidate.thumbnailUrl, 'https://cdn.example/poster.jpg');
});

test('video size uses an existing response total without fetching media again', () => {
  const candidate = classifyVideoResource({
    url: 'https://cdn.example/video.mp4',
    responseHeaders: [
      { name: 'Content-Type', value: 'video/mp4' },
      { name: 'Content-Length', value: '1048576' },
      { name: 'Content-Range', value: 'bytes 0-1048575/8388608' }
    ]
  });
  assert.equal(candidate.contentLength, 8388608);
});

test('media duration is normalized and formatted for compact result cards', () => {
  const candidate = classifyVideoResource({
    url: 'https://cdn.example/video.mp4',
    duration: 3723.4
  });
  assert.equal(candidate.duration, 3723.4);
  assert.equal(formatMediaDuration(candidate.duration), '1:02:03');
  assert.equal(formatMediaDuration(125), '2:05');
  assert.equal(formatMediaDuration(Number.POSITIVE_INFINITY), '');
});

test('stable candidate IDs stay deterministic without relying on randomUUID', () => {
  const first = stableVideoCandidateId('https://cdn.example/video.mp4?token=1');
  assert.equal(first, stableVideoCandidateId('https://cdn.example/video.mp4?token=1'));
  assert.notEqual(first, stableVideoCandidateId('https://cdn.example/video.mp4?token=2'));
});

test('media downloads retain page referrers through temporary directory rules', () => {
  assert.equal(
    mediaRequestReferrer('https://www.bilibili.com/video/BV1example/?from=home#player'),
    'https://www.bilibili.com/video/BV1example/'
  );
  assert.deepEqual(mediaRequestDirectoryFilters({
    videoUrl: 'https://video.example/path/video.m4s?token=1',
    videoBackupUrls: ['https://backup.example/media/video.m4s?token=2'],
    audioUrl: 'https://video.example/path/audio.m4s?token=3'
  }), [
    'https://video.example/path/*',
    'https://backup.example/media/*'
  ]);
});

test('HLS master playlists resolve and rank variants', () => {
  const variants = parseHlsMaster(`#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=1200000,RESOLUTION=1280x720,CODECS="avc1.4d401f,mp4a.40.2"
720/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=4500000,RESOLUTION=1920x1080
https://video.example/1080.m3u8`, 'https://video.example/master.m3u8');
  assert.equal(variants[0].height, 1080);
  assert.equal(variants[1].url, 'https://video.example/720/index.m3u8');
  assert.equal(selectHlsVariant(variants, '720').height, 720);
  assert.equal(selectHlsVariant(variants, 'best').height, 1080);
});

test('HLS variants retain the preferred alternate audio track', () => {
  const variants = parseHlsMaster(`#EXTM3U
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="main",NAME="English",LANGUAGE="en",DEFAULT=YES,URI="audio/en.m3u8"
#EXT-X-STREAM-INF:BANDWIDTH=2400000,RESOLUTION=1920x1080,AUDIO="main"
video/1080.m3u8`, 'https://video.example/master.m3u8');
  assert.equal(variants[0].audioUrl, 'https://video.example/audio/en.m3u8');
  assert.equal(variants[0].audioLanguage, 'en');
});

test('HLS media playlists retain maps, byte ranges, and AES-128 metadata', () => {
  const playlist = parseHlsMedia(`#EXTM3U
#EXT-X-MEDIA-SEQUENCE:7
#EXT-X-MAP:URI="init.mp4"
#EXT-X-KEY:METHOD=AES-128,URI="key.bin",IV=0x1
#EXTINF:4,
#EXT-X-BYTERANGE:100@20
segment.m4s
#EXT-X-ENDLIST`, 'https://video.example/path/index.m3u8');
  assert.equal(playlist.segments.length, 1);
  assert.equal(playlist.segments[0].map.url, 'https://video.example/path/init.mp4');
  assert.deepEqual(playlist.segments[0].range, { start: 20, end: 119 });
  assert.equal(playlist.segments[0].key.url, 'https://video.example/path/key.bin');
  assert.equal(playlist.segments[0].key.ivBytes.length, 16);
  assert.equal(playlist.segments[0].key.ivBytes[15], 1);
  assert.equal(playlist.duration, 4);
  assert.equal(playlist.ended, true);
});

test('video filenames are portable across supported desktop systems', () => {
  assert.equal(sanitizeVideoFilename('A <video>: title? ', 'MP4'), 'A video title.mp4');
  assert.equal(sanitizeVideoFilename('', 'unknown-extension'), 'Video.mp4');
});

test('MD5 and Bilibili WBI signing stay deterministic', () => {
  assert.equal(md5(''), 'd41d8cd98f00b204e9800998ecf8427e');
  assert.equal(md5('abc'), '900150983cd24fb0d6963f7d28e17f72');
  const query = signedBilibiliQuery(
    { bvid: 'BV1xx411c7mD', cid: 123, fnval: 4048 },
    'https://i0.hdslb.com/bfs/wbi/7cd084941338484aae1ad9425b84077c.png',
    'https://i0.hdslb.com/bfs/wbi/4932caff0ff746eab6f01bf08b70ac45.png',
    1_700_000_000_000
  );
  assert.match(query, /^bvid=BV1xx411c7mD&cid=123&fnval=4048&wts=1700000000&w_rid=[a-f0-9]{32}$/);
});

test('Bilibili DASH video and audio tracks become video and audio-only downloads', () => {
  const candidates = bilibiliDashCandidates({ data: {
    timelength: 61_000,
    dash: {
      video: [{ id: 80, baseUrl: 'https://example.com/video.m4s', backupUrl: ['https://backup.example/video.m4s'], width: 1920, height: 1080, codecs: 'avc1.640028', bandwidth: 4_000_000 }],
      audio: [{ baseUrl: 'https://example.com/audio.m4s', backupUrl: ['https://backup.example/audio.m4s'], codecs: 'mp4a.40.2', bandwidth: 192_000 }]
    }
  } }, { title: 'Example', pageTitle: 'Part 1' });
  assert.equal(candidates.length, 2);
  assert.equal(candidates[0].kind, 'muxed');
  assert.equal(candidates[0].qualityLabel, '1080p');
  assert.equal(candidates[0].codecLabel, 'AVC');
  assert.equal(candidates[0].duration, 61);
  assert.equal(candidates[0].audioUrl, 'https://example.com/audio.m4s');
  assert.deepEqual(candidates[0].videoBackupUrls, ['https://backup.example/video.m4s']);
  assert.deepEqual(candidates[0].audioBackupUrls, ['https://backup.example/audio.m4s']);
  assert.equal(candidates[1].kind, 'audio');
  assert.equal(candidates[1].extension, 'm4a');
  assert.deepEqual(candidates[1].videoBackupUrls, ['https://backup.example/audio.m4s']);
});

test('Bilibili page context recovers inline play information after the page removes its global', () => {
  const originalDocument = globalThis.document;
  const originalLocation = globalThis.location;
  const playInfo = { code: 0, data: { dash: {
    video: [{ id: 80, baseUrl: 'https://example.com/video.m4s' }],
    audio: [{ id: 30280, baseUrl: 'https://example.com/audio.m4s' }]
  } } };
  const structured = { '@type': 'VideoObject', name: 'Inline example', embedUrl: 'https://player.bilibili.com/player.html?bvid=BV1yM4y1t7zB' };
  globalThis.document = {
    title: 'Fallback title',
    scripts: [{ textContent: `window.__playinfo__=${JSON.stringify(playInfo)}` }],
    querySelectorAll: selector => selector === 'script[type="application/ld+json"]'
      ? [{ textContent: JSON.stringify(structured) }] : []
  };
  globalThis.location = { href: 'https://www.bilibili.com/video/BV1yM4y1t7zB/?p=2' };
  try {
    const context = bilibiliPageContext();
    assert.equal(context.bvid, 'BV1yM4y1t7zB');
    assert.equal(context.pageNumber, 2);
    assert.equal(context.title, 'Inline example');
    assert.equal(context.playInfo.data.dash.video.length, 1);
    assert.equal(context.playInfo.data.dash.audio.length, 1);
  } finally {
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
    if (originalLocation === undefined) delete globalThis.location;
    else globalThis.location = originalLocation;
  }
});

test('Bilibili context resolves the selected page without starting the player', async () => {
  let requested = '';
  const context = await completeBilibiliPageContext({
    bvid: 'BV1example', pageNumber: 2, title: '', pageTitle: '', playInfo: null
  }, async url => {
    requested = url;
    return { data: {
      aid: 123,
      bvid: 'BV1example',
      title: 'Example video',
      pages: [{ cid: 11, part: 'First' }, { cid: 22, part: 'Second' }]
    } };
  });
  assert.equal(requested, 'https://api.bilibili.com/x/web-interface/view?bvid=BV1example');
  assert.equal(context.aid, 123);
  assert.equal(context.cid, 22);
  assert.equal(context.pageTitle, 'Second');
});

test('Bilibili international playback resources use the same local mux path', () => {
  const candidates = bilibiliDashCandidates({ data: { playurl: {
    duration: 45,
    audio_resource: [{ url: 'https://example.com/audio.m4s', codecs: 'mp4a.40.2', bandwidth: 128000 }],
    video: [{ video_resource: { url: 'https://example.com/video.m4s', width: 1280, height: 720, codecs: 'avc1.4d401f', bandwidth: 2000000 } }]
  } } }, { title: 'International video' });
  assert.equal(candidates.length, 2);
  assert.equal(candidates[0].kind, 'muxed');
  assert.equal(candidates[0].height, 720);
  assert.equal(candidates[0].duration, 45);
});

test('Bilibili international discovery requests the public international play endpoint', async () => {
  let requested = '';
  await fetchBilibiliPlayInfo({ internationalEpisodeId: 987 }, async url => {
    requested = url;
    return { data: { playurl: {} } };
  });
  assert.match(requested, /^https:\/\/api\.bilibili\.tv\/intl\/gateway\/web\/playurl\?/);
  assert.match(requested, /(?:^|&)ep_id=987(?:&|$)/);
});

test('DASH duration and segment templates cover numbered and escaped placeholders', () => {
  assert.equal(parseIsoDuration('PT1H2M3.5S'), 3723.5);
  assert.equal(expandDashTemplate('v/$RepresentationID$/$Number%05d$/$$.m4s', {
    RepresentationID: '1080', Number: 7
  }), 'v/1080/00007/$.m4s');
});

test('wrapped HLS XOR envelopes are recovered locally', () => {
  const text = '#EXTM3U\n#EXT-X-VERSION:3\n#EXTINF:5,\nvideo.ts\n#EXT-X-ENDLIST\n';
  const key = new TextEncoder().encode('key');
  const input = new TextEncoder().encode(text);
  const encrypted = input.map((value, index) => value ^ key[index % key.length]);
  const body = Buffer.from(encrypted).toString('base64');
  const metadata = Buffer.concat([Buffer.from('AB03'), Buffer.from(key), Buffer.from('00')]);
  const envelope = Buffer.concat([Buffer.from(body), metadata, Buffer.from(String(metadata.length).padStart(2, '0'))]);
  assert.equal(unwrapObfuscatedHls(envelope), text);
});

test('YouTube separated tracks are deciphered into video and audio-only downloads', async () => {
  const format = values => ({ ...values, decipher: async () => values.testUrl });
  const candidates = await youtubeCandidates({
    basic_info: { id: 'abc', title: 'Example', duration: 60 },
    cpn: 'cpn',
    streaming_data: {
      adaptive_formats: [
        format({ has_video: true, has_audio: false, mime_type: 'video/webm; codecs="vp09.00.40.08"', width: 1920, height: 1080, bitrate: 3000000, testUrl: 'https://video.example/video.webm' }),
        format({ has_video: false, has_audio: true, mime_type: 'audio/webm; codecs="opus"', bitrate: 128000, testUrl: 'https://video.example/audio.webm' })
      ]
    }
  }, { session: { player: {} } });
  assert.equal(candidates.length, 2);
  assert.equal(candidates[0].kind, 'muxed');
  assert.equal(candidates[0].outputContainer, 'mkv');
  assert.equal(candidates[0].audioUrl, 'https://video.example/audio.webm?cpn=cpn');
  assert.equal(candidates[1].kind, 'audio');
  assert.equal(candidates[1].url, 'https://video.example/audio.webm?cpn=cpn');
});
