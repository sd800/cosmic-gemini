import { FEATURE_IDS, hostnameFromUrl } from '../core/config.js';

const NO_ANY_COPY_DIRECTIVE = Object.freeze({ persistent: false, source: '' });

export function centralPageDirectives(settings, url) {
  const hostname = hostnameFromUrl(url);
  const adMarshalKeepsAnyCopyActive = settings?.adMarshal?.managedSites?.zhihu === true
    && (hostname === 'zhihu.com' || hostname.endsWith('.zhihu.com'));
  return Object.freeze({
    [FEATURE_IDS.ANY_COPY]: adMarshalKeepsAnyCopyActive
      ? Object.freeze({ persistent: true, source: 'adMarshalZhihu' })
      : NO_ANY_COPY_DIRECTIVE
  });
}
