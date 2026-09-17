import { FEATURE_IDS, hostnameFromUrl } from '../core/config.js';

const NO_ANY_COPY_DIRECTIVE = Object.freeze({ persistent: false, source: '' });
const NO_CLIPBOARD_PROTECT_DIRECTIVE = Object.freeze({ yieldToAnyCopy: false });

export function centralPageDirectives(settings, url, resolved = {}) {
  const hostname = hostnameFromUrl(url);
  const adMarshalKeepsAnyCopyActive = settings?.adMarshal?.managedSites?.zhihu === true
    && (hostname === 'zhihu.com' || hostname.endsWith('.zhihu.com'));
  return Object.freeze({
    [FEATURE_IDS.ANY_COPY]: adMarshalKeepsAnyCopyActive
      ? Object.freeze({ persistent: true, source: 'adMarshalZhihu' })
      : NO_ANY_COPY_DIRECTIVE,
    [FEATURE_IDS.CLIPBOARD_PROTECT]: resolved.anyCopyActive === true
      ? Object.freeze({ yieldToAnyCopy: true })
      : NO_CLIPBOARD_PROTECT_DIRECTIVE
  });
}

export async function syncCentralPageProducts(productIds, directives, synchronize) {
  const yielding = directives?.[FEATURE_IDS.CLIPBOARD_PROTECT]?.yieldToAnyCopy === true;
  const first = yielding ? FEATURE_IDS.CLIPBOARD_PROTECT : FEATURE_IDS.ANY_COPY;
  const second = yielding ? FEATURE_IDS.ANY_COPY : FEATURE_IDS.CLIPBOARD_PROTECT;
  const unrelated = productIds.filter(id => id !== first && id !== second);
  const unrelatedWork = Promise.allSettled(unrelated.map(async id => [id, await synchronize(id)]));
  const entries = [];
  try {
    entries.push([first, await synchronize(first)]);
    entries.push([second, await synchronize(second)]);
  } catch (error) {
    await unrelatedWork;
    throw error;
  }
  const results = await unrelatedWork;
  const failed = results.find(result => result.status === 'rejected');
  if (failed) throw failed.reason;
  entries.push(...results.map(result => result.value));
  const values = new Map(entries);
  return Object.fromEntries(productIds.map(id => [id, values.get(id) === true]));
}
