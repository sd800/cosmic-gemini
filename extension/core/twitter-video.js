// X discovery is bound to one status, optionally one attachment, never the surrounding timeline.
export function twitterPostContext(value) {
  try {
    const url = new URL(value);
    const isTwitter = ['https:', 'http:'].includes(url.protocol)
      && /^(?:(?:www|m|mobile)\.)?(?:x|twitter)\.com$/.test(url.hostname);
    const match = isTwitter && url.pathname.match(/^\/(?:[\w]+|i\/web)\/status\/(\d+)(?:\/(?:video|photo)\/([1-9]\d*))?\/?$/);
    const postId = match?.[1] || '';
    const mediaIndex = match?.[2] ? Number(match[2]) - 1 : null;
    return { isTwitter, postId, mediaIndex, key: postId ? `${postId}:${mediaIndex ?? 'main'}` : '', pageUrl: url.href };
  } catch { return { isTwitter: false, postId: '', mediaIndex: null, key: '' }; }
}

export function twitterSyndicationUrl(postId) {
  if (!/^\d{1,25}$/.test(String(postId))) return '';
  const id = BigInt(postId);
  const token = ((Number(id / 1000000000000000n) + Number(id % 1000000000000000n) / 1e15) * Math.PI)
    .toString(36).replace(/(0+|\.)/g, '');
  return `https://cdn.syndication.twimg.com/tweet-result?id=${postId}&lang=en&token=${token}`;
}

// A quoted video can have no DOM permalink. Resolve its own media from nearby React data on click only.
export function twitterVideoControlTarget(expectedPageUrl, controlId) {
  if (location.href !== expectedPageUrl || !/^video-[a-z0-9]+-\d+$/.test(controlId)) return null;
  const player = document.querySelector(`[data-cosmic-gemini-video-target="${controlId}"]`);
  if (!player) return null;
  const video = player.querySelector('video');
  const clean = value => { try { const url = new URL(value, location.href); return url.origin + url.pathname; } catch { return ''; } };
  const sources = [video?.poster, video?.currentSrc, video?.src].filter(Boolean).map(clean);
  if (!sources.length) return null;
  const seen = new WeakSet();
  let budget = 3000;
  function inspect(root) {
    const queue = [root];
    for (let i = 0; i < queue.length && budget > 0; i += 1, budget -= 1) {
      const value = queue[i];
      if (!value || typeof value !== 'object' || seen.has(value)) continue;
      seen.add(value);
      const legacy = value.legacy || value;
      const id = String(value.rest_id || value.id_str || legacy.id_str || value.id || '');
      const media = value.mediaDetails || legacy.extended_entities?.media || legacy.extendedEntities?.media || legacy.entities?.media;
      if (/^\d{1,25}$/.test(id) && Array.isArray(media)) {
        const index = media.findIndex(item => {
          const info = item.video_info || item.videoInfo;
          if (!info?.variants) return false;
          return [item.media_url_https, item.media_url, item.mediaUrl, ...info.variants.map(variant => variant.url)]
            .filter(Boolean).some(url => sources.includes(clean(url)));
        });
        if (index >= 0) return { postUrl: `${location.origin}/i/web/status/${id}/video/${index + 1}`, videoIndex: 0 };
      }
      for (const [key, child] of Object.entries(value).slice(0, 100)) {
        if (['children', '_owner', 'return', 'alternate', 'stateNode'].includes(key)) continue;
        if (child && typeof child === 'object' && queue.length < 1000) queue.push(child);
      }
    }
    return null;
  }
  for (let element = player, depth = 0; element && depth < 12 && budget > 0; element = element.parentElement, depth += 1) {
    const props = Object.keys(element).find(key => key.startsWith('__reactProps$'));
    const direct = inspect(props && element[props]);
    if (direct) return direct;
    const key = Object.keys(element).find(name => name.startsWith('__reactFiber$'));
    for (let fiber = key && element[key], count = 0; fiber && count < 8 && budget > 0; fiber = fiber.return, count += 1) {
      const result = inspect(fiber.memoizedProps);
      if (result) return result;
    }
  }
  return null;
}

