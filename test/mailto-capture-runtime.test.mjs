import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

class SimpleEventTarget {
  constructor() { this.listeners = new Map(); }
  addEventListener(type, listener) { this.listeners.set(type, [...(this.listeners.get(type) || []), listener]); }
  removeEventListener(type, listener) {
    this.listeners.set(type, (this.listeners.get(type) || []).filter(item => item !== listener));
  }
  dispatchEvent(event) {
    event.target ||= this;
    for (const listener of this.listeners.get(event.type) || []) listener.call(this, event);
  }
}

class FakeAnchor {
  constructor(href) { this.href = href; this.isConnected = true; }
  getAttribute(name) { return name === 'href' ? this.href : null; }
  focus() {}
}

class FakeCustomEvent {
  constructor(type, init = {}) { this.type = type; this.detail = init.detail; this.target = null; }
}

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName;
    this.className = '';
    this.textContent = '';
    this.children = [];
  }
  append(...children) { this.children.push(...children); }
}

function renderedText(element) {
  return String(element.textContent || '') + element.children.map(child => (
    typeof child === 'string' ? child : renderedText(child)
  )).join('');
}

async function runtimeFixture({ intl = Intl } = {}) {
  const window = new SimpleEventTarget();
  const context = {
    window,
    document: {},
    navigator: {},
    HTMLAnchorElement: FakeAnchor,
    CustomEvent: FakeCustomEvent,
    Uint8Array,
    WeakMap,
    Map,
    Set,
    Symbol,
    JSON,
    Reflect,
    Number,
    String,
    Math,
    Object,
    Promise,
    Intl: intl,
    URL,
    atob: value => Buffer.from(value, 'base64').toString('binary'),
    decodeURIComponent,
    requestAnimationFrame: () => 1,
    cancelAnimationFrame() {},
    crypto: { getRandomValues: values => { values.fill(9); return values; } }
  };
  vm.createContext(context);
  const nanpSource = await readFile(new URL('../extension/content/mailto-capture/mailto-capture-nanp.js', import.meta.url), 'utf8');
  vm.runInContext(nanpSource, context);
  const phoneSource = await readFile(new URL('../extension/content/mailto-capture/mailto-capture-phone.js', import.meta.url), 'utf8');
  vm.runInContext(phoneSource, context);
  for (const name of ['univ-domains-data.js', 'univ-domains.js']) {
    vm.runInContext(await readFile(new URL(`../extension/content/mailto-capture/${name}`, import.meta.url), 'utf8'), context);
  }
  vm.runInContext(await readFile(new URL('../extension/shared/external-links-capture/protocols.js', import.meta.url), 'utf8'), context);
  const source = await readFile(new URL('../extension/content/mailto-capture/mailto-capture-runtime.js', import.meta.url), 'utf8');
  vm.runInContext(source, context);
  return { context, runtime: context[Symbol.for('cosmic-gemini.mailto-capture.runtime')] };
}

test('University references cover every reviewed cohort and resolve all explicit domains offline', async () => {
  const { context } = await runtimeFixture();
  const registry = JSON.parse(await readFile(new URL('../docs/reference-data/univ-domains/registry.json', import.meta.url), 'utf8'));
  const { lookup } = context[Symbol.for('cosmic-gemini.mailto-capture.univ-domains')];
  const coverage = new Map(Object.keys(registry.sources).map(key => [key, new Set()]));
  const mainlandNames = new Set(registry.institutions.filter(item => item.coverage['cn-double-first']?.length).map(item => item.zh));
  const qualified = (item, seen = new Set()) => {
    if (mainlandNames.has(item.zh)) return true;
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return item.affiliations?.some(id => {
      const parent = registry.institutions.find(value => value.id === id);
      return parent?.region === 'CN' && qualified(parent, seen);
    }) || false;
  };
  for (const institution of registry.institutions) {
    const chineseName = ['CN', 'HK', 'MO', 'TW'].includes(institution.region) || institution.displayChineseName === true;
    const expected = chineseName ? institution.zh : institution.en;
    for (const [group, names] of Object.entries(institution.coverage)) {
      for (const name of names) coverage.get(group).add(name);
    }
    for (const domain of institution.domains) {
      if (['CN', 'TW'].includes(institution.region) && institution.kind !== 'research-organization') {
        const academicClass = /\.(?:edu|ac|gov|mil)(?:\.[a-z]{2})?$/;
        assert.ok(institution.domains.some(host => academicClass.test(host)), institution.id);
        if (!academicClass.test(domain)) assert.ok(institution.aliasEvidence?.[domain]?.length, domain);
      }
      assert.equal(lookup(`fixture@${domain}`).name, expected, domain);
      assert.equal(lookup(`fixture@${domain}`, 'zh-CN').name, expected, domain);
      const bilingual = chineseName && (institution.region !== 'CN' || qualified(institution));
      assert.equal(lookup(`fixture@${domain}`).englishName, bilingual && institution.en ? institution.en : undefined, domain);
      assert.equal(lookup(`fixture@${domain}`, 'zh-CN').englishName, undefined, domain);
    }
    assert.equal(institution.addresses.length, 0, institution.id);
    if (['US', 'CA'].includes(institution.region)) {
      const address = `fixture@${institution.domains[0]}`;
      assert.ok(lookup(address).region.startsWith(`${institution.subdivision}, `), institution.id);
    }
    if (chineseName) {
      assert.doesNotMatch(expected, /[國學臺灣醫藥華東長榮門體藝術師範聯實踐銘傳濟義寧]/, institution.id);
    } else {
      assert.doesNotMatch(expected, /[()（）\u3400-\u9fff]/, institution.id);
      assert.ok([...expected].every(character => !/\p{Letter}/u.test(character) || /\p{Script=Latin}/u.test(character) || /[ʻʼ]/u.test(character)), institution.id);
    }
  }
  for (const [group, members] of coverage) assert.equal(members.size, registry.sources[group].expectedMembers, group);
});

