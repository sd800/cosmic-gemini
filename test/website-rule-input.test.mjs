import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeAccessControlRuleInput,
  normalizeGeneralDomainInput,
  normalizeWebsiteRuleInput
} from '../extension/core/website-rule-input.js';
import { siteKey } from '../extension/core/site-key.js';

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

test('general domain inputs reduce pasted website addresses to their registrable site', () => {
  const cases = [
    ['https://www.ilsos.gov/news/2026/article.html?view=1#section', 'ilsos.gov'],
    ['http://news.example.co.uk:8080/path', 'example.co.uk'],
    ['https://alice.github.io/project', 'alice.github.io'],
    ['https://sub.公司.cn/path', 'sub.xn--55qx5d.cn'],
    ['corporate-server.corp/home/employee-management', 'corporate-server.corp'],
    ['https://sub.corporate-server.corp/home/employee-management', 'corporate-server.corp'],
    ['https//sub.corporate-server.corp/home', 'corporate-server.corp'],
    ['HTTP:sub.corporate-server.corp/home', 'corporate-server.corp'],
    ['http/sub.corporate-server.corp/home', 'corporate-server.corp'],
    ['https:/sub.corporate-server.corp/home', 'corporate-server.corp'],
    ['https://[2001:db8::1]:8443/path', '[2001:db8::1]']
  ];
  for (const [url, domain] of cases) {
    assert.equal(normalizeGeneralDomainInput(url), domain, url);
    assert.equal(normalizeAccessControlRuleInput(url), domain, url);
  }
  assert.equal(normalizeGeneralDomainInput('news.example.com'), 'news.example.com',
    'a bare domain keeps its previous subdomain-specific meaning');
  assert.equal(normalizeGeneralDomainInput('*.example.com'), '*.example.com');
  assert.equal(normalizeGeneralDomainInput('192.0.2.1'), '192.0.2.1');
  assert.equal(normalizeGeneralDomainInput('corporate-server.corp'), 'corporate-server.corp');
  assert.equal(siteKey('https://deep.sub.corporate-server.corp/home'), 'corporate-server.corp');
  for (const input of [
    'ftp://news.example.com/file', 'javascript://news.example.com/',
    'https://user:secret@news.example.com/', 'https://news.example.com:bad/path',
    'https://', 'https://news.example.com.evil.test@evil.test/',
    'corporate-server.corp@evil.test/path', 'not-a-domain/path',
    'https:\\corporate-server.corp/home'
  ]) assert.throws(() => normalizeGeneralDomainInput(input), input);
});
