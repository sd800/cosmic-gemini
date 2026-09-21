import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeAccessControlRuleInput,
  normalizeWebsiteRuleInput
} from '../extension/core/website-rule-input.js';

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

test('Access Control input aliases resolve to canonical root domains', () => {
  const aliases = new Map([
    ['xhs', 'xiaohongshu.com'],
    ['xiaohongshu', 'xiaohongshu.com'],
    ['dy', 'douyin.com'],
    ['douyin', 'douyin.com'],
    ['bili', 'bilibili.com'],
    ['bilibili', 'bilibili.com'],
    ['bzhan', 'bilibili.com'],
    ['ins', 'instagram.com'],
    ['ig', 'instagram.com'],
    ['instagram', 'instagram.com']
  ]);
  for (const [alias, domain] of aliases) {
    assert.equal(normalizeAccessControlRuleInput(alias), domain);
  }
  assert.equal(normalizeAccessControlRuleInput(' XHS '), 'xiaohongshu.com');
  assert.equal(normalizeAccessControlRuleInput('*.Example.com'), 'example.com');
  assert.equal(normalizeAccessControlRuleInput('192.0.2.1'), '192.0.2.1');
  for (const ambiguous of ['bi', 'bz', 'bl']) assert.throws(() => normalizeAccessControlRuleInput(ambiguous));
});