test('University display names retain reviewed full names, capitalization and institution-specific separators', async () => {
  const { context } = await runtimeFixture();
  const displayRows = vm.runInContext("globalThis[Symbol.for('cosmic-gemini.mailto-capture.univ-domains-data')]", context);
  const { lookup } = context[Symbol.for('cosmic-gemini.mailto-capture.univ-domains')];
  for (const [domain, name] of [
    ['albany.edu', 'State University of New York at Albany'],
    ['buffalo.edu', 'State University of New York at Buffalo'],
    ['binghamton.edu', 'State University of New York at Binghamton'],
    ['stonybrook.edu', 'State University of New York at Stony Brook'],
    ['geneseo.edu', 'State University of New York College at Geneseo'],
    ['purchase.edu', 'State University of New York College at Purchase'],
    ['oldwestbury.edu', 'State University of New York at Old Westbury'],
    ['cuny.edu', 'City University of New York'],
    ['hunter.cuny.edu', 'Hunter College'],
    ['mec.cuny.edu', 'Medgar Evers College'],
    ['unc.edu', 'University of North Carolina at Chapel Hill'],
    ['uncg.edu', 'University of North Carolina at Greensboro'],
    ['charlotte.edu', 'University of North Carolina at Charlotte'],
    ['uncc.edu', 'University of North Carolina at Charlotte'],
    ['uic.edu', 'University of Illinois at Chicago'],
    ['ucsd.edu', 'University of California, San Diego'],
    ['manoa.hawaii.edu', 'University of Hawaiʻi at Mānoa'],
    ['pacific.edu', 'University of the Pacific'],
    ['uab.edu', 'University of Alabama at Birmingham'],
    ['uah.edu', 'University of Alabama in Huntsville'],
    ['uark.edu', 'University of Arkansas at Fayetteville'],
    ['uta.edu', 'University of Texas at Arlington'],
    ['utdallas.edu', 'University of Texas at Dallas'],
    ['utep.edu', 'University of Texas at El Paso'],
    ['utsa.edu', 'University of Texas at San Antonio'],
    ['utexas.edu', 'University of Texas at Austin'],
    ['anu.edu.au', 'Australian National University'],
    ['gwu.edu', 'George Washington University'],
    ['lse.ac.uk', 'London School of Economics and Political Science'],
    ['ccny.cuny.edu', 'City College of New York'],
    ['wooster.edu', 'College of Wooster'],
    ['osu.edu', 'The Ohio State University'],
    ['newschool.edu', 'The New School, New York City and Paris'],
    ['sewanee.edu', 'Sewanee: The University of the South'],
    ['depaul.edu', 'DePaul University'],
    ['desales.edu', 'DeSales University'],
    ['dyu.edu', "D'Youville University"],
    ['ncat.edu', 'North Carolina Agricultural and Technical State University'],
    ['northeastern.edu', 'Northeastern University'],
    ['neu.edu', 'Northeastern University'],
    ['umkc.edu', 'University of Missouri–Kansas City'],
    ['umsl.edu', 'University of Missouri–St. Louis'],
    ['uwm.edu', 'University of Wisconsin–Milwaukee'],
    ['unl.edu', 'University of Nebraska–Lincoln'],
    ['newark.rutgers.edu', 'Rutgers University–Newark'],
    ['uml.edu', 'University of Massachusetts Lowell'],
    ['ohsu.edu', 'Oregon Health and Science University'],
    ['tamu.edu', 'Texas A and M University'],
    ['fandm.edu', 'Franklin and Marshall College'],
    ['pratt.edu', 'Pratt Institute'],
    ['rose-hulman.edu', 'Rose-Hulman Institute of Technology'],
    ['olin.edu', 'Franklin W. Olin College of Engineering'],
    ['cooper.edu', 'Cooper Union for the Advancement of Science and Art'],
    ['london.edu', 'London Business School'],
    ['mayo.edu', 'Mayo Clinic College of Medicine and Science'],
    ['noordacom.org', 'Noorda College of Osteopathic Medicine'],
    ['alwmedschool.org', 'Alice L. Walton School of Medicine'],
    ['uri.edu', 'University of Rhode Island'],
    ['trinitydc.edu', 'Trinity Washington University'],
    ['umes.edu', 'University of Maryland Eastern Shore']
  ]) {
    for (const locale of ['en-US', 'zh-CN']) assert.equal(lookup(`person@${domain}`, locale).name, name, `${domain}: ${locale}`);
  }
  for (const row of displayRows) {
    assert.doesNotMatch(row[0], /&/u);
    assert.doesNotMatch(row[0], /^The University of\b/i);
    if (row[5]) {
      assert.doesNotMatch(row[5], /&/u);
      assert.doesNotMatch(row[5], /^The University of\b/i);
    }
  }
  for (const [domain, name] of [
    ['nutc.edu.tw', 'National Taichung University of Science and Technology'],
    ['ntub.edu.tw', 'National Taipei University of Business'],
    ['nhu.edu.tw', 'Nanhua University'],
    ['ctcn.edu.tw', 'Cardinal Tien Junior College of Healthcare and Management']
  ]) {
    assert.equal(lookup(`person@${domain}`).englishName, name, domain);
    assert.equal(lookup(`person@${domain}`, 'zh-CN').englishName, undefined, domain);
  }
});