export function twitterVideoCandidates(payload, context) {
  if (!context?.postId) return [];
  const queue = [payload];
  const seen = new WeakSet();
  const candidates = new Map();
  for (let index = 0; index < queue.length && index < 12000; index += 1) {
    const value = queue[index];
    if (!value || typeof value !== 'object' || seen.has(value)) continue;
    seen.add(value);
    const legacy = value.legacy || value;
    const id = String(value.rest_id || value.id_str || legacy.id_str || value.id || '');
    if (id === context.postId) {
      const media = value.mediaDetails || legacy.extended_entities?.media || legacy.extendedEntities?.media
        || legacy.entities?.media || [];
      if (!Array.isArray(media)) continue;
      if (context.mediaIndex === null && context.videoIndex === undefined) {
        const videos = media.filter(item => ['video', 'animated_gif'].includes(item.type) || item.video_info || item.videoInfo);
        const all = videos.slice(0, 16).flatMap((_, videoIndex) => twitterVideoCandidates(value, {
          ...context, videoIndex, key: `${context.key}:video-${videoIndex}`
        }));
        for (const candidate of all) candidates.set(candidate.url, candidate);
        continue;
      }
      const selected = context.mediaIndex === null
        ? media.filter(item => ['video', 'animated_gif'].includes(item.type) || item.video_info || item.videoInfo)[context.videoIndex || 0]
        : media[context.mediaIndex];
      const info = selected?.video_info || selected?.videoInfo;
      if (!info?.variants) continue;
      const raw = info.variants.slice(0, 32).filter(variant => {
        try { return new URL(variant.url).protocol === 'https:' && new URL(variant.url).hostname === 'video.twimg.com'; }
        catch { return false; }
      });
      const direct = raw.filter(item => (item.content_type || item.contentType) === 'video/mp4' || /\.mp4(?:[?#]|$)/i.test(item.url));
      const variants = direct.length ? direct : raw.filter(item => /\.m3u8(?:[?#]|$)/i.test(item.url));
      const author = value.user?.screen_name || value.core?.user_results?.result?.legacy?.screen_name || '';
      const text = String(legacy.full_text || value.text || '').replace(/\s+/g, ' ').trim();
      const title = `${author ? '@' + author + ' · ' : ''}${text || 'X ' + context.postId}`.slice(0, 220);
      for (const variant of variants) {
        const size = new URL(variant.url).pathname.match(/\/(\d+)x(\d+)\//);
        const width = Number(variant.width || size?.[1] || 0);
        const height = Number(variant.height || size?.[2] || 0);
        candidates.set(variant.url, {
          url: variant.url, kind: direct.length ? 'direct' : 'hls',
          mime: direct.length ? 'video/mp4' : 'application/x-mpegURL',
          source: 'twitter-post', mediaKey: `twitter:${context.key}`,
          title, mediaTitle: title,
          thumbnailUrl: selected.media_url_https || selected.media_url || selected.mediaUrl || '',
          duration: Number(info.duration_millis || info.durationMillis || selected.duration_ms || 0) / 1000,
          width, height,
          qualityLabel: width && height ? `${Math.min(width, height)}p` : '',
          bandwidth: Number(variant.bitrate || variant.bit_rate || 0),
          hasAudio: selected.type !== 'animated_gif', downloadable: true
        });
      }
      continue;
    }
    // Quoted, reposted and related tweets do not own the current post's video.
    for (const [key, child] of Object.entries(value).slice(0, 1000)) {
      if (/^(?:quoted|retweeted|reposted)_/.test(key)) continue;
      if (child && typeof child === 'object' && queue.length < 12000) queue.push(child);
    }
  }
  return [...candidates.values()];
}

// Serialized by chrome.scripting: all helpers and temporary page state stay inside this function.
export async function twitterVideoPageContext(expectedPageUrl, allowRequest = false, discoveryId = '', selectedPostId = '') {
  const current = () => location.href === expectedPageUrl;
  const match = new URL(expectedPageUrl).pathname.match(/^\/(?:[\w]+|i\/web)\/status\/(\d+)/);
  if (!current() || (!match && !/^\d{1,25}$/.test(selectedPostId))) return null;
  const postId = selectedPostId || match[1];
  const extract = root => {
    const queue = [root];
    const seen = new WeakSet();
    for (let index = 0; index < queue.length && index < 6000; index += 1) {
      const value = queue[index];
      if (!value || typeof value !== 'object' || seen.has(value)) continue;
      seen.add(value);
      const legacy = value.legacy || value;
      const id = String(value.rest_id || value.id_str || legacy.id_str || value.id || '');
      const media = value.mediaDetails || legacy.extended_entities?.media || legacy.extendedEntities?.media || legacy.entities?.media;
      if (id === postId && Array.isArray(media)) {
        // Return media metadata only, not React trees, account state or other posts.
        return JSON.parse(JSON.stringify({
          id_str: postId,
          text: legacy.full_text || value.text || '',
          user: { screen_name: value.user?.screen_name || value.core?.user_results?.result?.legacy?.screen_name || '' },
          mediaDetails: media.slice(0, 16)
        }));
      }
      for (const [key, child] of Object.entries(value).slice(0, 500)) {
        if (/^(?:quoted|retweeted|reposted)_/.test(key) || ['children', '_owner', 'return', 'alternate', 'stateNode'].includes(key)) continue;
        if (child && typeof child === 'object' && queue.length < 6000) queue.push(child);
      }
    }
    return null;
  };
  const result = tweet => ({ pageUrl: expectedPageUrl, tweet });
  for (const state of [globalThis.__INITIAL_STATE__, globalThis.__initialState, globalThis.__NEXT_DATA__]) {
    const tweet = extract(state);
    if (tweet) return result(tweet);
  }
  const articles = [...document.querySelectorAll('article[data-testid="tweet"]')].slice(0, 100);
  const article = articles.find(item => {
    const time = item.querySelector('a[href*="/status/"] time');
    return time?.closest('a')?.getAttribute('href')?.match(/\/status\/(\d+)/)?.[1] === postId;
  });
  if (article) {
    const elements = [article, ...article.querySelectorAll('[data-testid="videoPlayer"], video')].slice(0, 12);
    for (const element of elements) {
      const propsKey = Object.keys(element).find(key => key.startsWith('__reactProps$'));
      let tweet = extract(propsKey ? element[propsKey] : null);
      if (tweet) return result(tweet);
      const fiberKey = Object.keys(element).find(key => key.startsWith('__reactFiber$'));
      let fiber = fiberKey ? element[fiberKey] : null;
      for (let depth = 0; fiber && depth < 24; depth += 1, fiber = fiber.return) {
        tweet = extract(fiber.memoizedProps);
        if (tweet) return result(tweet);
      }
    }
  }
  if (!allowRequest || !current()) return result(null);
  // Reuse one operation actually loaded by this page. No guessed query-ID retry loop.
  const entry = performance.getEntriesByType('resource').slice(-3000).reverse().find(item => {
    try {
      const url = new URL(item.name);
      return url.origin === location.origin && /^\/i\/api\/graphql\/[^/]+\/(TweetDetail|TweetResultByRestId)$/.test(url.pathname);
    } catch { return false; }
  });
  const csrf = document.cookie.match(/(?:^|;\s*)ct0=([^;]+)/)?.[1];
  if (!entry || !csrf) return result(null);
  const url = new URL(entry.name);
  let variables;
  try { variables = JSON.parse(url.searchParams.get('variables') || '{}'); } catch { return result(null); }
  if (url.pathname.endsWith('/TweetDetail')) variables.focalTweetId = postId;
  else variables.tweetId = postId;
  variables.includePromotedContent = false;
  url.searchParams.set('variables', JSON.stringify(variables));
  const controller = new AbortController();
  const requestKey = Symbol.for('cosmic-gemini.video-download.twitter-request');
  const request = { discoveryId, controller };
  globalThis[requestKey] = request;
  const abort = () => controller.abort();
  const timer = setTimeout(abort, 7000);
  addEventListener('pagehide', abort, { once: true });
  try {
    const response = await fetch(url.href, {
      method: 'GET', credentials: 'include', signal: controller.signal,
      headers: {
        // Public X web-client identifier, not a user authentication token.
        authorization: 'Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA',
        'x-csrf-token': csrf, 'x-twitter-active-user': 'yes', 'x-twitter-auth-type': 'OAuth2Session'
      }
    });
    if (!response.ok || !current()) return result(null);
    const data = await response.json();
    return current() ? result(extract(data)) : null;
  } catch { return result(null); }
  finally {
    clearTimeout(timer);
    removeEventListener('pagehide', abort);
    if (globalThis[requestKey] === request) delete globalThis[requestKey];
  }
}
