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

async function runtimeFixture() {
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
    Intl,
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
  for (const name of ['mailto-capture-university-data.js', 'mailto-capture-universities.js']) {
    vm.runInContext(await readFile(new URL(`../extension/content/mailto-capture/${name}`, import.meta.url), 'utf8'), context);
  }
  vm.runInContext(await readFile(new URL('../extension/shared/external-links-capture/protocols.js', import.meta.url), 'utf8'), context);
  const source = await readFile(new URL('../extension/content/mailto-capture/mailto-capture-runtime.js', import.meta.url), 'utf8');
  vm.runInContext(source, context);
  return { context, runtime: context[Symbol.for('cosmic-gemini.mailto-capture.runtime')] };
}

test('University references cover every reviewed cohort and resolve all explicit domains offline', async () => {
  const { context } = await runtimeFixture();
  const registry = JSON.parse(await readFile(new URL('../docs/reference-data/mailto-universities/registry.json', import.meta.url), 'utf8'));
  const { lookup } = context[Symbol.for('cosmic-gemini.mailto-capture.universities')];
  const coverage = new Map(Object.keys(registry.sources).map(key => [key, new Set()]));
  for (const institution of registry.institutions) {
    const expected = ['CN', 'HK', 'MO', 'TW'].includes(institution.region) ? institution.zh : institution.en;
    for (const [group, names] of Object.entries(institution.coverage)) {
      for (const name of names) coverage.get(group).add(name);
    }
    for (const domain of institution.domains) {
      assert.equal(lookup(`fixture@${domain}`).name, expected, domain);
      assert.equal(lookup(`fixture@${domain}`, 'zh-CN').name, expected, domain);
    }
    for (const address of institution.addresses) assert.equal(lookup(address).name, expected);
    if (['US', 'CA'].includes(institution.region)) {
      const address = `fixture@${institution.domains[0]}`;
      assert.ok(lookup(address).region.startsWith(`${institution.subdivision}, `), institution.id);
    }
    if (['CN', 'HK', 'MO', 'TW'].includes(institution.region)) {
      assert.doesNotMatch(expected, /[國學臺灣醫藥華東長榮門體藝術師範聯實踐銘傳濟義寧]/, institution.id);
    } else {
      assert.doesNotMatch(expected, /[()（）\u3400-\u9fff]/, institution.id);
      assert.ok([...expected].every(character => !/\p{Letter}/u.test(character) || /\p{Script=Latin}/u.test(character)), institution.id);
    }
  }
  for (const [group, members] of coverage) assert.equal(members.size, registry.sources[group].expectedMembers, group);
});

test('University matching respects DNS boundaries, campus identity and localized region names', async () => {
  const { context } = await runtimeFixture();
  const { lookup } = context[Symbol.for('cosmic-gemini.mailto-capture.universities')];
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
  assert.equal(lookup('contact@CCCCO.EDU').name, 'California Community Colleges Chancellor’s Office');
  assert.equal(lookup('contact@office.cccco.edu', 'zh-CN').region, 'California, USA');
  assert.equal(lookup('contact@cuny.edu').name, 'The City University of New York');
  assert.equal(lookup('contact@ccny.cuny.edu').name, 'The City College of New York');
  assert.equal(lookup('contact@suny.edu').region, 'New York, USA');
  assert.equal(lookup('contact@uwsa.edu').name, 'Universities of Wisconsin');
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
  assert.equal(lookup('esfsm-info@fsm.gov.mo').name, '澳门保安部队高等院校');
  for (const address of ['alice@example.com', 'alice@edu', 'alice@edu.cn', 'alice@harvard.edu.example.com',
    'alice@fakeharvard.edu', 'student@umd.umich.edu.evil.test', 'student@umdumich.edu',
    'contact@fakecccco.edu', 'contact@cccco.edu.evil.test',
    'alice@harvаrd.edu', 'alice@harvard.edu@evil.test', 'alice@harvard.edu:80',
    'alice@harvard.edu/path', 'alice@harvard.edu?test', 'alice@harvard.edu%2eevil.test',
    'alice@cuhk.edu.cn', 'other@fsm.gov.mo', '<alice@harvard.edu> trailing', 'a\n@mit.edu', 'not an email', null]) {
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
  assert.deepEqual(parent.children[1].children[1].children[0].children.map(renderedText), ['student@pku.edu.cn', '北京大学', 'China']);
  runtime.locale = 'zh-CN';
  const localized = new FakeElement('div');
  runtime.appendEmailField(localized, '密送', capture.bcc);
  assert.deepEqual(localized.children[0].children[1].children[0].children.map(renderedText), ['person@ntu.edu.tw', '国立台湾大学', '中华台北']);
  assert.equal(runtime.messageText(capture).replace('收件人:', 'To:').replace('抄送:', 'CC:').replace('密送:', 'BCC:').replace('主题:', 'Subject:'), before);
  assert.doesNotMatch(before, /University|Illinois|北京大学|China/);
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