test('University matching respects DNS boundaries, campus identity and localized region names', async () => {
  const { context } = await runtimeFixture();
  const { lookup } = context[Symbol.for('cosmic-gemini.mailto-capture.univ-domains')];
  assert.equal(lookup('ALICE+sample@CS.UCHICAGO.EDU.').name, 'University of Chicago');
  assert.equal(lookup('Alice <alice@uchicago.edu>').region, 'Illinois, USA');
  assert.equal(lookup('alice@uchicago.edu', 'zh-CN').region, 'Illinois, USA');
  assert.equal(lookup('alice@utoronto.ca').region, 'Ontario, Canada');
  assert.equal(lookup('"alice@unit"@mit.edu').name, 'Massachusetts Institute of Technology');
  assert.equal(lookup('student@ucla.edu').name, 'University of California, Los Angeles');
  assert.equal(lookup('student@umich.edu').name, 'University of Michigan');
  assert.equal(lookup('student@umd.umich.edu').name, 'University of Michigan–Dearborn');
  assert.equal(lookup('student@UMD.UMICH.EDU').region, 'Michigan, USA');
  assert.equal(lookup('student@department.umd.umich.edu', 'zh-CN').name, 'University of Michigan–Dearborn');
  assert.equal(lookup('student@umdearborn.edu').name, 'University of Michigan–Dearborn');
  assert.equal(lookup('student@notumd.umich.edu').name, 'University of Michigan');
  assert.equal(lookup('student@wisc.edu').name, 'University of Wisconsin–Madison');
  assert.equal(lookup('student@camden.rutgers.edu').name, 'Rutgers University–Camden');
  assert.equal(lookup('student@illinois.edu').name, 'University of Illinois at Urbana-Champaign');
  assert.equal(lookup('student@univ-amu.fr').name, 'Aix-Marseille Université');
  for (const [address, name, region] of [
    ['contact@ARTIC.EDU', 'Art Institute of Chicago', 'Illinois, USA'],
    ['contact@saic.edu', 'School of the Art Institute of Chicago', 'Illinois, USA'],
    ['contact@si.edu', 'Smithsonian Institution', 'District of Columbia, USA'],
    ['contact@naturalhistory.si.edu', 'Smithsonian Institution', 'District of Columbia, USA'],
    ['contact@getty.edu', 'J. Paul Getty Trust', 'California, USA'],
    ['contact@gri.getty.edu', 'J. Paul Getty Trust', 'California, USA'],
    ['contact@exploratorium.edu', 'Exploratorium', 'California, USA'],
    ['contact@folger.edu', 'Folger Shakespeare Library', 'District of Columbia, USA'],
    ['contact@amherst.edu', 'Amherst College', 'Massachusetts, USA'],
    ['contact@mpm.edu', 'Milwaukee Public Museum', 'Wisconsin, USA'],
    ['contact@crl.edu', 'Center for Research Libraries', 'Illinois, USA'],
    ['contact@clarkart.edu', 'Sterling and Francine Clark Art Institute', 'Massachusetts, USA'],
    ['contact@SANTAFE.EDU', 'Santa Fe Institute', 'New Mexico, USA'],
    ['contact@fi.edu', 'Franklin Institute', 'Pennsylvania, USA'],
    ['contact@whoi.edu', 'Woods Hole Oceanographic Institution', 'Massachusetts, USA'],
    ['contact@ias.edu', 'Institute for Advanced Study', 'New Jersey, USA'],
    ['contact@princeton.edu', 'Princeton University', 'New Jersey, USA'],
    ['contact@mbl.edu', 'Marine Biological Laboratory', 'Massachusetts, USA'],
    ['contact@uchicago.edu', 'University of Chicago', 'Illinois, USA'],
    ['contact@carnegiescience.edu', 'Carnegie Institution for Science', 'District of Columbia, USA'],
    ['contact@cmu.edu', 'Carnegie Mellon University', 'Pennsylvania, USA'],
    ['contact@salk.edu', 'Salk Institute for Biological Studies', 'California, USA'],
    ['contact@scripps.edu', 'Scripps Research', 'California, USA'],
    ['contact@scrippscollege.edu', 'Scripps College', 'California, USA'],
    ['contact@scripps.ucsd.edu', 'University of California, San Diego', 'California, USA'],
    ['contact@cshl.edu', 'Cold Spring Harbor Laboratory', 'New York, USA'],
    ['contact@ucar.edu', 'University Corporation for Atmospheric Research', 'Colorado, USA'],
    ['contact@jhuapl.edu', 'Johns Hopkins University Applied Physics Laboratory', 'Maryland, USA'],
    ['contact@jhu.edu', 'Johns Hopkins University', 'Maryland, USA'],
    ['contact@nmns.edu.tw', '国立自然科学博物馆', 'Chinese Taipei'],
    ['contact@ncl.edu.tw', '国家图书馆', 'Chinese Taipei'],
    ['contact@ntl.edu.tw', '国立台湾图书馆', 'Chinese Taipei'],
    ['contact@nlpi.edu.tw', '国立公共资讯图书馆', 'Chinese Taipei'],
    ['student@umflint.edu', 'University of Michigan–Flint', 'Michigan, USA'],
    ['student@flint.umich.edu', 'University of Michigan–Flint', 'Michigan, USA'],
    ['student@cuhk.edu.cn', '香港中文大学（深圳）', 'China'],
    ['student@department.hkust-gz.edu.cn', '香港科技大学（广州）', 'China'],
    ['student@shanghai.nyu.edu', '上海纽约大学', 'China'],
    ['student@shnyu.edu.cn', '上海纽约大学', 'China'],
    ['student@nyuad.nyu.edu', 'New York University Abu Dhabi', 'United Arab Emirates'],
    ['student@qatar.northwestern.edu', 'Northwestern University in Qatar', 'Qatar'],
    ['student@qatar.cmu.edu', 'Carnegie Mellon University in Qatar', 'Qatar'],
    ['student@nottingham.edu.my', 'University of Nottingham Malaysia', 'Malaysia'],
    ['student@wustl.edu', 'Washington University in St. Louis', 'Missouri, USA'],
    ['student@email.wustl.edu', 'Washington University in St. Louis', 'Missouri, USA']
  ]) {
    assert.equal(lookup(address).name, name, address);
    assert.equal(lookup(address).region, region, address);
  }
  for (const [alias, primary] of [
    ['uncc.edu', 'charlotte.edu'],
    ['department.uncc.edu', 'charlotte.edu'],
    ['ucb.edu', 'berkeley.edu'],
    ['UCBERKELEY.EDU', 'berkeley.edu'],
    ['department.ucb.edu', 'berkeley.edu'],
    ['department.UCBERKELEY.EDU', 'berkeley.edu'],
    ['UCLOSANGELES.EDU', 'ucla.edu'],
    ['department.UCLOSANGELES.EDU', 'ucla.edu'],
    ['UCSANFRANCISCO.EDU', 'ucsf.edu'],
    ['department.ucsanfrancisco.edu', 'ucsf.edu'],
    ['USEOUL.EDU', 'snu.ac.kr'],
    ['department.useoul.edu', 'snu.ac.kr'],
    ['department.santafe.edu', 'santafe.edu'],
    ['research.WHOI.EDU', 'whoi.edu'],
    ['library.ias.edu', 'ias.edu'],
    ['education.MBL.EDU', 'mbl.edu'],
    ['tickets.fi.edu', 'fi.edu'],
    ['TSINGHUA.EDU', 'tsinghua.edu.cn'],
    ['department.tsinghua.edu', 'tsinghua.edu.cn'],
    ['ucsandiego.edu', 'ucsd.edu'],
    ['department.ucsandiego.edu', 'ucsd.edu'],
    ['ucsantabarbara.edu', 'ucsb.edu'],
    ['department.ucsantabarbara.edu', 'ucsb.edu'],
    ['ucd.edu', 'ucdavis.edu'],
    ['department.ucd.edu', 'ucdavis.edu'],
    ['ucirvine.edu', 'uci.edu'],
    ['department.ucirvine.edu', 'uci.edu'],
    ['ucriverside.edu', 'ucr.edu'],
    ['department.ucriverside.edu', 'ucr.edu'],
    ['ucm.edu', 'ucmerced.edu'],
    ['department.ucm.edu', 'ucmerced.edu'],
    ['hku.edu', 'hku.hk'],
    ['wustl.edu', 'washu.edu'],
    ['swinburne.edu.au', 'swin.edu.au'],
    ['shnyu.edu.cn', 'shanghai.nyu.edu'],
    ['dku.edu.cn', 'dukekunshan.edu.cn'],
    ['oxford.edu', 'ox.ac.uk'],
    ['uir.cn', 'uir.edu.cn']
  ]) {
    assert.deepEqual(JSON.parse(JSON.stringify(lookup(`contact@${alias}`))), JSON.parse(JSON.stringify(lookup(`contact@${primary}`))), alias);
  }
  assert.equal(lookup('student@uic.edu.cn').name, '北京师范大学–香港浸会大学联合国际学院');
  assert.equal(lookup('student@uic.edu.cn').englishName, 'Beijing Normal University–Hong Kong Baptist University United International College');
  assert.equal(lookup('student@bnbu.edu.cn').name, '北师香港浸会大学');
  assert.equal(lookup('student@shnyu.edu.cn').englishName, 'New York University Shanghai');
  assert.equal(lookup('person@uscupstate.edu').name, 'University of South Carolina Upstate');
  assert.equal(lookup('person@upstate.edu').name, 'State University of New York Upstate Medical University');
  assert.equal(lookup('person@tiuny.org').name, 'Talmudical Institute of Upstate New York');
  assert.equal(lookup('person@universityofcalifornia.edu').name, 'University of California Office of the President');
  assert.equal(lookup('person@southcarolina.edu').name, 'University of South Carolina System');
  assert.equal(lookup('student@cs.nyu.edu').name, 'New York University');
  assert.equal(lookup('student@cmu.edu').region, 'Pennsylvania, USA');
  assert.equal(lookup('contact@CCCCO.EDU').name, 'California Community Colleges Chancellor’s Office');
  assert.equal(lookup('contact@office.cccco.edu', 'zh-CN').region, 'California, USA');
  assert.equal(lookup('contact@cuny.edu').name, 'City University of New York');
  assert.equal(lookup('contact@ccny.cuny.edu').name, 'City College of New York');
  assert.equal(lookup('contact@suny.edu').region, 'New York, USA');
  assert.equal(lookup('contact@uwsa.edu').name, 'Universities of Wisconsin');
  for (const [domain, name] of [
    ['cu.edu', 'University of Colorado'],
    ['office.cu.edu', 'University of Colorado'],
    ['colorado.edu', 'University of Colorado Boulder'],
    ['ucdenver.edu', 'University of Colorado Denver'],
    ['uccs.edu', 'University of Colorado Colorado Springs'],
    ['cuanschutz.edu', 'University of Colorado Anschutz Medical Campus']
  ]) {
    assert.equal(lookup(`person@${domain}`).name, name, domain);
    assert.equal(lookup(`person@${domain}`).region, 'Colorado, USA', domain);
  }
  assert.equal(lookup('person@hawaii.edu').name, 'University of Hawaiʻi System');
  assert.equal(lookup('person@hilo.hawaii.edu').name, 'University of Hawaiʻi at Hilo');
  assert.equal(lookup('person@maine.edu').name, 'University of Maine System');
  assert.equal(lookup('person@usm.maine.edu').name, 'University of Southern Maine');
  assert.equal(lookup('person@department.usm.maine.edu').name, 'University of Southern Maine');
  assert.equal(lookup('person@med.umich.edu').name, 'University of Michigan');
  assert.equal(lookup('person@weill.cornell.edu').name, 'Cornell University');
  assert.equal(lookup('person@medicine.okstate.edu').name, 'Oklahoma State University');
  assert.equal(lookup('person@college.mayo.edu').name, 'Mayo Clinic College of Medicine and Science');
  assert.equal(lookup('person@uri.edu').name, 'University of Rhode Island');
  assert.equal(lookup('person@arbitrary-department.uri.edu').name, 'University of Rhode Island');
  assert.equal(lookup('person@student.keio.jp').name, 'Keio University');
  assert.equal(lookup('person@sunysb.edu').name, 'State University of New York at Stony Brook');
  assert.equal(lookup('person@upr.edu').name, 'University of Puerto Rico');
  assert.equal(lookup('person@rcm.upr.edu').name, 'University of Puerto Rico Medical Sciences Campus');
  assert.equal(lookup('person@afats.khc.edu.tw').name, '空军航空技术学院');
  assert.equal(lookup('person@cas.cn').name, '中国科学院');
  assert.equal(lookup('person@ucas.ac.cn').name, '中国科学院大学');
  assert.equal(lookup('person@ceibs.edu').name, '中欧国际工商学院');
  for (const [address, en, zh] of [
    ['student@pku.edu.cn', 'China', '中国'],
    ['student@link.cuhk.edu.hk', 'Hong Kong, China', '中国香港'],
    ['student@um.edu.mo', 'Macau, China', '中国澳门'],
    ['student@ntu.edu.tw', 'Chinese Taipei', '中华台北']
  ]) {
    assert.equal(lookup(address).region, en);
    assert.equal(lookup(address, 'zh-CN').region, zh);
  }
  assert.equal(lookup('student@ntu.edu.tw').name, '国立台湾大学');
  assert.match(lookup('student@centennialcollege.hku.hk').name, /明德/);
  for (const address of ['alice@example.com', 'alice@edu', 'alice@edu.cn', 'alice@harvard.edu.example.com',
    'contact@fakeartic.edu', 'contact@artic.edu.evil.test', 'contact@si.edu.evil.test',
    'contact@fakesi.edu', 'contact@nmns.edu.tw.evil.test',
    'contact@fakeias.edu', 'contact@ias.edu.evil.test', 'contact@whoi.edu.evil.test',
    'contact@fakembl.edu', 'contact@mbl.edu.evil.test', 'contact@fi.edu.evil.test',
    'alice@fakeharvard.edu', 'student@umd.umich.edu.evil.test', 'student@umdumich.edu',
    'contact@fakecccco.edu', 'contact@cccco.edu.evil.test',
    'contact@uncc.edu.evil.test', 'contact@fakeuncc.edu',
    'contact@fakecu.edu', 'contact@cu.edu.evil.test', 'person@mayo.edu.evil.test',
    'person@kp.org', 'person@hshs.org',
    'person@ernet.in', 'person@khc.edu.tw', 'person@e21.edu.cn',
    'alice@harvаrd.edu', 'alice@harvard.edu@evil.test', 'alice@harvard.edu:80',
    'alice@harvard.edu/path', 'alice@harvard.edu?test', 'alice@harvard.edu%2eevil.test',
    'alice@fakecuhk.edu.cn', 'alice@hkust-gz.edu.cn.evil.test', 'alice@fakewustl.edu',
    'esfsm-info@fsm.gov.mo', 'other@fsm.gov.mo', '<alice@harvard.edu> trailing', 'a\n@mit.edu', 'not an email', null]) {
    assert.equal(lookup(address), null, String(address));
  }
});

