// Shared Mailto Capture protocol parsing. Classic-script compatible for page
// runtimes; also imported by the isolated External Links Capture UI. No DOM,
// extension APIs, phone databases or per-product settings are accessed here.
(() => {
  function decodeMailtoPart(value) {
    try { return decodeURIComponent(String(value || '')); }
    catch { return String(value || ''); }
  }

  function normalizeLineBreaks(value) {
    return String(value || '').replace(/\r\n?/g, '\n');
  }

  function addressValues(values) {
    return values.flatMap(value => String(value || '').split(','))
      .map(value => value.trim())
      .filter(Boolean);
  }

class LinkParser {
    parseMailto(href) {
      const raw = String(href || '').trim();
      if (!/^mailto:/i.test(raw)) return null;
      const content = raw.slice(raw.indexOf(':') + 1).split('#', 1)[0];
      const queryAt = content.indexOf('?');
      const recipientPart = queryAt < 0 ? content : content.slice(0, queryAt);
      const query = queryAt < 0 ? '' : content.slice(queryAt + 1);
      const fields = new Map();
      for (const pair of query.split('&')) {
        if (!pair) continue;
        const equalsAt = pair.indexOf('=');
        const rawName = equalsAt < 0 ? pair : pair.slice(0, equalsAt);
        const rawValue = equalsAt < 0 ? '' : pair.slice(equalsAt + 1);
        const name = decodeMailtoPart(rawName).trim();
        if (!name) continue;
        const key = name.toLowerCase();
        const entry = fields.get(key) || { name, values: [] };
        entry.values.push(normalizeLineBreaks(decodeMailtoPart(rawValue)));
        fields.set(key, entry);
      }
      const recipientValues = addressValues([
        decodeMailtoPart(recipientPart),
        ...(fields.get('to')?.values || [])
      ]);
      fields.delete('to');
      const take = name => {
        const values = (fields.get(name)?.values || []).map(value => value.trim()).filter(Boolean);
        fields.delete(name);
        return values;
      };
      const takeAddresses = name => addressValues(take(name));
      const cc = takeAddresses('cc');
      const bcc = takeAddresses('bcc');
      const subject = take('subject').join('\n');
      const body = take('body').join('\n\n');
      const otherFields = [...fields.values()]
        .map(field => ({ name: field.name, values: field.values.filter(value => value !== '') }))
        .filter(field => field.values.length);
      return {
        kind: 'mailto',
        href: raw,
        to: recipientValues,
        cc,
        bcc,
        subject,
        body,
        otherFields,
        addressText: recipientValues.join(', '),
        simpleAddressOnly: recipientValues.length === 1
          && !subject
          && !body
          && !cc.length
          && !bcc.length
          && !otherFields.length
      };
    }

    parseTel(href) {
      const raw = String(href || '').trim();
      if (!/^tel:/i.test(raw)) return null;
      const content = raw.slice(raw.indexOf(':') + 1).split('#', 1)[0];
      const number = decodeMailtoPart(content).trim();
      return number ? { kind: 'tel', href: raw, number } : null;
    }

    parseSms(href) {
      const raw = String(href || '').trim();
      if (!/^sms:/i.test(raw)) return null;
      const content = raw.slice(raw.indexOf(':') + 1).split('#', 1)[0];
      const queryAt = content.indexOf('?');
      const recipientPart = queryAt < 0 ? content : content.slice(0, queryAt);
      const query = queryAt < 0 ? '' : content.slice(queryAt + 1);
      const recipients = addressValues([decodeMailtoPart(recipientPart)]);
      const fields = new Map();
      for (const pair of query.split('&')) {
        if (!pair) continue;
        const equalsAt = pair.indexOf('=');
        const rawName = equalsAt < 0 ? pair : pair.slice(0, equalsAt);
        const rawValue = equalsAt < 0 ? '' : pair.slice(equalsAt + 1);
        const name = decodeMailtoPart(rawName).trim();
        if (!name) continue;
        const key = name.toLowerCase();
        const entry = fields.get(key) || { name, values: [] };
        entry.values.push(normalizeLineBreaks(decodeMailtoPart(rawValue)));
        fields.set(key, entry);
      }
      const body = (fields.get('body')?.values || []).join('\n\n');
      fields.delete('body');
      const otherFields = [...fields.values()]
        .map(field => ({ name: field.name, values: field.values.filter(value => value !== '') }))
        .filter(field => field.values.length);
      if (!recipients.length && !body && !otherFields.length) return null;
      return {
        kind: 'sms',
        href: raw,
        recipients,
        body,
        otherFields,
        numberText: recipients.join(', '),
        simpleNumberOnly: recipients.length > 0 && !body && !otherFields.length
      };
    }

    parseLink(href) {
      return this.parseMailto(href) || this.parseTel(href) || this.parseSms(href);
    }

}
const parser = new LinkParser();
  globalThis[Symbol.for('cosmic.external-links-capture.protocols')] = Object.freeze({
    parseMailto: value => parser.parseMailto(value),
    parseTel: value => parser.parseTel(value),
    parseSms: value => parser.parseSms(value)
  });
})();
