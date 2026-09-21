// On-demand, isolated-world reader of Instagram's ordinary profile/list UI.
// No API replay, hidden endpoint, permanent observer, or translated-label matching.
export async function instagramDomRead(input, environment = globalThis) {
  const { document, location } = environment;
  const getComputedStyle = element => environment.getComputedStyle(element);
  const pause = ms => new Promise(resolve => environment.setTimeout(resolve, ms));
  const KEY = '__cosmicGeminiInstagramLists';
  const SCROLLER_DISCOVERY_TIMEOUT = 60000;
  const GROWTH_TIMEOUT = 90000;
  const NUDGE_AFTER = 20000;
  const MAX_NUDGES = 4;
  const MAX_VERIFY_STEPS = 20000;
  const VERIFY_BURST_STEPS = 12;
  const VERIFY_PASSES = 2;
  const VERIFY_SETTLE = 80;
  const VERIFY_SETTLE_POLLS = 6;
  const BOTTOM_CONFIRMATIONS = 2;
  const RESERVED_PATHS = new Set(['accounts', 'about', 'ads', 'api', 'challenge', 'developer', 'direct',
    'directory', 'emails', 'explore', 'legal', 'nametag', 'p', 'privacy', 'push', 'reel', 'reels',
    'sessions', 'stories', 'terms', 'web', 'your_activity']);
  const all = environment[KEY] ||= new Map();
  const visible = element => Boolean(element?.isConnected && element.getClientRects().length
    && getComputedStyle(element).visibility !== 'hidden');
  const close = state => {
    if (state?.confirmDialog && visible(state.confirmDialog) && state.confirmCancel?.isConnected) state.confirmCancel.click();
    if (state?.dialog && visible(state.dialog) && state.closeButton?.isConnected) state.closeButton.click();
    if (state) { state.confirmDialog = null; state.confirmCancel = null; state.dialog = null; state.closeButton = null; }
  };
  if (input.operation === 'cancel') {
    const state = all.get(input.runId);
    if (state) { state.cancelled = true; close(state); all.delete(input.runId); }
    if (!all.size) delete environment[KEY];
    return { ok: true };
  }
  const matches = () => location.protocol === 'https:' && ['www.instagram.com', 'instagram.com'].includes(location.hostname)
    && location.pathname.toLowerCase().replace(/\/(?:reels|tagged)\/?$/, '/').replace(/\/$/, '') === '/' + input.username;
  if (!matches()) return { error: 'igPageChanged' };
  let state = all.get(input.runId);
  if (!state) {
    for (const [id, previous] of all) { previous.cancelled = true; close(previous); all.delete(id); }
    state = { cancelled: false, kind: '', seen: new Set(), lastGrowth: Date.now() }; all.set(input.runId, state); }
  const check = () => { if (state.cancelled) throw new Error('igStopped'); if (!matches()) throw new Error('igPageChanged'); };
  const wait = async ms => { await pause(ms); check(); };
  const profileDestination = source => {
    try {
      const href = typeof source === 'string' ? source : source?.getAttribute('href');
      if (!href) return null;
      const url = new URL(href, location.href);
      const name = url.pathname.replace(/^\/|\/$/g, '');
      if (url.origin !== location.origin || !/^[a-zA-Z0-9._]{1,30}$/.test(name)
        || RESERVED_PATHS.has(name.toLowerCase())) return null;
      return { href: url.href, key: url.origin + '/' + name.toLowerCase() + '/', username: name };
    } catch { return null; }
  };
  const numeric = text => {
    const value = String(text || '').normalize('NFKC').replace(/[٠-٩۰-۹]/g, char => String(char.charCodeAt(0) % 16));
    if (!/^\s*\d[\d\s,.\u066c]*\s*$/.test(value)) return null;
    const count = Number(value.replace(/[^0-9]/g, ''));
    return Number.isSafeInteger(count) ? count : null;
  };
  const linkCount = link => {
    const nodes = [...link.querySelectorAll('[title]'), ...link.querySelectorAll('span')];
    for (const node of nodes) {
      const count = numeric(node.getAttribute('title') || (node.children.length ? '' : node.textContent));
      if (count !== null) return count;
    }
    return numeric(link.textContent);
  };
  const profile = () => {
    const main = document.querySelector('main');
    if (!main) throw new Error('igProfileOnly');
    if (![...main.querySelectorAll('h1,h2')].some(node => node.textContent.trim().toLowerCase() === input.username)) throw new Error('igPageChanged');
    // Canonical hrefs on older layouts; two adjacent numerical links on current layouts.
    let followers = main.querySelector(`a[href="/${input.username}/followers/"]`);
    let following = main.querySelector(`a[href="/${input.username}/following/"]`);
    if (!followers || !following) {
      const candidates = [...main.querySelectorAll('a[href="#"]')]
        .filter(link => visible(link) && !link.querySelector('h1,h2,h3') && linkCount(link) !== null);
      if (candidates.length !== 2) throw new Error('igUnavailable');
      [followers, following] = candidates;
      // Reject unrelated numerical links outside the shared profile count block.
      const parent = followers.parentElement;
      if (!parent?.contains(following) && !parent?.parentElement?.contains(following)) throw new Error('igUnavailable');
    }
    const followerCount = linkCount(followers);
    const followingCount = linkCount(following);
    if (followerCount === null || followingCount === null) throw new Error('igIncomplete');
    const own = [...main.querySelectorAll('a[href]')].some(link => {
      try { return new URL(link.href).pathname.replace(/\/$/, '') === '/accounts/edit'; } catch { return false; }
    });
    return { profile: { id: input.username, username: input.username, name: '', followers: followerCount, following: followingCount },
      ownProfile: own, links: { followers, following } };
  };
  const findClose = dialog => {
    const heading = dialog.querySelector('[role="heading"],h1,h2');
    for (let node = heading?.parentElement; node && node !== dialog; node = node.parentElement) {
      const buttons = node.querySelectorAll('button');
      if (buttons.length === 1 && buttons[0].querySelector('svg')) return buttons[0];
    }
    return null;
  };
  const activeDialogs = () => [...document.querySelectorAll('[role="dialog"]')].filter(visible);
  const exactProfileLink = (root, href) => {
    const expected = profileDestination(href);
    return expected && [...root.querySelectorAll('a[href]')]
      .find(link => profileDestination(link)?.key === expected.key);
  };
  const setInput = (input, value) => {
    const prototype = environment.HTMLInputElement?.prototype || Object.getPrototypeOf(input);
    const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
    if (setter) setter.call(input, value);
    else input.value = value;
    const EventConstructor = environment.Event || Event;
    input.dispatchEvent(new EventConstructor('input', { bubbles: true }));
    input.dispatchEvent(new EventConstructor('change', { bubbles: true }));
  };
  const colorChannels = value => String(value || '').match(/[\d.]+/g)?.slice(0, 3).map(Number);
  const blueAction = button => {
    const style = getComputedStyle(button);
    return [style.backgroundColor, style.color].some(value => {
      const channels = colorChannels(value);
      return channels?.length === 3 && channels[2] >= channels[0] + 80 && channels[2] >= channels[1] + 45;
    });
  };
  const rowAction = (link, dialog) => {
    for (let node = link.parentElement; node && node !== dialog; node = node.parentElement) {
      const buttons = [...node.querySelectorAll('button')].filter(button => visible(button) && !button.disabled
        && !button.contains(link) && !button.querySelector('a[href],img,svg'));
      if (buttons.length === 1) return buttons[0];
      if (buttons.length > 1) return null;
    }
    return null;
  };
  try {
    check();
    const current = profile();
    if (input.operation === 'profile') return { profile: current.profile, ownProfile: current.ownProfile };
    if (input.operation === 'unfollow') {
      let writeStarted = false;
      try {
        const target = String(input.targetUsername || '').toLowerCase();
        if (input.confirmed !== true || !/^[a-z0-9._]{1,30}$/.test(target) || target === input.username) {
          throw new Error('igRelationshipChanged');
        }
        if (!current.ownProfile) throw new Error('igOwnProfileOnly');
        if (activeDialogs().length) throw new Error('igCloseDialog');
        state.kind = 'unfollow';
        const openFollowingSearch = async () => {
          state.dialog = null;
          state.closeButton = null;
          current.links.following.click();
          const listDeadline = Date.now() + 30000;
          while (!state.dialog && Date.now() < listDeadline) {
            await wait(200);
            const dialogs = activeDialogs();
            if (dialogs.length > 1) throw new Error('igCloseDialog');
            state.dialog = dialogs[0] || null;
          }
          if (!state.dialog) throw new Error('igUnavailable');
          state.closeButton = findClose(state.dialog);
          const input = [...state.dialog.querySelectorAll('input')]
            .find(element => visible(element) && element.type !== 'password');
          if (!input || !state.closeButton) throw new Error('igUnavailable');
          return input;
        };
        const visibleAccountIds = root => new Set([...root.querySelectorAll('a[href]')]
          .filter(visible).map(link => profileDestination(link)?.username.toLowerCase()).filter(Boolean));
        const search = await openFollowingSearch();
        setInput(search, target);
        const resultDeadline = Date.now() + 15000;
        let targetLink = null;
        while (!targetLink && Date.now() < resultDeadline) {
          await wait(200);
          targetLink = [...state.dialog.querySelectorAll('a[href]')].find(link =>
            profileDestination(link)?.username.toLowerCase() === target);
        }
        if (!targetLink) throw new Error('igRelationshipChanged');
        const selectedDestination = profileDestination(targetLink);
        const action = rowAction(targetLink, state.dialog);
        if (!action) throw new Error('igUnavailable');
        // Instagram's blue action is Follow. Never let a stale list turn an
        // intended unfollow into the opposite relationship change.
        if (blueAction(action)) throw new Error('igRelationshipChanged');
        action.click();
        const confirmDeadline = Date.now() + 10000;
        while (!state.confirmDialog && Date.now() < confirmDeadline) {
          await wait(150);
          const dialogs = activeDialogs();
          if (dialogs.length > 2) throw new Error('igUnavailable');
          state.confirmDialog = dialogs.find(dialog => dialog !== state.dialog) || null;
        }
        if (!state.confirmDialog || !exactProfileLink(state.confirmDialog, selectedDestination.href)) {
          throw new Error('igRelationshipChanged');
        }
        const buttons = [...state.confirmDialog.querySelectorAll('button')].filter(button => visible(button) && !button.disabled);
        if (buttons.length !== 2) throw new Error('igUnavailable');
        // Instagram's native relationship dialog places the requested action
        // first and Cancel second. Color is not authoritative because site
        // themes and appearance extensions can rewrite it.
        const [confirmAction, cancelAction] = buttons;
        state.confirmCancel = cancelAction;
        writeStarted = true;
        confirmAction.click();
        const confirmDeadlineAfterClick = Date.now() + 10000;
        while (visible(state.confirmDialog) && Date.now() < confirmDeadlineAfterClick) await wait(150);
        if (visible(state.confirmDialog)) throw new Error('igUnfollowUncertain');
        state.confirmDialog = null;
        state.confirmCancel = null;
        if (visible(state.dialog) && state.closeButton?.isConnected) state.closeButton.click();
        const closeDeadline = Date.now() + 10000;
        while (activeDialogs().length && Date.now() < closeDeadline) await wait(150);
        if (activeDialogs().length) throw new Error('igUnfollowUncertain');
        state.dialog = null;
        state.closeButton = null;

        // Only a fresh Following search that settles without the target can
        // confirm success. A detached old row or a changed profile count is
        // insufficient because both can update before the relationship write.
        const verificationSearch = await openFollowingSearch();
        let initialIds = visibleAccountIds(state.dialog);
        const initialListDeadline = Date.now() + 15000;
        while (!initialIds.size && Date.now() < initialListDeadline) {
          await wait(250);
          initialIds = visibleAccountIds(state.dialog);
        }
        if (!initialIds.size && current.profile.following > 1) throw new Error('igUnfollowUncertain');
        const beforeSearch = [...initialIds].sort().join('\n');
        setInput(verificationSearch, target);
        let previousSignature = '';
        let stablePolls = 0;
        const verifyDeadline = Date.now() + 20000;
        for (let poll = 0; Date.now() < verifyDeadline; poll += 1) {
          await wait(250);
          if (!visible(state.dialog) || verificationSearch.value !== target) throw new Error('igUnfollowUncertain');
          const ids = visibleAccountIds(state.dialog);
          const signature = [...ids].sort().join('\n');
          stablePolls = signature === previousSignature ? stablePolls + 1 : 0;
          previousSignature = signature;
          const busy = [...state.dialog.querySelectorAll('[role="progressbar"],[aria-busy="true"]')].some(visible);
          if (poll >= 19 && stablePolls >= 3 && !busy) {
            if (ids.has(target)) throw new Error('igRelationshipChanged');
            // An unchanged nonempty list means the search has not applied yet.
            if (signature === beforeSearch && signature) continue;
            close(state);
            all.delete(input.runId);
            if (!all.size) delete environment[KEY];
            return { unfollowed: true };
          }
        }
        throw new Error('igUnfollowUncertain');
      } catch (error) {
        close(state);
        all.delete(input.runId);
        if (!all.size) delete environment[KEY];
        const code = /^ig[A-Z]/.test(error.message || '') ? error.message : 'igUnavailable';
        return { error: writeStarted && code !== 'igRelationshipChanged' ? 'igUnfollowUncertain' : code };
      }
    }
    if (input.operation !== 'list' || !['followers', 'following'].includes(input.kind)) throw new Error('igUnavailable');
    const estimate = current.profile[input.kind];
    if (!estimate) return { users: [], done: true };
    if (state.kind !== input.kind) {
      close(state);
      if (activeDialogs().length) throw new Error('igCloseDialog');
      state.kind = input.kind; state.seen.clear(); state.lastGrowth = Date.now(); state.nudges = 0;
      state.verification = null; state.fullSweepComplete = false; state.bottomProbe = null;
      state.list = null; state.scroller = null;
      current.links[input.kind].click();
      const deadline = Date.now() + 30000;
      while (!state.dialog && Date.now() < deadline) {
        await wait(200);
        const dialogs = activeDialogs();
        if (dialogs.length > 1) throw new Error('igCloseDialog');
        state.dialog = dialogs[0] || null;
      }
      if (!state.dialog) throw new Error('igUnavailable');
    }
    if (!visible(state.dialog)) throw new Error('igStopped');
    const dialog = state.dialog;
    state.closeButton ||= findClose(dialog);
    if (dialog.querySelector('input[type="password"],a[href*="/accounts/login"]')) throw new Error('igLoginRequired');
    if (dialog.querySelector('input')?.value) throw new Error('igListChanged');
    const users = [];
    const displayName = link => {
      // The name is a separate text line beside the username branch, not the
      // action button, an avatar's accessible label, or a visually hidden
      // verification label. Never match translated words.
      for (let node = link.parentElement; node && node !== state.list; node = node.parentElement) {
        if (node.querySelector('button,[role="button"],input')) break;
        for (const sibling of node.children) {
          if (sibling === link || sibling.contains(link) || !sibling.matches('span[dir="auto"]')) continue;
          if (sibling.querySelector('a,button,svg,[role="button"]')) continue;
          if (!visible(sibling)) continue;
          const rect = sibling.getBoundingClientRect?.();
          if (rect && rect.width <= 2 && rect.height <= 2) continue;
          const style = getComputedStyle(sibling);
          if (style.display === 'none' || style.opacity === '0'
            || /rect\(\s*0(?:px)?[, ]+\s*0(?:px)?[, ]+\s*0(?:px)?[, ]+\s*0(?:px)?\s*\)/.test(style.clip || '')
            || /inset\(\s*50%\s*\)/.test(style.clipPath || '')) continue;
          const name = sibling.textContent.trim();
          if (name) return name.slice(0, 256);
        }
      }
      return '';
    };
    const verifiedAccount = link => {
      // Keep the search inside the username branch so blue action icons elsewhere
      // in the row cannot be mistaken for Instagram's compact verification mark.
      let branch = link;
      for (let parent = link.parentElement; parent && parent !== state.list; parent = parent.parentElement) {
        if (parent.querySelector('button,[role="button"],input')) break;
        branch = parent;
      }
      return [...branch.querySelectorAll('svg')].some(svg => {
        const rect = svg.getBoundingClientRect?.() || {};
        const width = Number.parseFloat(svg.getAttribute('width')) || rect.width || 0;
        const height = Number.parseFloat(svg.getAttribute('height')) || rect.height || 0;
        if (width < 7 || height < 7 || width > 24 || height > 24) return false;
        const colored = [svg, ...svg.querySelectorAll('[fill]')].some(node => {
          const style = getComputedStyle(node);
          return [node.getAttribute('fill'), style.fill, style.color].some(value => {
            const channels = colorChannels(value);
            return channels?.length === 3 && channels[0] <= 80 && channels[1] >= 90
              && channels[2] >= 180 && channels[1] >= channels[0] + 55
              && channels[2] >= channels[1] + 45;
          });
        });
        return colored;
      });
    };
    const collect = () => {
      if (!state.scroller) {
        const anchor = [...dialog.querySelectorAll('a[href]')].find(link => profileDestination(link));
        let fallback = null;
        for (let node = anchor?.parentElement; node && node !== dialog; node = node.parentElement) {
          if (!/auto|scroll/.test(getComputedStyle(node).overflowY) || node.clientHeight <= 50) continue;
          // overflow-x can make overflow-y compute to auto on an unconstrained wrapper.
          // Such a wrapper grows with the rows and cannot trigger the next page.
          fallback = node;
          if (node.scrollHeight > node.clientHeight + 1) { state.scroller = node; break; }
        }
        state.scroller ||= fallback; // A short, already complete list need not overflow.
        if (state.scroller) {
          // Freeze the primary account block; never include a later suggested-accounts section.
          state.list = [...state.scroller.children]
            .find(node => [...node.querySelectorAll('a[href]')].some(link => profileDestination(link)));
          while (state.list?.children.length === 1 && state.list.firstElementChild.querySelector('a[href]')) state.list = state.list.firstElementChild;
        }
      }
      if (state.scroller && !state.list?.isConnected) {
        state.list = [...state.scroller.children]
          .find(node => [...node.querySelectorAll('a[href]')].some(link => profileDestination(link))) || null;
        while (state.list?.children.length === 1 && state.list.firstElementChild.querySelector('a[href]')) {
          state.list = state.list.firstElementChild;
        }
      }
      if (!state.list?.isConnected) return { count: 0, signature: '' };
      const identities = new Map();
      for (const link of state.list.querySelectorAll('a[href]')) {
        const destination = profileDestination(link);
        if (!destination) continue;
        const username = destination.username;
        const id = username.toLowerCase();
        const verified = verifiedAccount(link);
        const score = Number(Boolean(String(link.textContent || '').trim())) + Number(verified) * 2;
        if (!identities.has(id) || score > identities.get(id).score) {
          identities.set(id, { link, username, verified, score });
        }
      }
      for (const [id, identity] of identities) {
        if (state.seen.has(id)) continue;
        state.seen.add(id);
        users.push({ id, username: identity.username, name: displayName(identity.link),
          verified: identity.verified });
      }
      if (users.length) { state.lastGrowth = Date.now(); state.nudges = 0; }
      return { count: identities.size, signature: [...identities.keys()].sort().join('\n') };
    };
    const atBottom = scroller => scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2;
    const settleViewport = async previous => {
      let current = collect();
      let stable = 0;
      for (let poll = 0; poll < VERIFY_SETTLE_POLLS; poll += 1) {
        await wait(VERIFY_SETTLE);
        const next = collect();
        stable = next.signature === current.signature ? stable + 1 : 0;
        current = next;
        // A retained DOM can settle immediately. Virtualized rows must either
        // replace the preceding viewport or remain unchanged through two polls.
        const retained = current.count >= state.seen.size;
        if (stable >= 1 && (current.signature !== previous.signature || retained || poll >= 1)) break;
      }
      return current;
    };
    const verificationStep = async scroller => {
      const verification = state.verification ||= {
        initialized: false, pass: 0, steps: 0
      };
      const previous = collect();
      if (!verification.initialized) {
        verification.initialized = true;
        scroller.scrollTop = 0;
      } else {
        const maximum = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
        scroller.scrollTop = Math.min(maximum,
          scroller.scrollTop + Math.max(90, scroller.clientHeight * .45));
      }
      // Each overlapping viewport is sampled until its mounted identities
      // settle. This prevents a slower React remount from being skipped while
      // the scrollbar has already moved on to the next position.
      await settleViewport(previous);
      verification.steps += 1;
      if (atBottom(scroller)) {
        if (verification.pass + 1 < VERIFY_PASSES) {
          verification.pass += 1;
          verification.initialized = false;
        } else {
          state.fullSweepComplete = true;
          state.verification = null;
        }
      } else if (verification.steps >= MAX_VERIFY_STEPS) throw new Error('igIncomplete');
    };
    const verificationBurst = async scroller => {
      for (let step = 0; state.verification && step < VERIFY_BURST_STEPS; step += 1) {
        await verificationStep(scroller);
      }
    };
    collect();
    while (!state.scroller && Date.now() - state.lastGrowth < SCROLLER_DISCOVERY_TIMEOUT) {
      await wait(300); collect(); state.closeButton ||= findClose(dialog);
    }
    if (!state.scroller || !state.closeButton) throw new Error('igUnavailable');
    const scroller = state.scroller;
    state.nudges ||= 0;
    if (state.verification) {
      await verificationBurst(scroller);
    } else {
      scroller.scrollTop = Math.min(scroller.scrollHeight,
        scroller.scrollTop + Math.max(150, scroller.clientHeight * .65));
      await wait(1200);
      if (!visible(dialog)) throw new Error('igStopped');
      collect();
    }
    let bottom = atBottom(scroller);
    // The displayed profile count and apparent DOM retention are both only
    // hints. Every list receives two complete overlapping top-to-bottom audits.
    if (bottom && !state.fullSweepComplete) {
      state.verification = { initialized: false, pass: 0, steps: 0 };
      state.bottomProbe = null;
      await verificationBurst(scroller);
      bottom = atBottom(scroller) && !state.verification;
    }
    if (bottom) {
      // Virtualized rows can change their pixel height at rest. Completion is
      // governed by reaching the real bottom with an unchanged account set.
      const signature = String(state.seen.size);
      state.bottomProbe = state.bottomProbe?.signature === signature
        ? { signature, confirmations: state.bottomProbe.confirmations + 1 }
        : { signature, confirmations: 1 };
    } else {
      state.bottomProbe = null;
      const stalledFor = Date.now() - state.lastGrowth;
      if (!state.verification && stalledFor >= NUDGE_AFTER && state.nudges < MAX_NUDGES) {
        state.nudges += 1;
        // Virtualized lists occasionally stop requesting rows before the end.
        // Move near the latest bottom and allow Instagram to mount another batch.
        scroller.scrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight * 1.35);
        await wait(500 + state.nudges * 250);
        scroller.scrollTop = scroller.scrollHeight;
        await wait(1200 + state.nudges * 400);
        collect();
      }
      if (!state.verification && Date.now() - state.lastGrowth > GROWTH_TIMEOUT) throw new Error('igIncomplete');
    }
    const done = (state.bottomProbe?.confirmations || 0) >= BOTTOM_CONFIRMATIONS;
    if (done) close(state);
    return { users, done };
  } catch (error) {
    close(state);
    all.delete(input.runId);
    if (!all.size) delete environment[KEY];
    return { error: /^ig[A-Z]/.test(error.message || '') ? error.message : 'igUnavailable' };
  }
}