test('Mailto Capture places school and region on separate lines without altering addresses or copied messages', async () => {
  const { context, runtime } = await runtimeFixture();
  context.document.createElement = tagName => new FakeElement(tagName);
  const capture = runtime.parseMailto('mailto:ALICE+sample@uchicago.edu,unknown@example.com?cc=student%40pku.edu.cn&bcc=person%40ntu.edu.tw&subject=Hello&body=Original%20text');
  const before = runtime.messageText(capture);
  const parent = new FakeElement('div');
  runtime.appendEmailField(parent, 'To', capture.to);
  runtime.appendEmailField(parent, 'CC', capture.cc);
  runtime.appendEmailField(parent, 'BCC', capture.bcc);
  const toEntries = parent.children[0].children[1].children;
  assert.deepEqual(toEntries.map(entry => entry.children.map(renderedText)), [
    ['ALICE+sample@uchicago.edu', 'University of Chicago', 'Illinois, USA'],
    ['unknown@example.com']
  ]);
  assert.deepEqual(parent.children[1].children[1].children[0].children.map(renderedText), ['student@pku.edu.cn', '北京大学', 'Peking University', 'China']);
  const bilingual = new FakeElement('div');
  runtime.appendEmailField(bilingual, 'To', ['student@hku.edu', 'student@um.edu.mo', 'student@ntu.edu.tw', 'student@cuhk.edu.cn', 'unknown@example.com']);
  assert.deepEqual(bilingual.children[0].children[1].children.map(entry => entry.children.map(renderedText)), [
    ['student@hku.edu', '香港大学', 'University of Hong Kong', 'Hong Kong, China'],
    ['student@um.edu.mo', '澳门大学', 'University of Macau', 'Macau, China'],
    ['student@ntu.edu.tw', '国立台湾大学', 'National Taiwan University', 'Chinese Taipei'],
    ['student@cuhk.edu.cn', '香港中文大学（深圳）', 'China'],
    ['unknown@example.com']
  ]);
  runtime.locale = 'zh-CN';
  const localized = new FakeElement('div');
  runtime.appendEmailField(localized, '密送', capture.bcc);
  assert.deepEqual(localized.children[0].children[1].children[0].children.map(renderedText), ['person@ntu.edu.tw', '国立台湾大学', '中华台北']);
  assert.equal(runtime.messageText(capture).replace('收件人:', 'To:').replace('抄送:', 'CC:').replace('密送:', 'BCC:').replace('主题:', 'Subject:'), before);
  assert.doesNotMatch(before, /University|Illinois|北京大学|China/);
});

