# University email-domain reference

`registry.json` is the reviewed build input for Mailto Capture. It contains public institution facts, domain aliases, principal-campus locations and cohort membership. It never contains captured user email addresses. The one published institutional mailbox is an exact-match exception for a college sharing a government domain; other addresses under that domain are not attributed to the college.

## Coverage snapshot

Reviewed on **2026-10-19**. Ranking thresholds include all institutions tied at the boundary, rather than truncating the first 300/50 rows.

| Cohort | Edition/source | Selected institutions |
| --- | --- | ---: |
| U.S. News National Universities, rank ≤ 300 | 2027 | 306 |
| U.S. News National Liberal Arts Colleges, rank ≤ 50 | 2027 | 53 |
| QS World University Rankings, rank ≤ 300 | 2027 | 301 |
| U.S. News Best Global Universities, rank ≤ 300 | 2026–2027 | 303 |
| Mainland Double First-Class institutions, including historical 985/211 institutions | Ministry of Education second-round list | 147 |
| Hong Kong degree-awarding institutions | Education Bureau | 22 |
| Hong Kong supplementary postsecondary providers | CSPE provider-level directory | 29 |
| Macau higher education institutions | DSEDJ | 10 |
| Taiwan general universities (`體制=一般大學`) | Official 114 academic-year directory | 66 |

Cohorts overlap. The compiled reference contains **881 institution/domain groups**, **1,018 explicit domain suffixes** and **one exact shared-domain mailbox**. A group can represent two institutional identities sharing one domain, such as the two HKCT providers; its display name includes both. Ranking membership is retained only for maintenance, never displayed as a credential or ranking in the popover.

## Sources and identity decisions

Each cohort in `registry.json` records its edition, source URLs, expected membership count and SHA-256 hashes of the downloaded source snapshots. QS and the regional education directories provide public first-party lists. Because U.S. News did not provide readable complete publisher tables during preparation, the U.S. News cohorts use the explicitly cited public Menggy, College Kickstart and XuanXiao transcriptions. Do not describe these transcriptions as direct publisher exports.

Domain alignment uses [Hipo's MIT-licensed directory](https://github.com/Hipo/university-domains-list), official institution links in the education directories, and reviewed institution aliases. The bundled license is at `extension/content/mailto-capture/university-domains-LICENSE.txt`. Candidate fuzzy matches were not accepted automatically. The runtime performs no fuzzy matching, rank lookup or remote update.

U.S. states use the NCES IPEDS HD2024 directory with explicit principal-campus corrections for shared/system domains; the HD2025 ZIP was not publicly retrievable during preparation. Canadian provinces follow the Universities Canada directory and institution main-campus locations. The location describes the institution's legal principal campus, not the email user's location or a department's IP address. Shared university systems can have a broad principal-campus record and more specific independently listed campus hosts; use the longest explicit host match. Do not infer a campus from an unrelated department label.

Some institutional domains have historical or student-only alternatives. Keep confirmed aliases attached to the same institution, but do not infer aliases from similar spelling. In particular, `cuhk.edu.cn` belongs to the separate Shenzhen institution and must not receive the Hong Kong institution's label. Generic suffixes and shared email providers are not school identifiers. The shared Macau government domain is matched only for its published college mailbox. A directory's prefixed Taiwan institutional web host (`w3`, `www1`, etc.) also retains the corresponding institution's `.edu.tw` root.

## Display policy

- Mainland/Hong Kong/Macau/Taiwan institutions use Simplified Chinese school names in both interface languages. Other institutions use Latin-character names, without parenthesized common acronyms. Legal foundation wrappers are omitted from Taiwan display names; original names remain in membership evidence.
- School and country/region occupy separate lines beneath each original To/CC/BCC address. Unknown addresses have no empty metadata rows or error message. School metadata never enters copied addresses/messages.
- U.S. and Canadian institutions include the full principal-campus state/province. U.S. country text is always `USA`.
- English regional labels: `China`, `Hong Kong, China`, `Macau, China`, `Chinese Taipei`. Simplified Chinese labels: `中国`, `中国香港`, `中国澳门`, `中华台北`. Other country names follow the interface language.

## Regeneration

After reviewing changes to `registry.json`, run:

```sh
node scripts/update-university-reference.mjs
node scripts/update-university-reference.mjs --check
node --test test/mailto-capture-runtime.test.mjs
```

The generator is intentionally offline and deterministic. It rejects missing cohort members, duplicate institution/domain identities, broad suffixes, missing North American locations, and missing or inappropriate display names. The compiled file omits membership/rank evidence and unused translations; its lookup maps are built only when an email is first inspected. Neither settings nor the runtime stores observed addresses. Public source snapshots and preparation scratch files may be kept in the ignored `test-dist/mailto-universities` directory; they are not shipped.
