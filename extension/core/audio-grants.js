export const TEMPORARY_AUDIO_ALLOW_MS = 2 * 24 * 60 * 60 * 1000;
export const TEMPORARY_AUDIO_KEY_PREFIX = 'temporaryAudioAllow:';
export const TEMPORARY_AUDIO_ALARM_PREFIX = 'cosmic-gemini:audio-expiry:';

export function temporaryAudioKey(hostname) {
  return TEMPORARY_AUDIO_KEY_PREFIX + hostname;
}

export function temporaryAudioAlarm(hostname) {
  return TEMPORARY_AUDIO_ALARM_PREFIX + encodeURIComponent(hostname);
}

export function hostnameFromTemporaryAudioAlarm(name) {
  if (typeof name !== 'string' || !name.startsWith(TEMPORARY_AUDIO_ALARM_PREFIX)) return '';
  try { return decodeURIComponent(name.slice(TEMPORARY_AUDIO_ALARM_PREFIX.length)); }
  catch { return ''; }
}

export function createTemporaryAudioGrant(now = Date.now()) {
  return { expiresAt: now + TEMPORARY_AUDIO_ALLOW_MS };
}

export function isTemporaryAudioGrantValid(grant, now = Date.now()) {
  return Number.isFinite(grant?.expiresAt) && grant.expiresAt > now;
}