test('Mainland bilingual names follow reviewed university and campus eligibility rather than undergraduate status', async () => {
  const { context } = await runtimeFixture();
  const { lookup } = context[Symbol.for('cosmic-gemini.mailto-capture.univ-domains')];
  for (const domain of ['pku.edu.cn', 'sjtu.edu.cn', 'en.sjtu.edu.cn', 'ucas.ac.cn', 'xjtlu.edu.cn', 'dukekunshan.edu.cn', 'shanghai.nyu.edu']) {
    assert.ok(lookup(`person@${domain}`).englishName, domain);
    assert.equal(lookup(`person@${domain}`, 'zh-CN').englishName, undefined, domain);
  }
  for (const domain of ['szu.edu.cn', 'ujs.edu.cn', 'westlake.edu.cn', 'nottingham.edu.cn', 'cuhk.edu.cn', 'hkust-gz.edu.cn']) {
    assert.ok(lookup(`person@${domain}`).name, domain);
    assert.equal(lookup(`person@${domain}`).englishName, undefined, domain);
  }
  const campus = lookup('person@students.xmu.edu.my');
  assert.equal(campus.name, '厦门大学马来西亚分校');
  assert.equal(campus.englishName, 'Xiamen University Malaysia');
  assert.equal(campus.region, 'Malaysia');
  assert.equal(lookup('person@xmu.edu.my', 'zh-CN').englishName, undefined);
  assert.equal(lookup('person@morris.umn.edu').name, 'University of Minnesota–Morris');
  assert.equal(lookup('person@umn.edu').name, 'University of Minnesota Twin Cities');
  assert.equal(lookup('person@iu.edu').name, 'Indiana University');
  assert.equal(lookup('person@southeast.iu.edu').name, 'Indiana University Southeast');
  assert.equal(lookup('person@inter.edu').name, 'Inter American University of Puerto Rico');
  assert.equal(lookup('person@metro.inter.edu').name, 'Inter American University of Puerto Rico–Metropolitan Campus');
  assert.equal(lookup('person@pucpr.edu').name, 'Pontifical Catholic University of Puerto Rico');
  assert.equal(lookup('person@hsc.edu').name, 'Hampden-Sydney College');
});

test('Regional higher education includes technological, open, religious and service institutions without empty English rows', async () => {
  const { context, runtime } = await runtimeFixture();
  const { lookup } = context[Symbol.for('cosmic-gemini.mailto-capture.univ-domains')];
  for (const [domain, name, region] of [
    ['carleton.ca', 'Carleton University', 'Ontario, Canada'],
    ['auarts.ca', 'Alberta University of the Arts', 'Alberta, Canada'],
    ['umpsa.edu.my', 'Universiti Malaysia Pahang Al-Sultan Abdullah', 'Malaysia'],
    ['polipd.mypolycc.edu.my', 'Politeknik Port Dickson', 'Malaysia'],
    ['sutd.edu.sg', 'Singapore University of Technology and Design', 'Singapore'],
    ['brunel.ac.uk', 'Brunel University London', 'United Kingdom'],
    ['belfastmet.ac.uk', 'Belfast Metropolitan College', 'United Kingdom'],
    ['chibatech.jp', 'Chiba Institute of Technology', 'Japan'],
    ['it-chiba.ac.jp', 'Chiba Institute of Technology', 'Japan'],
    ['chibatech.ac.jp', 'Chiba Institute of Technology', 'Japan'],
    ['hgu.jp', 'Hokkai-Gakuen University', 'Japan'],
    ['fwu.ac.jp', "Fukuoka Women's University", 'Japan'],
    ['ut.ac.kr', 'Korea National University of Transportation', 'South Korea'],
    ['kopo.ac.kr', 'Korea Polytechnics', 'South Korea'],
    ['pgvim.ac.th', 'Princess Galyani Vadhana Institute of Music', 'Thailand'],
    ['gmit.edu.mn', 'German-Mongolian Institute for Resources and Technology', 'Mongolia'],
    ['num.edu.mn', 'National University of Mongolia', 'Mongolia']
  ]) {
    assert.equal(lookup(`person@${domain}`)?.name, name, domain);
    assert.equal(lookup(`person@${domain}`).region, region, domain);
  }
  for (const domain of ['mypolycc.edu.my', 'moe.edu.my', 'notpolipd.mypolycc.edu.my', 'www.gov.mn', 'gov.mn', 'sfc.ac.uk', 'collegesscotland.ac.uk']) {
    assert.equal(lookup(`person@${domain}`), null, domain);
  }
  for (const domain of ['ntust.edu.tw', 'nou.edu.tw', 'tbts.edu.tw', 'ndu.edu.tw', 'afats.khc.edu.tw', 'cpu.edu.tw', 'tpa.edu.tw']) {
    assert.ok(lookup(`person@${domain}`)?.name, domain);
    assert.equal(lookup(`person@${domain}`).region, 'Chinese Taipei', domain);
  }
  assert.equal(lookup('person@hlpolice.gov.cn').name, '黑龙江公安警官职业学院');
  assert.equal(lookup('person@nwsuaf.cn'), null);
  assert.equal(lookup('person@bwbc.blisswisdom.org'), null);
  assert.equal(lookup('person@wp.ces.org.tw'), null);
  assert.equal(lookup('person@khc.edu.tw'), null);
  assert.equal(lookup('person@hkiit.edu.hk').name, '香港资讯科技学院');
  assert.match(lookup('person@scs.cuhk.edu.hk').name, /专业进修学院/);
  assert.equal(lookup('person@cuhk.edu.hk').name, '香港中文大学');
  assert.equal(lookup('person@hku.hk').name, '香港大学');
  context.document.createElement = tagName => new FakeElement(tagName);
  const fields = new FakeElement('div');
  runtime.appendEmailField(fields, 'To', ['person@ndu.edu.tw']);
  assert.deepEqual(fields.children[0].children[1].children[0].children.map(renderedText), ['person@ndu.edu.tw', '国防大学', 'Chinese Taipei']);
});

