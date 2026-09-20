export const INSTAGRAM_PANEL_PATH = 'workspaces/follow-list-instagram/follow-list-instagram.html';

const RESERVED = new Set(['accounts', 'about', 'ads', 'api', 'challenge', 'developer', 'direct', 'directory', 'emails', 'explore', 'legal', 'nametag', 'p', 'privacy', 'push', 'reel', 'reels', 'sessions', 'stories', 'terms', 'web', 'your_activity']);

export function instagramRoute(value) {
  try {
    const url = new URL(value);
    const supported = url.protocol === 'https:' && ['instagram.com', 'www.instagram.com'].includes(url.hostname);
    const parts = url.pathname.split('/').filter(Boolean);
    const username = (parts[0] || '').toLowerCase();
    const profile = supported && /^[a-z0-9._]{1,30}$/.test(username) && !RESERVED.has(username)
      && (parts.length === 1 || (parts.length === 2 && ['reels', 'tagged'].includes(parts[1])));
    return { supported, username: profile ? username : '' };
  } catch { return { supported: false, username: '' }; }
}

export function compareInstagramLists(following, followers) {
  const outbound = new Map(following.map(account => [account.id, account]));
  const inbound = new Map(followers.map(account => [account.id, account]));
  const verifiedLast = accounts => accounts
    .map((account, position) => ({ account, position }))
    .sort((left, right) => Number(left.account.verified) - Number(right.account.verified)
      || left.position - right.position)
    .map(entry => entry.account);
  return {
    notFollowingBack: verifiedLast([...outbound.values()].filter(account => !inbound.has(account.id))),
    mutual: [...outbound.values()].filter(account => inbound.has(account.id)),
    followersOnly: [...inbound.values()].filter(account => !outbound.has(account.id))
  };
}
