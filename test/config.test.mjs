import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_SETTINGS,
  hostnameFromUrl,
  matchingRule,
  normalizeRule,
  normalizeSettings,
  pageState,
  ruleMatches
} from '../extension/core/config.js';

test('settings default to enabled Standard mode', () => {
  assert.deepEqual(normalizeSettings(), DEFAULT_SETTINGS);
});

test('whitelist rules are normalized, deduplicated, and sorted', () => {
  assert.deepEqual(normalizeSettings({ whitelist: ['B.example.com', '*.example.com', 'b.example.com'] }).whitelist,
    ['*.example.com', 'b.example.com']);
});

test('exact rules match one hostname only', () => {
  assert.equal(ruleMatches('example.com', 'example.com'), true);
  assert.equal(ruleMatches('www.example.com', 'example.com'), false);
});

test('wildcards cover the root domain and every subdomain', () => {
  assert.equal(ruleMatches('example.com', '*.example.com'), true);
  assert.equal(ruleMatches('a.b.example.com', '*.example.com'), true);
  assert.equal(ruleMatches('notexample.com', '*.example.com'), false);
});

test('matchingRule returns the stored rule', () => {
  assert.equal(matchingRule('news.example.com', ['other.com', '*.example.com']), '*.example.com');
});

test('rule parser rejects paths, ports, and misplaced wildcards', () => {
  for (const input of ['https://example.com', 'example.com/path', 'example.com:443', 'a.*.example.com']) {
    assert.throws(() => normalizeRule(input));
  }
});

test('page state combines global state and whitelist state', () => {
  assert.deepEqual(pageState({ enabled: true, mode: 'strong', whitelist: ['*.example.com'] }, 'https://docs.example.com/a'), {
    version: 1,
    enabled: true,
    mode: 'strong',
    whitelist: ['*.example.com'],
    hostname: 'docs.example.com',
    supported: true,
    matchedRule: '*.example.com',
    exactWhitelisted: false,
    active: false
  });
  assert.equal(pageState({ enabled: true }, 'https://openai.com').active, true);
  assert.equal(pageState({ enabled: false }, 'https://openai.com').active, false);
});

test('only HTTP and HTTPS pages expose a hostname', () => {
  assert.equal(hostnameFromUrl('https://example.com/path'), 'example.com');
  assert.equal(hostnameFromUrl('chrome://extensions'), '');
});
