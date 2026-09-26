export async function siteVideoPageDiscovery() {
  const candidates = [];
  const manifests = [];
  const seenUrls = new Set();
  const seenManifests = new Set();
  const pageUrl = location.href;
  const hostname = location.hostname.toLowerCase();
  const title = document.title || 'Video';

  function absolute(value, base = pageUrl) {
    try {
      const url = new URL(String(value || '').replace(/\\u002f/gi, '/').replace(/\\\//g, '/'), base);
      return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
    } catch { return ''; }
  }

  function kind(url) {
    if (/\.m3u8(?:$|[?#])/i.test(url)) return 'hls';
    if (/\.mpd(?:$|[?#])/i.test(url)) return 'dash';
    return 'direct';
  }

  function addUrl(value, details = {}) {
    const url = absolute(value, details.baseUrl || pageUrl);
    if (!url || seenUrls.has(url)) return;
    const mime = String(details.mime || '').toLowerCase();
    if (!/\.(?:m3u8|mpd|mp4|webm|mov|mkv|m4v|ogv)(?:$|[?#])/i.test(url)
      && !mime.startsWith('video/') && !mime.includes('mpegurl') && mime !== 'application/dash+xml') return;
    seenUrls.add(url);
    candidates.push({
      url,
      kind: details.kind || kind(url),
      source: details.source || 'site-adapter',
      title: details.title || title,
      mime,
      duration: Number(details.duration || 0),
      width: Number(details.width || 0),
      height: Number(details.height || 0),
      contentLength: Number(details.contentLength || 0),
      bandwidth: Number(details.bandwidth || 0)
    });
  }

  function hashText(value) {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  function decoded(value) {
    const text = String(value || '');
    try {
      if (/^"(?:\\.|[^"\\])*"$/.test(text.trim())) return JSON.parse(text.trim());
    } catch {}
    return text.replace(/\\u003c/gi, '<').replace(/\\u003e/gi, '>')
      .replace(/\\u002f/gi, '/').replace(/\\n/g, '\n')
      .replace(/\\"/g, '"').replace(/\\\//g, '/');
  }

  function addManifest(value, type, baseUrl = pageUrl, source = 'site-adapter') {
    const manifestText = decoded(value).trim();
    if (!manifestText || manifestText.length > 2 * 1024 * 1024) return;
    const inlineId = hashText(manifestText);
    if (seenManifests.has(inlineId)) return;
    seenManifests.add(inlineId);
    manifests.push({ kind: type, manifestText, baseUrl: absolute(baseUrl) || pageUrl, source, inlineId });
  }

  function collect(value, source = 'site-adapter') {
    const queue = [value];
    const visited = new WeakSet();
    let inspected = 0;
    while (queue.length && inspected < 30000 && candidates.length < 300) {
      const item = queue.shift();
      inspected += 1;
      if (typeof item === 'string') {
        if (item.includes('#EXTM3U')) addManifest(item.slice(item.indexOf('#EXTM3U')), 'hls', pageUrl, source);
        const mpd = decoded(item).match(/<MPD\b[\s\S]*?<\/MPD>/i)?.[0];
        if (mpd) addManifest(mpd, 'dash', pageUrl, source);
        for (const match of item.replace(/\\u002f/gi, '/').replace(/\\\//g, '/').matchAll(/https?:\/\/[^\s"'<>\\]+/gi)) addUrl(match[0], { source });
        continue;
      }
      if (!item || typeof item !== 'object' || visited.has(item)) continue;
      visited.add(item);
      let values;
      try {
        const mediaUrl = item.url || item.src || item.playUrl || item.play_url || item.playback_url
          || item.hls || item.hls_url || item.hlsManifestUrl || item.hlsMasterPlaylistUrl
          || item.ondemandHls || item.dashUrl || item.dash_url || item.dashSepUrl
          || item.baseUrl || item.base_url || item.source;
        const mime = item.mimeType || item.mime_type || item.type || '';
        if (mediaUrl) addUrl(mediaUrl, {
          source,
          mime,
          duration: item.duration || item.durationSeconds,
          width: item.width,
          height: item.height,
          bandwidth: item.bandwidth || item.bitrate,
          contentLength: item.contentLength || item.content_length || item.size
        });
        values = Array.isArray(item) ? item : Object.values(item);
      } catch { continue; }
      for (const child of values.slice(0, 4000)) {
        if (child && (typeof child === 'object' || typeof child === 'string')) queue.push(child);
      }
    }
  }

  async function fetchJson(url, options) {
    const response = await fetch(url, {
      credentials: 'include', cache: 'no-store', signal: options?.signal || AbortSignal.timeout(10000), ...options
    });
    return response.ok ? response.json() : null;
  }

  async function fetchText(url, options) {
    const response = await fetch(url, {
      credentials: 'include', cache: 'no-store', signal: options?.signal || AbortSignal.timeout(10000), ...options
    });
    return response.ok ? response.text() : '';
  }

  async function discoverKick() {
    const match = pageUrl.match(/^https?:\/\/kick\.com\/([^/]+)(?:\/(videos|clips)(?:\/([^/?#]+))?)?\/?/i);
    if (!match) return;
    const [, channel, type = 'channel', id] = match;
    const endpoint = type === 'videos' && id ? `https://kick.com/api/v1/video/${encodeURIComponent(id)}`
      : type === 'clips' && id ? `https://kick.com/api/v2/clips/${encodeURIComponent(id)}`
        : `https://kick.com/api/v2/channels/${encodeURIComponent(channel)}`;
    const data = await fetchJson(endpoint);
    collect(data, 'kick');
  }

  async function discoverChaturbate() {
    const match = pageUrl.match(/^https?:\/\/(?:[^/]+\.)?chaturbate\.(com|eu|global)\/(?:fullvideo\/?\?.*?\bb=)?([^/?&#]+)/i);
    if (!match) return;
    const [, tld, room] = match;
    const body = new URLSearchParams({ room_slug: room });
    const data = await fetchJson(`https://chaturbate.${tld}/get_edge_hls_url_ajax/`, {
      method: 'POST',
      body,
      headers: { 'X-Requested-With': 'XMLHttpRequest', Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' }
    });
    if (data?.url) addUrl(data.url, { source: 'chaturbate', title: room });
    if (!data?.url) {
      const html = await fetchText(pageUrl, { headers: { Accept: 'text/html' } });
      const encoded = html.match(/initialRoomDossier\s*=\s*(["'])(.+?)\1/s)?.[2];
      try {
        const dossier = JSON.parse(JSON.parse(`"${encoded}"`));
        addUrl(dossier?.hls_source, { source: 'chaturbate', title: room });
      } catch {}
    }
  }

  async function discoverTwitCasting() {
    const match = pageUrl.match(/^https?:\/\/(?:[\w-]+\.)*twitcasting\.tv\/([\w:-]+)\/?$/i);
    if (!match) return;
    const data = await fetchJson(`https://en.twitcasting.tv/streamserver.php?target=${encodeURIComponent(match[1])}&mode=client&player=pc_web`);
    addUrl(data?.['tc-hls']?.streams?.high, { source: 'twitcasting', title: match[1] });
  }

  async function discoverVk() {
    const live = pageUrl.match(/^https:\/\/live\.vkvideo\.ru\/([^/]+)(?:\/record\/([^/?]+))?/i);
    if (live) {
      const endpoint = live[2]
        ? `https://api.live.vkvideo.ru/v1/blog/${encodeURIComponent(live[1])}/public_video_stream/record/${encodeURIComponent(live[2])}`
        : `https://api.live.vkvideo.ru/v1/channel/${encodeURIComponent(live[1])}/stream/slot/default`;
      collect(await fetchJson(endpoint), 'vk-video');
      return;
    }
    const video = pageUrl.match(/(?:^|\/\/)(?:m\.)?(?:vk\.com|vk\.ru|vkvideo\.ru)\/(?:clip|video|playlist\/[^/]+\/video)(-?\d+_\d+)/i)?.[1];
    if (!video) return;
    const body = new URLSearchParams({ act: 'show', al: '1', video });
    const list = new URL(pageUrl).searchParams.get('list');
    if (list) body.set('list', list);
    const text = await fetchText('https://vk.com/al_video.php', {
      method: 'POST', body,
      headers: { 'X-Requested-With': 'XMLHttpRequest', 'Content-Type': 'application/x-www-form-urlencoded' }
    });
    collect(text, 'vk-video');
  }

  function mediaFromOkDocument(root) {
    for (const element of root.querySelectorAll('div[data-options]')) {
      try {
        const options = JSON.parse(element.getAttribute('data-options'));
        const metadata = typeof options?.flashvars?.metadata === 'string'
          ? JSON.parse(options.flashvars.metadata) : options?.flashvars?.metadata;
        if (metadata?.movie) collect(metadata.movie, 'ok-video');
      } catch {}
    }
  }

  async function discoverOk() {
    if (!/(?:^|\.)ok\.ru$/.test(hostname)) return;
    mediaFromOkDocument(document);
    const id = pageUrl.match(/(?:m\.)?ok\.ru\/(?:video|live|videoembed)\/([^/]+)/i)?.[1]
      || new URL(pageUrl).searchParams.get('st.mvId');
    if (!id || candidates.length) return;
    const html = await fetchText(`https://ok.ru/videoembed/${encodeURIComponent(id)}?nochat=1`);
    if (!html) return;
    mediaFromOkDocument(new DOMParser().parseFromString(html, 'text/html'));
  }

  async function discoverOsmosis() {
    if (hostname !== 'osmosis.org' && hostname !== 'www.osmosis.org') return;
    const html = document.documentElement.innerHTML;
    const hash = html.match(/\\"hls\\":\\"([^"\\]+)\\"/)?.[1];
    if (!hash) return;
    const encoded = await fetchText(`https://www.osmosis.org/videoPlaylist?hash=${encodeURIComponent(hash)}`);
    if (!encoded) return;
    const playlist = [...encoded].reverse().join('').replace(
      /(#EXT-X-KEY:[^\n]*URI=")([^"]+)"/,
      (_, prefix, value) => prefix + absolute(value, 'https://www.osmosis.org') + '"'
    );
    addManifest(playlist, 'hls', 'https://www.osmosis.org/', 'osmosis');
  }

  function discoverEmbeddedState() {
    const globals = [
      globalThis.__NEXT_DATA__, globalThis.__INITIAL_STATE__, globalThis.__initialState,
      globalThis.__playinfo__, globalThis.__PLAYINFO__, globalThis.__dash,
      globalThis.__playerdata__,
      globalThis.ytInitialPlayerResponse, globalThis.playerConfig,
      globalThis.__PLAYER_CONFIG__, globalThis.__NUXT__, globalThis.__APOLLO_STATE__,
      globalThis.vimeo?.clip_page_config
    ];
    for (const value of globals) collect(value, 'site-state');
    for (const script of document.scripts) {
      const text = script.textContent || '';
      if (!text || text.length > 6 * 1024 * 1024) continue;
      const hlsUrl = text.match(/["']hlsManifestUrl["']\s*:\s*["']([^"']+)["']/i)?.[1];
      if (hlsUrl) addUrl(hlsUrl, { source: 'page-script' });
      for (const match of decoded(text).matchAll(/<MPD\b[\s\S]*?<\/MPD>/gi)) addManifest(match[0], 'dash', pageUrl, 'page-script');
    }
  }

  discoverEmbeddedState();
  const tasks = [];
  if (hostname === 'kick.com' || hostname.endsWith('.kick.com')) tasks.push(discoverKick());
  if (/chaturbate\.(?:com|eu|global)$/.test(hostname)) tasks.push(discoverChaturbate());
  if (hostname === 'twitcasting.tv' || hostname.endsWith('.twitcasting.tv')) tasks.push(discoverTwitCasting());
  if (hostname === 'vk.com' || hostname.endsWith('.vk.com') || hostname === 'vk.ru' || hostname.endsWith('.vk.ru')
    || hostname === 'vkvideo.ru' || hostname.endsWith('.vkvideo.ru')) tasks.push(discoverVk());
  if (hostname === 'ok.ru' || hostname.endsWith('.ok.ru')) tasks.push(discoverOk());
  if (hostname === 'osmosis.org' || hostname.endsWith('.osmosis.org')) tasks.push(discoverOsmosis());
  await Promise.allSettled(tasks);
  return { candidates, manifests };
}