test('Mailto Capture does not update a replacement dialog or run stale clipboard fallbacks', async () => {
  const { runtime, context } = await runtimeFixture();
  for (const rejected of [false, true]) {
    let finish;
    context.navigator.clipboard = { writeText: () => new Promise((resolve, reject) => {
      finish = rejected ? () => reject(new Error('clipboard unavailable')) : resolve;
    }) };
    runtime.shadow = { querySelector: () => ({ textContent: '' }) };
    const copying = runtime.copy('old dialog contents', 'Copied');
    const status = { textContent: 'new dialog' };
    runtime.shadow = { querySelector: () => status };
    finish(); await copying;
    assert.equal(status.textContent, 'new dialog');
  }
});

test('Mailto Capture preserves recipients, message fields, repeated values, and literal plus signs', async () => {
  const { runtime } = await runtimeFixture();
  const parsed = runtime.parseMailto(
    'mailto:alice+label@example.com,bob@example.com?to=carol%40example.com&cc=copy1%40example.com&cc=copy2%40example.com&bcc=private%40example.com&subject=Quarter%20Review&body=Line%201%0D%0ALine%202&reply-to=team%40example.com'
  );

  assert.deepEqual([...parsed.to], ['alice+label@example.com', 'bob@example.com', 'carol@example.com']);
  assert.deepEqual([...parsed.cc], ['copy1@example.com', 'copy2@example.com']);
  assert.deepEqual([...parsed.bcc], ['private@example.com']);
  assert.equal(parsed.subject, 'Quarter Review');
  assert.equal(parsed.body, 'Line 1\nLine 2');
  assert.deepEqual(JSON.parse(JSON.stringify(parsed.otherFields.map(field => [field.name, [...field.values]]))), [
    ['reply-to', ['team@example.com']]
  ]);
  assert.equal(runtime.messageText(parsed), [
    'To: alice+label@example.com, bob@example.com, carol@example.com',
    'CC: copy1@example.com, copy2@example.com',
    'BCC: private@example.com',
    'Subject: Quarter Review',
    'reply-to: team@example.com',
    '',
    'Line 1',
    'Line 2'
  ].join('\n'));
  assert.equal(parsed.simpleAddressOnly, false);

  const simple = runtime.parseMailto('mailto:hello@example.com');
  assert.equal(simple.simpleAddressOnly, true);
  assert.equal(simple.addressText, 'hello@example.com');
});

test('Mailto Capture preserves telephone targets and rejects empty tel links', async () => {
  const { runtime } = await runtimeFixture();
  const parsed = runtime.parseTel('TEL:%2B1-312-555-0100;ext=204#ignored');
  assert.equal(parsed.kind, 'tel');
  assert.equal(parsed.number, '+1-312-555-0100;ext=204');
  assert.equal(parsed.location, 'Chicago, Illinois, USA');
  assert.equal(runtime.messageText(parsed), '+1-312-555-0100;ext=204');
  assert.equal(runtime.parseLink('tel:+44-20-7946-0958').kind, 'tel');
  assert.equal(runtime.parseTel('tel:'), null);
});

test('Mailto Capture resolves recognized North American locations and omits unidentified results', async () => {
  const { context } = await runtimeFixture();
  const nanp = context[Symbol.for('cosmic-gemini.mailto-capture.nanp')];
  assert.equal(nanp.lookup('+1 416 555 0100'), 'Toronto, Ontario, Canada');
  assert.equal(nanp.lookup('+1 907 200 0100'), 'Valdez, Alaska, USA');
  assert.equal(nanp.lookup('+1 907 211 0100'), 'Alaska, USA');
  assert.equal(nanp.lookup('312-555-0100'), 'Chicago, Illinois, USA');
  assert.equal(nanp.lookup('1-800-555-0100'), 'Toll-Free, North American Numbering Plan');
  assert.equal(nanp.lookup('1-710-555-0100'), 'USA Government');
  assert.equal(nanp.lookup('+1 211 555 0100'), '');
  assert.equal(nanp.lookup('+44 20 7946 0958'), '');
});

test('Mailto Capture recognizes and formats compact international telephone references', async () => {
  const { context, runtime } = await runtimeFixture();
  const phone = context[Symbol.for('cosmic-gemini.mailto-capture.phone')];
  assert.deepEqual(JSON.parse(JSON.stringify(phone.inspect('+44 20 7946 0958'))), {
    display: '+44 20 7946 0958',
    location: 'United Kingdom'
  });
  assert.deepEqual(JSON.parse(JSON.stringify(phone.inspect('+86 10 1234 5678'))), {
    display: '+86 10 1234 5678',
    location: 'Beijing, China'
  });
  assert.deepEqual(JSON.parse(JSON.stringify(phone.inspect('+86 131 2345 6789'))), {
    display: '+86 131 2345 6789',
    location: 'China'
  });
  assert.deepEqual(JSON.parse(JSON.stringify(phone.inspect('+52 55 1234 5678'))), {
    display: '+52 55 1234 5678',
    location: 'Center, Mexico'
  });
  assert.equal(phone.inspect('+44 20 7946 0958', 'zh-CN').location, '英国');
  assert.equal(phone.inspect('+86 571 1234 5678', 'zh-CN').location, '中国 浙江 杭州');
  assert.equal(phone.inspect('+86 28 1234 5678', 'zh-CN').location, '中国 四川 成都/资阳/眉山');
  assert.equal(phone.inspect('+86 29 1234 5678', 'zh-CN').location, '中国 陕西 西安/咸阳');
  assert.equal(phone.inspect('+86 131 2345 6789', 'zh-CN').location, '中国');
  assert.equal(phone.inspect('+52 55 1234 5678', 'zh-CN').location, '墨西哥 中部');
  assert.deepEqual(
    ['2', '3', '4', '5', '6', '7', '8', '9'].map(digit => (
      phone.inspect(`+52 ${digit}12 345 6789`).location
    )),
    ['East, Mexico', 'West, Mexico', 'North, Mexico', 'Center, Mexico',
      'Northwest, Mexico', 'Southwest, Mexico', 'Northeast, Mexico', 'Southeast, Mexico']
  );
  assert.equal(runtime.parseTel('tel:+44-20-7946-0958').location, 'United Kingdom');
  assert.equal(runtime.parseSms('sms:+86-10-1234-5678').locations[0].location, 'Beijing, China');
  runtime.onConfigure({
    detail: JSON.stringify({ token: runtime.token, config: { active: true, locale: 'zh-CN' } })
  });
  assert.equal(runtime.parseTel('tel:+44-20-7946-0958').location, '英国');
  assert.equal(runtime.parseSms('sms:+86-571-1234-5678').locations[0].location, '中国 浙江 杭州');
  assert.equal(runtime.parseTel('tel:+1-312-555-0100').location, 'Chicago, Illinois, USA');
});

