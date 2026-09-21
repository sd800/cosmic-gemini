import assert from 'node:assert/strict';
import test from 'node:test';
import { etld, etldMetadata } from '../extension/core/etld.js';

test('etld contains ICANN, provider, and PSL PRIVATE DOMAINS-sector geographic eTLD rules', () => {
  assert.equal(Object.isFrozen(etld), true);
  assert.equal(Object.isFrozen(etldMetadata), true);
  assert.equal(new Set(etld).size, etld.length);
  assert.equal(etld.length, etldMetadata.ruleCount);
  assert.equal(etldMetadata.ruleCount,
    etldMetadata.icannRuleCount + etldMetadata.privateExceptionRuleCount);
  assert.match(etldMetadata.version, /^\d{4}-\d{2}-\d{2}_/);
  assert.match(etldMetadata.commit, /^[0-9a-f]{40}$/);
  assert.match(etldMetadata.sha256, /^[0-9a-f]{64}$/);
  assert.deepEqual(etldMetadata.privateGroups, [
    'CentralNic',
    'Cloudflare, Inc.',
    'Coordination Center for TLD RU and XN--P1AI',
    'EU.org',
    'GitHub, Inc.',
    'GitLab, Inc.'
  ]);
  assert.equal(etldMetadata.pslPrivateDomainsSectorGeographicEtldRuleCount, 10);

  for (const rule of ['com', 'co.uk', '*.ck', '!www.ck', '公司.cn', '中国']) {
    assert.ok(etld.includes(rule), `missing ICANN rule ${rule}`);
  }
  for (const rule of [
    'github.app', 'githubusercontent.com', 'githubpreview.dev', 'github.io',
    'gitlab.io',
    'cloudflare.app', 'cf-ipfs.com', 'pages.dev', 'workers.dev', 'cdn.cloudflare.net',
    'br.com', 'uk.com', 'com.de', 'gb.net', 'ae.org',
    'ac.ru', 'edu.ru', 'gov.ru', 'int.ru', 'mil.ru',
    'eu.org', 'asso.eu.org', 'de.eu.org', 'jp.eu.org', 'uk.eu.org', 'us.eu.org'
  ]) {
    assert.ok(etld.includes(rule), `missing selected PRIVATE rule ${rule}`);
  }
  for (const rule of ['appspot.com', 'blogspot.com', 'vercel.app', 'amazonaws.com']) {
    assert.equal(etld.includes(rule), false, `unexpected PRIVATE rule ${rule}`);
  }
});
