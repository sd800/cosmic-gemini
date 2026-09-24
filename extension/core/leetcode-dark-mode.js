function leetcodeUrl(value) {
  try {
    const url = new URL(value);
    return url.origin === 'https://leetcode.com' ? url : null;
  } catch { return null; }
}

export function isLeetCodeExplorePage(value) {
  return /^\/explore\/[^/]+/.test(leetcodeUrl(value)?.pathname || '');
}

export function isLeetCodeExploreFrame(topUrl, frameUrl) {
  return isLeetCodeExplorePage(topUrl) && (isLeetCodeExplorePage(frameUrl)
    || /^\/playground\/[^/]+/.test(leetcodeUrl(frameUrl)?.pathname || ''));
}

export function leetcodeDarkModeState(settings, url) {
  const enabled = settings.leetcodeDarkMode?.enabled === true;
  const supported = isLeetCodeExplorePage(url);
  // Page runtime, not background, owns detection of LeetCode's native theme.
  return { enabled, supported, active: enabled && supported };
}
