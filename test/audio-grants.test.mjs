import assert from 'node:assert/strict';
import test from 'node:test';
import {
  TEMPORARY_AUDIO_ALLOW_MS,
  createTemporaryAudioGrant,
  hostnameFromTemporaryAudioAlarm,
  isTemporaryAudioGrantValid,
  temporaryAudioAlarm,
  temporaryAudioKey
} from '../extension/core/audio-grants.js';

test('temporary sound permission lasts no more than two days', () => {
  const now = 1_000;
  const grant = createTemporaryAudioGrant(now);
  assert.equal(grant.expiresAt, now + TEMPORARY_AUDIO_ALLOW_MS);
  assert.equal(isTemporaryAudioGrantValid(grant, grant.expiresAt - 1), true);
  assert.equal(isTemporaryAudioGrantValid(grant, grant.expiresAt), false);
});

test('temporary sound storage contains only its hostname and expiry', () => {
  assert.equal(temporaryAudioKey('radio.example'), 'temporaryAudioAllow:radio.example');
  const alarm = temporaryAudioAlarm('radio.example');
  assert.equal(hostnameFromTemporaryAudioAlarm(alarm), 'radio.example');
  assert.deepEqual(Object.keys(createTemporaryAudioGrant(0)), ['expiresAt']);
});
