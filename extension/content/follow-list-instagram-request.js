// Serialized by the product into the isolated world; no persistent page observer or page bridge.
export async function instagramPageRequest(input) {
  const key = '__cosmicGeminiFollowListInstagramRequest';
  const controllerKey = input.runId;
  const controllers = globalThis[key] ||= new Map();
  if (input.operation === 'cancel') {
    controllers.get(controllerKey)?.abort();
    return { ok: true };
  }
  if (location.protocol !== 'https:' || !['instagram.com', 'www.instagram.com'].includes(location.hostname)) {
    return { error: 'igPageChanged' };
  }
  const profileMatches = () => {
    const parts = location.pathname.split('/').filter(Boolean);
    return parts[0]?.toLowerCase() === input.username
      && (parts.length === 1 || (parts.length === 2 && ['reels', 'tagged'].includes(parts[1])));
  };
  if (!profileMatches()) return { error: 'igPageChanged' };
  const cookie = name => {
    const value = document.cookie.split(';').find(part => part.trim().startsWith(name + '='));
    try { return value ? decodeURIComponent(value.trim().slice(name.length + 1)) : ''; } catch { return ''; }
  };
  const controller = new AbortController();
  controllers.get(controllerKey)?.abort();
  controllers.set(controllerKey, controller);
  const timeout = setTimeout(() => controller.abort(), 20000);
  const request = async (path, body) => {
    if (!profileMatches()) throw new Error('igPageChanged');
    const headers = { Accept: 'application/json', 'X-IG-App-ID': '936619743392459', 'X-Requested-With': 'XMLHttpRequest' };
    const csrf = cookie('csrftoken');
    if (csrf) headers['X-CSRFToken'] = csrf;
    if (body) {
      if (!csrf) throw new Error('igLoginRequired');
      headers['X-CSRFToken'] = csrf;
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
    }
    const response = await fetch(new URL(path, location.origin).href, {
      method: body ? 'POST' : 'GET', headers, credentials: 'include', cache: 'no-store',
      redirect: 'error', signal: controller.signal, ...(body ? { body } : {})
    });
    if (response.status === 429) throw new Error('igRateLimited');
    if (response.status === 401) throw new Error('igLoginRequired');
    if (response.status === 403) throw new Error('igAccessDenied');
    if (!response.ok) throw new Error('igUnavailable');
    let json;
    try { json = await response.json(); } catch { throw new Error('igUnavailable'); }
    if (json?.checkpoint_url || json?.challenge || /challenge|checkpoint/i.test(String(json?.message || ''))) throw new Error('igAccessDenied');
    if (json?.message === 'login_required') throw new Error('igLoginRequired');
    if (/please wait|feedback_required/i.test(String(json?.message || ''))) throw new Error('igRateLimited');
    if (json?.status !== 'ok') throw new Error('igUnavailable');
    return json;
  };
  const numericId = id => /^\d{1,30}$/.test(String(id || ''));
  try {
    if (input.operation === 'unfollow') {
      if (input.confirmed !== true || !/^[a-zA-Z0-9._]{1,30}$/.test(input.targetUsername || '')
        || input.username === input.targetUsername.toLowerCase()) throw new Error('igUnavailable');
      const viewer = await request('/api/v1/accounts/current_user/?edit=true');
      const viewerId = String(viewer.user?.pk ?? viewer.user?.id);
      if (!numericId(viewerId) || viewer.user?.username?.toLowerCase() !== input.username
        || cookie('ds_user_id') !== viewerId) throw new Error('igOwnProfileOnly');
      const target = (await request('/api/v1/users/web_profile_info/?username=' + encodeURIComponent(input.targetUsername))).data?.user;
      const targetId = String(target?.pk ?? target?.id);
      if (!numericId(targetId) || targetId === viewerId || target?.username?.toLowerCase() !== input.targetUsername.toLowerCase()) throw new Error('igRelationshipChanged');
      const relationship = await request(`/api/v1/friendships/${targetId}/show/`);
      const friendship = relationship.friendship_status || relationship;
      if (friendship.following !== true || friendship.followed_by !== false) throw new Error('igRelationshipChanged');
      if (cookie('ds_user_id') !== viewerId) throw new Error('igOwnProfileOnly');
      await request(`/api/v1/web/friendships/${targetId}/unfollow/`, 'container_module=profile');
      const confirmed = await request(`/api/v1/friendships/${targetId}/show/`);
      if ((confirmed.friendship_status || confirmed).following !== false) throw new Error('igUnfollowUncertain');
      return { unfollowed: true };
    }
    throw new Error('igUnavailable');
  } catch (error) {
    const code = /^ig[A-Z]/.test(error?.message || '') ? error.message
      : input.operation === 'unfollow' ? 'igUnfollowUncertain'
        : controller.signal.aborted ? 'igTimedOut' : 'igUnavailable';
    return { error: code };
  } finally {
    clearTimeout(timeout);
    if (controllers.get(controllerKey) === controller) controllers.delete(controllerKey);
    if (!controllers.size) delete globalThis[key];
  }
}
