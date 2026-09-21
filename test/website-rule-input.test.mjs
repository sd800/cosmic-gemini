import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeWebsiteRuleInput } from '../extension/core/website-rule-input.js';

test('website rule inputs expand leading dots and multi-label eTLD entries', () => {
  assert.equal(normalizeWebsiteRuleInput('.example.com'), '*.example.com');
  assert.equal(normalizeWebsiteRuleInput(' .Example.COM '), '*.example.com');
  assert.equal(normalizeWebsiteRuleInput('org.cn'), '*.org.cn');
  assert.equal(normalizeWebsiteRuleInput('公司.cn'), '*.xn--55qx5d.cn');
  assert.equal(normalizeWebsiteRuleInput('github.io'), '*.github.io');
  assert.equal(normalizeWebsiteRuleInput('*.example.com'), '*.example.com');
});

test('website rule inputs preserve ordinary exact hosts and exclude single-label TLDs', () => {
  assert.equal(normalizeWebsiteRuleInput('news.example.com'), 'news.example.com');
  assert.equal(normalizeWebsiteRuleInput('192.0.2.1'), '192.0.2.1');
  assert.equal(normalizeWebsiteRuleInput('[2001:db8::1]'), '[2001:db8::1]');
  for (const input of ['cn', '.cn']) assert.throws(() => normalizeWebsiteRuleInput(input));
});