test('Telephone region names stay consistent across locales and browser name data', async () => {
  const { context, runtime } = await runtimeFixture({ intl: {
    DisplayNames: class { constructor() { throw new Error('Browser region names are unavailable.'); } }
  } });
  const phone = context[Symbol.for('cosmic-gemini.mailto-capture.phone')];
  const univDomains = context[Symbol.for('cosmic-gemini.mailto-capture.univ-domains')];
  for (const [number, domain, english, chinese] of [
    ['+852 2345 6789', 'hku.hk', 'Hong Kong, China', '中国香港'],
    ['+853 2831 2345', 'um.edu.mo', 'Macau, China', '中国澳门'],
    ['+886 2 2345 6789', 'ntu.edu.tw', 'Chinese Taipei', '中华台北']
  ]) {
    assert.equal(phone.inspect(number, 'en-US').location, english);
    assert.equal(phone.inspect(number, 'zh-CN').location, chinese);
    assert.equal(phone.inspect(number, 'en-US').location, univDomains.lookup(`person@${domain}`).region);
    assert.equal(phone.inspect(number, 'zh-CN').location, univDomains.lookup(`person@${domain}`, 'zh-CN').region);
  }
  assert.equal(runtime.parseTel('tel:+85223456789').location, 'Hong Kong, China');
  runtime.onConfigure({ detail: JSON.stringify({ token: runtime.token, config: { active: true, locale: 'zh-CN' } }) });
  assert.equal(runtime.parseSms('sms:+85328312345').locations[0].location, '中国澳门');
});

test('Mailto Capture standardizes NANP display without changing copied dialing targets', async () => {
  const { runtime } = await runtimeFixture();
  assert.equal(runtime.displayTelephoneNumber('13125550100'), '+1 (312) 555-0100');
  assert.equal(runtime.displayTelephoneNumber('+1 312 555 0100'), '+1 (312) 555-0100');
  assert.equal(runtime.displayTelephoneNumber('3125550100'), '(312) 555-0100');
  assert.equal(runtime.displayTelephoneNumber('+13125550100;ext=204'), '+1 (312) 555-0100 ext. 204');
  assert.equal(runtime.displayTelephoneNumber('2115550100'), '2115550100');
  assert.equal(runtime.displayTelephoneNumber('+44-20-7946-0958'), '+44 20 7946 0958');
  assert.equal(runtime.displayTelephoneNumber('+86-10-1234-5678'), '+86 10 1234 5678');
  assert.equal(runtime.messageText(runtime.parseTel('tel:+13125550100;ext=204')), '+13125550100;ext=204');
});

test('Mailto Capture places recognized locations beneath their telephone numbers and keeps state with USA', async () => {
  const { context, runtime } = await runtimeFixture();
  context.document.createElement = tagName => new FakeElement(tagName);
  const parent = new FakeElement('div');
  runtime.appendTelephoneField(parent, 'Phone number', [
    { number: '+1-312-555-0100', location: 'Chicago-Naperville-Elgin metropolitan area, Illinois, USA' },
    { number: '+1-907-211-0100', location: 'Alaska, USA' },
    { number: '+1-800-555-0100', location: 'Toll-Free, North American Numbering Plan' },
    { number: '+1-416-555-0100', location: 'Toronto, Ontario, Canada' },
    { number: '+86-571-1234-5678', location: 'Hangzhou, Zhejiang, China' },
    { number: '+86-571-1234-5678', location: '中国 浙江 杭州' },
    { number: '+44-20-7946-0958', location: '' }
  ]);

  assert.equal(parent.children.length, 1);
  const [field] = parent.children;
  assert.equal(field.children[0].textContent, 'Phone number');
  assert.equal(field.children[1].className, 'value phone-value');
  assert.deepEqual(field.children[1].children.map(entry => entry.children.map(renderedText)), [
    ['+1 (312) 555-0100', 'Chicago-Naperville-Elgin metropolitan area, Illinois, USA'],
    ['+1 (907) 211-0100', 'Alaska, USA'],
    ['+1 (800) 555-0100', 'Toll-Free, North American Numbering Plan'],
    ['+1 (416) 555-0100', 'Toronto, Ontario, Canada'],
    ['+86 571 1234 5678', 'Hangzhou, Zhejiang, China'],
    ['+86 571 1234 5678', '中国 浙江 杭州'],
    ['+44 20 7946 0958']
  ]);
  const longUsLocation = field.children[1].children[0].children[1];
  assert.equal(longUsLocation.textContent, 'Chicago-Naperville-Elgin metropolitan area, ');
  assert.equal(longUsLocation.children[0].className, 'phone-location-nowrap');
  assert.equal(longUsLocation.children[0].textContent, 'Illinois, USA');
  const stateOnlyLocation = field.children[1].children[1].children[1];
  assert.equal(stateOnlyLocation.textContent, '');
  assert.equal(stateOnlyLocation.children[0].textContent, 'Alaska, USA');
  const numberingPlanLocation = field.children[1].children[2].children[1];
  assert.equal(numberingPlanLocation.textContent, 'Toll-Free, ');
  assert.equal(numberingPlanLocation.children[0].textContent, 'North American Numbering Plan');
  assert.equal(field.children[1].children[3].children[1].children.length, 0);
  const englishChinaLocation = field.children[1].children[4].children[1];
  assert.equal(englishChinaLocation.textContent, 'Hangzhou, ');
  assert.equal(englishChinaLocation.children[0].textContent, 'Zhejiang, China');
  const chineseChinaLocation = field.children[1].children[5].children[1];
  assert.equal(chineseChinaLocation.children[0].textContent, '中国 浙江');
  assert.equal(chineseChinaLocation.children[1], ' 杭州');
});

