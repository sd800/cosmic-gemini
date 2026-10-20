import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { siteKey } from '../extension/core/site-key.js';

// Deliberately offline: review source membership, domain aliases and campus locations
// in the registry first. A failed or partial remote refresh must never replace it.
const input = new URL('../docs/reference-data/univ-domains/registry.json', import.meta.url);
const output = new URL('../extension/content/mailto-capture/univ-domains-data.js', import.meta.url);
const raw = await readFile(input, 'utf8');
const registry = JSON.parse(raw);
assert.equal(registry.schema, 1);
assert.equal(registry.name, 'univ-domains');
assert.equal(registry.domainPolicy.defaultMatch, 'etld+1');
const records = [...registry.institutions].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const byId = new Map(records.map(record => [record.id, record]));
const mainlandEnglishNames = new Set(records.filter(record => record.coverage['cn-double-first']?.length).map(record => record.zh));
// Decide bilingual eligibility at build time, including explicitly reviewed campus
// relationships. A world-ranking entry or a similar domain is not eligibility.
function hasMainlandEnglishName(record, seen = new Set()) {
  if (mainlandEnglishNames.has(record.zh)) return true;
  if (seen.has(record.id)) return false;
  seen.add(record.id);
  return (record.affiliations || []).some(id => {
    const parent = byId.get(id);
    return parent?.region === 'CN' && hasMainlandEnglishName(parent, seen);
  });
}
const knownInstitutions = new Set(records.map(record => record.id));
const ids = new Set();
const domains = new Map();
const coverage = new Map(Object.keys(registry.sources).map(key => [key, new Set()]));
const broadSuffixes = new Set(['edu', 'ac', 'gov', 'mil', 'edu.cn', 'ac.cn', 'gov.cn', 'mil.cn', 'edu.hk', 'edu.mo', 'edu.tw', 'ac.tw', 'gov.tw', 'mil.tw', 'ac.uk', 'ac.jp', 'ac.kr', 'edu.au', 'gov.mo', 'google.com', 'outlook.com', 'gmail.com']);
// Shared system roots describe the system, never an arbitrarily chosen campus.
const sharedSystemSuffixes = new Set(['cuny.edu', 'suny.edu', 'cu.edu', 'hawaii.edu', 'alaska.edu', 'upr.edu', 'maine.edu']);
function hostname(value) {
  assert.equal(typeof value, 'string');
  assert.ok(value.includes('.') && value.length <= 253 && !broadSuffixes.has(value), `Unsafe institution suffix: ${value}`);
  assert.equal(new URL(`https://${value}`).hostname, value);
  assert.ok(value.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)));
}
const rows = records.map(record => {
  assert.ok(record.id && !ids.has(record.id), `Duplicate institution: ${record.id}`);
  ids.add(record.id);
  assert.ok(typeof record.en === 'string' && record.en.length < 240);
  assert.doesNotMatch(record.en, /&/u, `Use and in school display names: ${record.id}`);
  // Source spellings remain in coverage; display names are reviewed, not
  // mechanically title-cased or rewritten with one campus separator.
  assert.equal(record.en, record.en.trim().replace(/\s+/gu, ' '), `Normalize display-name spacing: ${record.id}`);
  assert.doesNotMatch(record.en, /,\S/u, `Missing space after a display-name comma: ${record.id}`);
  assert.doesNotMatch(record.en, /^The University of\b/i, `Omit the leading article in university display names: ${record.id}`);
  if (record.nameEvidence) {
    assert.ok(Array.isArray(record.nameEvidence) && record.nameEvidence.length);
    for (const url of record.nameEvidence) assert.equal(new URL(url).protocol, 'https:');
  }
  if (!['CN', 'HK', 'MO', 'TW'].includes(record.region) && record.displayChineseName !== true) {
    assert.ok(record.en.trim(), `Missing English school name: ${record.id}`);
  }
  assert.ok(typeof record.zh === 'string' && record.zh.length < 240);
  assert.doesNotMatch(record.zh, /&/u, `Use and in school display names: ${record.id}`);
  assert.match(record.region, /^[A-Z]{2}$/);
  assert.equal(typeof record.subdivision, 'string');
  if (['US', 'CA'].includes(record.region)) assert.ok(record.subdivision, `Missing institution location: ${record.id}`);
  if (record.kind === 'system') {
    assert.equal(record.region, 'US');
    assert.ok(record.coverage['us-systems']?.length && record.evidence?.length, `Missing official system evidence: ${record.id}`);
    for (const url of record.evidence) assert.equal(new URL(url).protocol, 'https:');
  }
  if (record.kind === 'cultural-institution' || record.coverage['cultural-institutions']) {
    assert.equal(record.kind, 'cultural-institution');
    assert.deepEqual(record.coverage['cultural-institutions'], [record.en], `Missing cultural institution membership: ${record.id}`);
    assert.ok(['museum', 'library', 'cultural-foundation'].includes(record.culturalCategory), `Review the cultural purpose: ${record.id}`);
    assert.ok(['nonprofit', 'public-trust', 'public-institution'].includes(record.publicBenefitStatus), `Review public-benefit status: ${record.id}`);
    assert.ok(record.domains.every(domain => /\.edu(?:\.[a-z]{2})?$/.test(domain)), `Review the educational domain: ${record.id}`);
    assert.ok(record.evidence?.length, `Missing official cultural institution evidence: ${record.id}`);
    for (const url of record.evidence) assert.equal(new URL(url).protocol, 'https:');
  }
  if (record.coverage['nonprofit-research-institutions']) {
    assert.equal(record.kind, 'research-organization');
    assert.deepEqual(record.coverage['nonprofit-research-institutions'], [record.en], `Missing research institution membership: ${record.id}`);
    assert.equal(record.publicBenefitStatus, 'nonprofit', `Review nonprofit status: ${record.id}`);
    assert.ok(record.domains.every(domain => /\.edu(?:\.[a-z]{2})?$/.test(domain)), `Review the research institution domain: ${record.id}`);
    assert.ok(record.evidence?.length, `Missing official research institution evidence: ${record.id}`);
    for (const url of record.evidence) assert.equal(new URL(url).protocol, 'https:');
  }
  if (record.affiliations) {
    assert.ok(record.coverage['affiliated-campuses']?.length && record.evidence?.length, `Missing campus evidence: ${record.id}`);
    for (const parent of record.affiliations) assert.ok(parent !== record.id && knownInstitutions.has(parent), `Unknown campus affiliation: ${record.id}: ${parent}`);
  }
  if (record.parentInstitutionId) {
    assert.equal(record.region, 'HK');
    assert.equal(byId.get(record.parentInstitutionId)?.region, 'HK', `Unknown provider parent: ${record.id}`);
  }
  assert.ok(record.domains.length);
  assert.equal(record.addresses.length, 0, `Use institution domains, not full mailbox identities: ${record.id}`);
  const scopedAcademicIdentity = ['CN', 'TW'].includes(record.region) && record.kind !== 'research-organization';
  const academicClass = /\.(?:edu|ac|gov|mil)(?:\.[a-z]{2})?$/;
  if (scopedAcademicIdentity) assert.ok(record.domains.some(domain => academicClass.test(domain)), `Missing academic institution host: ${record.id}`);
  if (record.kind === 'research-organization') assert.ok(record.evidence?.length, `Missing institution evidence: ${record.id}`);
  for (const domain of record.domains) {
    hostname(domain);
    const root = siteKey(`https://${domain}`);
    if (root !== domain) {
      assert.ok(record.subdomainIdentities?.[domain], `Review the distinct campus/institution host or use eTLD+1: ${domain}`);
      assert.ok(!record.domains.includes(root), `Omit a redundant institutional subhost: ${domain}`);
    }
    if (scopedAcademicIdentity && !academicClass.test(domain)) {
      assert.ok(record.aliasEvidence?.[domain]?.length, `Missing reviewed alias evidence: ${record.id}`);
      for (const url of record.aliasEvidence[domain]) assert.equal(new URL(url).protocol, 'https:');
    }
    if (sharedSystemSuffixes.has(domain)) assert.equal(record.kind, 'system', `Do not assign a system root to one campus: ${domain}`);
    assert.ok(!domains.has(domain), `Domain belongs to more than one institution: ${domain}`);
    domains.set(domain, record.id);
  }
  for (const [domain, identity] of Object.entries(record.subdomainIdentities || {})) {
    assert.ok(record.domains.includes(domain) && siteKey(`https://${domain}`) !== domain, `Stale subdomain identity: ${domain}`);
    assert.ok(['institution', 'campus-or-institution'].includes(identity), `Unknown subdomain identity: ${domain}`);
  }
  assert.ok(Object.keys(record.coverage).length);
  for (const [group, members] of Object.entries(record.coverage)) {
    assert.ok(coverage.has(group), `Unknown source cohort: ${group}`);
    for (const member of members) {
      assert.ok(!coverage.get(group).has(member), `Duplicate cohort member: ${group}: ${member}`);
      coverage.get(group).add(member);
    }
  }
  if (record.displayChineseName === true) {
    assert.ok(record.region !== 'CN' && record.affiliations?.some(id => byId.get(id)?.region === 'CN'), `Missing mainland-campus affiliation: ${record.id}`);
  }
  const chineseName = ['CN', 'HK', 'MO', 'TW'].includes(record.region) || record.displayChineseName === true;
  const name = chineseName ? record.zh : record.en;
  assert.ok(name, `Missing display name: ${record.id}`);
  if (chineseName) {
    assert.match(name, /\p{Script=Han}/u, `Use a Chinese school name: ${record.id}`);
  } else {
    assert.doesNotMatch(name, /--|\s-\s/, `Use an en dash for display-name separators: ${record.id}`);
    assert.doesNotMatch(name, /[()（）\u3400-\u9fff]/, `Use an unabbreviated Latin-character name: ${record.id}`);
  }
  const row = [name, record.region, record.subdivision, [...record.domains].sort(), [...record.addresses].sort()];
  if (record.en && chineseName && (record.region !== 'CN' || hasMainlandEnglishName(record))) {
    assert.doesNotMatch(record.en, /\p{Script=Han}|\([A-Z][A-Z0-9-]+\)|--|\s-\s/u, `Use the English school name without an acronym suffix: ${record.id}`);
    row.push(record.en);
  }
  if (record.unitNames) {
    assert.ok(typeof record.unitNames === 'object' && !Array.isArray(record.unitNames));
    const units = Object.entries(record.unitNames).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
    assert.ok(units.length, `Empty university unit names: ${record.id}`);
    for (const [domain, unitName] of units) {
      assert.ok(record.domains.includes(domain) && domain !== record.id, `Unit domain must be a parent-university alias: ${domain}`);
      assert.ok(record.aliasEvidence?.[domain]?.length, `Missing official university unit evidence: ${domain}`);
      assert.ok(typeof unitName === 'string' && unitName.length > 0 && unitName.length < 180);
      assert.equal(unitName, unitName.trim().replace(/\s+/gu, ' '), `Normalize unit-name spacing: ${domain}`);
      assert.doesNotMatch(unitName, /[&\u0000-\u001f\u007f]/u, `Use a plain unit display name: ${domain}`);
      assert.notEqual(unitName, name, `Omit a repeated parent-university name: ${domain}`);
      for (const url of record.aliasEvidence[domain]) assert.equal(new URL(url).protocol, 'https:');
    }
    if (row.length === 5) row.push(null);
    row.push(Object.fromEntries(units));
  }
  return row;
});
for (const [group, members] of coverage) {
  assert.equal(members.size, registry.sources[group].expectedMembers, `Incomplete cohort: ${group}`);
}
// Account for the entire MOE source list, including intentionally unbundled
// missing/outside-policy/shared-host records. Coverage counts must not hide gaps.
const audit = JSON.parse(await readFile(new URL('../docs/reference-data/univ-domains/mainland-domain-audit.json', import.meta.url), 'utf8'));
assert.equal(audit.schools.length, audit.sourceCount);
assert.equal(new Set(audit.schools.map(school => school.code)).size, audit.sourceCount);
for (const [kind, count] of Object.entries(audit.counts)) {
  assert.equal(audit.schools.filter(school => school.kind === kind).length, count);
}
for (const school of audit.schools) {
  assert.ok(['mapped', 'outside-domain-policy', 'unresolved', 'shared-host-review'].includes(school.status));
  if (school.status !== 'mapped') continue;
  const record = byId.get(school.institution);
  assert.ok(record?.coverage[`cn-moe-${school.kind}`]?.includes(school.name), `Unmapped source institution: ${school.name}`);
}
const usAudit = JSON.parse(await readFile(new URL('../docs/reference-data/univ-domains/us-institution-audit.json', import.meta.url), 'utf8'));
assert.equal(usAudit.institutions.length, usAudit.sourceCount);
assert.equal(new Set(usAudit.institutions.map(item => item.unitid)).size, usAudit.sourceCount);
assert.equal(usAudit.institutions.filter(item => item.graduate).length, usAudit.graduateCount);
assert.equal(usAudit.institutions.filter(item => item.specialFocus).length, usAudit.specialFocusCount);
for (const [flag, group] of [['graduate', 'us-graduate-reference'], ['specialFocus', 'us-special-focus-reference']]) {
  assert.equal(registry.sources[group].sourceMembers, usAudit.institutions.filter(item => item[flag]).length);
  assert.equal(registry.sources[group].expectedMembers, usAudit.institutions.filter(item => item[flag] && item.status === 'mapped').length);
}
for (const item of usAudit.institutions) {
  assert.ok(['mapped', 'host-review', 'shared-host-review'].includes(item.status));
  if (item.status !== 'mapped') continue;
  const record = byId.get(item.institution);
  for (const [eligible, group] of [[item.graduate, 'us-graduate-reference'], [item.specialFocus, 'us-special-focus-reference']]) {
    if (eligible) assert.ok(record?.coverage[group]?.includes(`${item.unitid}: ${item.name}`), `Unmapped directory institution: ${item.unitid}`);
  }
}
const medicalAudit = JSON.parse(await readFile(new URL('../docs/reference-data/univ-domains/medical-school-audit.json', import.meta.url), 'utf8'));
assert.equal(medicalAudit.schools.length, medicalAudit.sourceCount);
assert.equal(new Set(medicalAudit.schools.map(item => item.sourceId)).size, medicalAudit.sourceCount);
assert.equal(medicalAudit.sourceCount, registry.sources['medical-school-reference'].sourceMembers);
assert.equal(medicalAudit.schools.filter(item => item.status === 'mapped').length, registry.sources['medical-school-reference'].expectedMembers);
for (const item of medicalAudit.schools) {
  assert.ok(['mapped', 'shared-nonacademic-host'].includes(item.status));
  if (item.status !== 'mapped') {
    assert.ok(item.reason && new URL(item.website).protocol === 'https:');
    continue;
  }
  assert.ok(byId.get(item.institution)?.coverage['medical-school-reference']?.includes(`${item.sourceId}: ${item.name}`),
    `Unmapped medical school: ${item.sourceId}`);
}
const regionalAudit = JSON.parse(await readFile(new URL('../docs/reference-data/univ-domains/regional-institution-audit.json', import.meta.url), 'utf8'));
assert.equal(regionalAudit.schema, 1);
assert.equal(regionalAudit.schools.length, regionalAudit.sourceCount);
assert.equal(new Set(regionalAudit.schools.map(item => `${item.group}:${item.sourceId}`)).size, regionalAudit.sourceCount);
const regionalGroups = new Set(regionalAudit.schools.map(item => item.group));
for (const group of regionalGroups) {
  const selected = regionalAudit.schools.filter(item => item.group === group);
  assert.equal(registry.sources[group]?.sourceMembers, selected.length, `Regional source count: ${group}`);
  assert.equal(registry.sources[group].expectedMembers, selected.filter(item => item.status === 'mapped').length, `Regional mapped count: ${group}`);
  assert.deepEqual(coverage.get(group), new Set(selected.filter(item => item.status === 'mapped').map(item => item.member)), `Regional membership: ${group}`);
}
for (const item of regionalAudit.schools) {
  assert.ok(['mapped', 'outside-scope', 'scope-review', 'host-review', 'shared-host-review', 'name-location-review'].includes(item.status));
  assert.equal(item.member, `${item.sourceId}: ${item.sourceName}`);
  if (item.status === 'mapped') {
    assert.equal(item.eligible, true);
    assert.ok(byId.get(item.institution)?.coverage[item.group]?.includes(item.member), `Unmapped regional institution: ${item.group}: ${item.sourceId}`);
  } else assert.ok(item.reason && !item.institution, `Account for regional source gaps: ${item.sourceId}`);
}
for (const [status, count] of Object.entries(regionalAudit.counts)) {
  assert.equal(regionalAudit.schools.filter(item => item.status === status).length, count);
}
const hash = createHash('sha256').update(raw).digest('hex');
const result = `// Generated by scripts/update-univ-domains.mjs; reviewed ${registry.reviewed}.
// Domain facts: Hipo / GlobalUniversityHomePages (MIT) and official directories; see univ-domains-LICENSE.txt.
// Source editions, membership, campus locations and corrections: docs/reference-data/univ-domains/.
// Registry SHA-256: ${hash}
(() => {
  const KEY = Symbol.for('cosmic-gemini.mailto-capture.univ-domains-data');
  if (!globalThis[KEY]) globalThis[KEY] = Object.freeze(${JSON.stringify(rows)});
})();
`;
assert.ok(Buffer.byteLength(result) < 500_000, 'Keep the injected offline reference compact.');
if (process.argv.includes('--check')) {
  assert.equal(await readFile(output, 'utf8'), result, 'Regenerate the university reference after registry changes.');
} else await writeFile(output, result);
console.log(`${fileURLToPath(output)}: ${rows.length} institutions, ${domains.size} domain suffixes, ${Buffer.byteLength(result)} bytes.`);