test('Mailto Capture preserves text-message recipients, body, and extension fields', async () => {
  const { runtime } = await runtimeFixture();
  const parsed = runtime.parseSms('SMS:%2B1-312-555-0100,+44-20-7946-0958?body=Meet%20at%206%3F&service=center');
  assert.equal(parsed.kind, 'sms');
  assert.deepEqual([...parsed.recipients], ['+1-312-555-0100', '+44-20-7946-0958']);
  assert.equal(parsed.body, 'Meet at 6?');
  assert.deepEqual(JSON.parse(JSON.stringify(parsed.locations)), [
    { number: '+1-312-555-0100', location: 'Chicago, Illinois, USA' },
    { number: '+44-20-7946-0958', location: 'United Kingdom' }
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(parsed.otherFields)), [{ name: 'service', values: ['center'] }]);
  assert.equal(runtime.messageText(parsed), [
    'To: +1-312-555-0100, +44-20-7946-0958',
    'service: center',
    '',
    'Meet at 6?'
  ].join('\n'));
  assert.equal(parsed.simpleNumberOnly, false);
  assert.equal(runtime.parseSms('sms:+1-312-555-0100').simpleNumberOnly, true);
  assert.equal(runtime.parseLink('sms:?body=Hello').kind, 'sms');
  assert.equal(runtime.parseSms('sms:'), null);
});

test('Mailto Capture intercepts trusted mailto, tel, and sms activation and releases every listener when disabled', async () => {
  const { context, runtime } = await runtimeFixture();
  runtime.onConfigure({
    detail: JSON.stringify({ token: runtime.token, config: { active: true, locale: 'zh-CN' } })
  });
  const anchor = new FakeAnchor('MAILTO:person@example.com?subject=Hello');
  let shown = null;
  runtime.show = (target, href) => { shown = { target, href }; };
  const stopped = [];
  runtime.onActivate({
    type: 'click',
    button: 0,
    isTrusted: true,
    composedPath: () => [anchor],
    preventDefault: () => stopped.push('default'),
    stopPropagation: () => stopped.push('propagation'),
    stopImmediatePropagation: () => stopped.push('immediate')
  });
  assert.deepEqual(shown, { target: anchor, href: anchor.href });
  assert.deepEqual(stopped, ['default', 'propagation', 'immediate']);
  const phone = new FakeAnchor('tel:+1-312-555-0100');
  runtime.onActivate({
    type: 'click',
    button: 0,
    isTrusted: true,
    composedPath: () => [phone],
    preventDefault: () => stopped.push('tel-default'),
    stopPropagation: () => stopped.push('tel-propagation'),
    stopImmediatePropagation: () => stopped.push('tel-immediate')
  });
  assert.deepEqual(shown, { target: phone, href: phone.href });
  assert.deepEqual(stopped.slice(-3), ['tel-default', 'tel-propagation', 'tel-immediate']);
  const textMessage = new FakeAnchor('sms:+1-312-555-0100?body=Hello');
  runtime.onActivate({
    type: 'click',
    button: 0,
    isTrusted: true,
    composedPath: () => [textMessage],
    preventDefault: () => stopped.push('sms-default'),
    stopPropagation: () => stopped.push('sms-propagation'),
    stopImmediatePropagation: () => stopped.push('sms-immediate')
  });
  assert.deepEqual(shown, { target: textMessage, href: textMessage.href });
  assert.deepEqual(stopped.slice(-3), ['sms-default', 'sms-propagation', 'sms-immediate']);
  assert.equal(runtime.locale, 'zh-CN');
  assert.equal(context.window.listeners.get('click').includes(runtime.onActivate), true);

  runtime.onConfigure({ detail: JSON.stringify({ token: runtime.token, config: { active: false } }) });
  assert.equal(context.window.listeners.get('click').includes(runtime.onActivate), false);
  runtime.onDispose({ detail: runtime.token });
  assert.equal(context[Symbol.for('cosmic-gemini.mailto-capture.runtime')], undefined);
  assert.equal(context[Symbol.for('cosmic-gemini.mailto-capture.nanp')], undefined);
  assert.equal(context[Symbol.for('cosmic-gemini.mailto-capture.phone')], undefined);
});

test('Mailto Capture closes only for outside activation or Escape', async () => {
  const { runtime } = await runtimeFixture();
  const host = {};
  runtime.host = host;
  const closes = [];
  runtime.close = restoreFocus => closes.push(restoreFocus === true);

  runtime.onPointerDown({ composedPath: () => [host] });
  assert.deepEqual(closes, []);
  runtime.onPointerDown({ composedPath: () => [{}] });
  assert.deepEqual(closes, [false]);

  let prevented = false;
  let stopped = false;
  runtime.onKeyDown({
    key: 'Escape',
    preventDefault: () => { prevented = true; },
    stopPropagation: () => { stopped = true; }
  });
  assert.deepEqual(closes, [false, true]);
  assert.equal(prevented, true);
  assert.equal(stopped, true);
});

test('Mailto Capture reverses its entrance motion before removing the popover', async () => {
  const { runtime } = await runtimeFixture();
  let resolveAnimation;
  let removed = false;
  let focused = false;
  let animationOptions;
  let animationFrames;
  const animation = {
    finished: new Promise(resolve => { resolveAnimation = resolve; }),
    cancel() {}
  };
  const popover = {
    animate(frames, options) { animationFrames = frames; animationOptions = options; return animation; }
  };
  runtime.host = {
    style: { setProperty() {} },
    remove() { removed = true; }
  };
  runtime.shadow = { querySelector: () => popover };
  runtime.anchor = { isConnected: true, focus() { focused = true; } };
  runtime.capture = {};

  runtime.close(true);
  assert.equal(runtime.host, null, 'the closing popover stops receiving runtime actions immediately');
  assert.equal(removed, false, 'the host remains only for the exit animation');
  assert.deepEqual(JSON.parse(JSON.stringify(animationFrames)), [
    { opacity: 1, transform: 'translateY(0)' },
    { opacity: 0, transform: 'translateY(-3px)' }
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(animationOptions)), {
    duration: 100, easing: 'ease-in', fill: 'forwards'
  });
  resolveAnimation();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(removed, true);
  assert.equal(focused, true);
});

test('Mailto Capture clears a closing popover before opening another without restoring stale focus', async () => {
  const { runtime } = await runtimeFixture();
  let rejectAnimation;
  let removed = 0;
  let focused = 0;
  const animation = {
    finished: new Promise((_resolve, reject) => { rejectAnimation = reject; }),
    cancel() { rejectAnimation(new Error('cancelled')); }
  };
  runtime.host = { style: { setProperty() {} }, remove() { removed += 1; } };
  runtime.shadow = { querySelector: () => ({ animate: () => animation }) };
  runtime.anchor = { isConnected: true, focus() { focused += 1; } };
  runtime.capture = {};
  runtime.close(true);
  runtime.finishClosing();
  await Promise.resolve();
  await Promise.resolve();
  assert.ok(removed >= 1);
  assert.equal(focused, 0);
});
