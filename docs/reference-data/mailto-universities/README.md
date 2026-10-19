# University email-domain reference

`registry.json` is the reviewed build input for Mailto Capture. It contains public institution facts, domain aliases, principal-campus locations and cohort membership. It never contains captured user email addresses. The one published institutional mailbox is an exact-match exception for a college sharing a government domain; other addresses under that domain are not attributed to the college.

## Coverage snapshot

Reviewed on **2026-10-19**. The domestic U.S. cohorts no longer use a rank cutoff. The QS/global cohorts retain their existing top-300 thresholds, including boundary ties.

| Cohort | Edition/source | Selected institutions |
| --- | --- | ---: |
| U.S. News National Universities, all public-source entries | 2027 | 427 |
| U.S. News National Liberal Arts Colleges, identifiable public-source entries without a rank cutoff | 2027 | 199 |
| Supplementary official baccalaureate arts/sciences institutions | NCES IPEDS HD2024, C21BASIC=21 | 216 |
| QS World University Rankings, rank ≤ 300 | 2027 | 301 |
| U.S. News Best Global Universities, rank ≤ 300 | 2026–2027 | 303 |
| Mainland Double First-Class institutions, including historical 985/211 institutions | Ministry of Education second-round list | 147 |
| Mainland ordinary institutions with a reviewed permitted domain | MOE list dated 2026-06-17 | 2,057 |
| Mainland adult institutions with a reviewed permitted domain | MOE list dated 2026-06-17 | 36 |
| Hong Kong degree-awarding institutions | Education Bureau | 22 |
| Hong Kong supplementary postsecondary providers | CSPE provider-level directory | 29 |
| Hong Kong subsidiary tertiary providers/institutes | Full CSPE child-provider list and official institutional hosts | 16 |
| Macau higher education institutions | DSEDJ | 10 |
| Taiwan general universities (`體制=一般大學`, retained source cohort) | Official 114 academic-year directory | 66 |
| All eligible Taiwan civil higher-education categories | Official directory: 149 source institutions, 147 with permitted hosts | 147 |
| Taiwan military/police higher education | Official school directories | 9 |
| U.S. university/community-college systems and central administrative offices | Official system directories | 18 |
| Affiliated campuses, overseas campuses and joint universities | Reviewed official institution/campus directories | 18 |

Cohorts overlap. The compiled reference contains **3,267 institution/domain groups**, **3,628 explicit domain suffixes** and **one exact shared-domain mailbox**. A group can represent two institutional identities sharing one domain, such as the two HKCT providers; its display name includes both. Ranking membership is retained only for maintenance, never displayed as a credential or ranking in the popover.

## Source coverage and remaining gaps

The mainland audit, `mainland-domain-audit.json`, accounts for every **3,196** entry in the 2026 MOE list (2,952 ordinary and 244 adult institutions). **2,093** are mapped; **866** currently have only outside-policy homepages in the reviewed sources; **216** have no usable published domain in those sources; **21** need shared-host identity review. Mainland and Taiwan hosts, including earlier aliases, must end in an explicit `edu/ac/gov/mil` DNS class, optionally followed by a two-letter country suffix. Substrings such as `edu.example.com` do not qualify. This restriction does not apply to Hong Kong, Macau or other regions. The `nwsuaf.cn` alias is removed while `nwsuaf.edu.cn` remains. Two civil Taiwan institutions have only outside-policy hosts in the official list and are explicitly excluded in the source metadata. A missing domain is not proof that a school has no permitted domain; unresolved entries are deliberately not guessed. Domain facts from GlobalUniversityHomePages are joined by exact MOE school code; public directory supplements use exact Chinese names. Source spelling changes do not authorize fuzzy matching to another institution.

The public National Universities transcription has 427 entries, including unranked institutions, and was read to its empty final page. The public liberal-arts transcription has duplicate/missing entries at tied pagination boundaries. After disambiguating the two Wheaton colleges and the St. John’s campuses, 196 distinct campus entries are recoverable; official institution reports repair three more omissions. The resulting **199** entries include unranked institutions and are **not** represented as a complete 203-ranked-institution publisher export. The separate NCES arts/sciences cohort broadens domain coverage without inventing U.S. News membership. Known closed Birmingham–Southern, Wells and Magdalen are excluded from that supplement. Ranked/unranked status is never shown in Mailto Capture.

## Sources and identity decisions

Each cohort in `registry.json` records its edition, source URLs, expected membership count and, where snapshots are used, their SHA-256 hashes. System/administrative-office records additionally retain per-record official evidence links. QS and the regional education directories provide public first-party lists. Because U.S. News did not provide readable complete publisher tables during preparation, the U.S. News cohorts use the explicitly cited public Menggy, FindingSchool, College Kickstart and XuanXiao transcriptions, plus recorded official institution reports. Do not describe these transcriptions as direct publisher exports.

Domain alignment uses [Hipo's MIT-licensed directory](https://github.com/Hipo/university-domains-list), the [MIT-licensed GlobalUniversityHomePages dataset](https://huggingface.co/datasets/XUEHANGAI/GlobalUniversityHomePages), official institution links in the education directories, and reviewed institution aliases. The bundled license is at `extension/content/mailto-capture/university-domains-LICENSE.txt`. Candidate fuzzy matches were not accepted automatically. The runtime performs no fuzzy matching, rank lookup or remote update.

U.S. states use the NCES IPEDS HD2024 directory with explicit principal-campus corrections for shared/system domains; the HD2025 ZIP was not publicly retrievable during preparation. Canadian provinces follow the Universities Canada directory and institution main-campus locations. The location describes the institution's legal principal campus, not the email user's location or a department's IP address. System and administrative-office entries instead describe the organization and the state of its official administrative headquarters. They never impersonate a constituent campus. More specific independently listed campus hosts still take precedence through the longest explicit host match. Do not infer a campus from an unrelated department label.

Some institutional domains have historical or student-only alternatives. Keep confirmed aliases attached to the same institution, but do not infer aliases from similar spelling. In particular, `cuhk.edu.cn` has its own Shenzhen record and China region; `hkust-gz.edu.cn` likewise identifies the Guangzhou university in China. Neither receives its Hong Kong partner's location. Generic suffixes and shared email providers are not school identifiers. The shared Macau government domain is matched only for its published college mailbox. A directory's prefixed Taiwan institutional web host (`w3`, `www1`, etc.) also retains the corresponding institution's `.edu.tw` root.

The `us-systems` cohort includes `cccco.edu`, `calstate.edu`, `ucop.edu`, `suny.edu`, `cuny.edu`, `utsystem.edu`, `tamus.edu`, `usg.edu`, `northcarolina.edu`, `wisconsin.edu` (plus its confirmed `uwsa.edu` email alias), `vccs.edu`, `nccommunitycolleges.edu`, `tcsg.edu`, `accs.edu`, `kctcs.edu` `minnstate.edu`, `iu.edu` and `inter.edu`. Official source URLs are recorded with each entry. Shared SUNY/CUNY roots are accepted only as explicitly evidenced system records; generic education suffixes remain prohibited.

The Dearborn record retains both `umdearborn.edu` and `umd.umich.edu`, as documented in the university’s [domain policy](https://umdearborn.edu/policies-and-procedures/university-it-policies-standards/subdomain-policy-and-procedure-requesting) and [admissions directory](https://www.catalog.umd.umich.edu/undergraduate/admissions/). These explicit hosts and their subdomains identify University of Michigan–Dearborn before the broader `umich.edu` match. Other Michigan addresses retain University of Michigan.

The `affiliated-campuses` cohort explicitly covers Michigan–Flint; CUHK Shenzhen; HKUST Guangzhou; NYU Shanghai/Abu Dhabi; Nottingham Ningbo/Malaysia; Xi’an Jiaotong–Liverpool; Duke Kunshan; Monash Malaysia; Curtin Malaysia/Dubai; Swinburne Sarawak; Wollongong Dubai; Northwestern Qatar; Carnegie Mellon Qatar; Beijing Normal–Hong Kong Baptist University; and Xiamen University Malaysia. Every record has source links and covered-institution affiliation IDs. These relationships include joint universities and do not imply that every institution is owned by another. Campus location is its own physical country/region; U.S./Canadian campuses use their own state/province. A shared parent email domain alone cannot identify an individual campus, and the runtime never guesses from a mailbox’s local part.

Domain aliases remain attached to a single identity: `wustl.edu`/`washu.edu`, `swinburne.edu.au`/`swin.edu.au`, `uic.edu.cn`/`bnbu.edu.cn`, and `dku.edu.cn`/`dukekunshan.edu.cn` have official evidence links in the records. `hku.edu` is an explicit user-requested compatibility alias of `hku.hk`, recorded as such in `aliasNotes`; it is not represented as independently verified university ownership. Existing `ouhk.edu.hk`/`hkmu.edu.hk` and `hsmc.edu.hk`/`hsu.edu.hk` mappings remain intact. More specific campus hosts always outrank broader school aliases.

## Display policy

- Review institution names individually; do not title-case source strings or replace every comma with a campus separator. The SUNY university centers use the full names in the [authorized campus-name table](https://www.suny.edu/media/suny/content-assets/documents/CampusNames_December-2022.pdf) and the [current research directory](https://www.suny.edu/impact/research/). Geneseo/Purchase/Old Westbury likewise use reviewed full institutional names. The CUNY system displays `City University of New York`; Hunter College and Medgar Evers College retain their individual identities. Per-record `nameEvidence` links record the name review without entering the bundled data. Preserve original cohort spellings as source evidence, not as the display name.
- Use `University of North Carolina at Chapel Hill` and the reviewed lowercase connecting words in other English names. Preserve proper internal capitalization such as DePaul/DeSales/D’Youville. `University of Illinois at Chicago` is an explicitly requested display form; [UIC’s current style guide](https://brand.uic.edu/messaging/editorial-and-style-guide/) instead uses `University of Illinois Chicago`, and this distinction is retained in the source notes. `University of California, San Diego` deliberately keeps its comma. Missing spaces, duplicated spaces and source-wide title casing are not valid reasons to overwrite these reviewed forms.
- Mainland/Hong Kong/Macau/Taiwan institutions use Simplified Chinese primary school names. In English UI, mainland English-name rows are limited to the reviewed 985/211/Double First-Class identities and their explicitly linked affiliated campuses. Undergraduate status or a world-ranking entry alone does not qualify. HK/MO/TW include an English-name row only when a reliable English name is available; missing names never create an empty row. Mainland-origin overseas campuses with distinct reviewed hosts (such as Xiamen University Malaysia) also use Chinese primary names plus English names in English UI, while keeping their own physical country/region. Missing reliable English names produce no empty row. Chinese UI omits all supplemental English-name rows. Other institutions use Latin-character names without parenthesized common acronyms. Legal foundation wrappers are omitted from Taiwan display names; original names remain in membership evidence.
- Use an en dash (`–`) for campus separators, such as University of Michigan–Dearborn and University of Wisconsin–Madison. Standalone dash separators also use an en dash; preserve real compound-word/place-name hyphens such as Aix-Marseille and Urbana-Champaign. Original source membership spellings remain unchanged as evidence.
- School names and country/region occupy separate lines beneath each original To/CC/BCC address. Unknown addresses have no empty metadata rows or error message. School metadata never enters copied addresses/messages.
- U.S. and Canadian institutions include the full principal-campus state/province. U.S. country text is always `USA`.
- English regional labels: `China`, `Hong Kong, China`, `Macau, China`, `Chinese Taipei`. Simplified Chinese labels: `中国`, `中国香港`, `中国澳门`, `中华台北`. Other country names follow the interface language.

## Regeneration

After reviewing changes to `registry.json`, run:

```sh
node scripts/update-university-reference.mjs
node scripts/update-university-reference.mjs --check
node --test test/mailto-capture-runtime.test.mjs
```

The generator is intentionally offline and deterministic. It rejects missing cohort members, duplicate institution/domain identities, broad suffixes, missing North American locations, and missing or inappropriate display names. Only eligible bilingual rows carry an additional English name; eligibility is compiled from reviewed identities and affiliation relationships, never inferred at runtime. The compiled reference is **206,805 bytes** (about 207 KB), with a 260 KB build guard. The compiled file omits membership/rank evidence, affiliation graphs and unused translations; its lookup maps are built only when an email is first inspected. Neither settings nor the runtime stores observed addresses. Public source snapshots and preparation scratch files may be kept in the ignored `test-dist/mailto-universities` directory; they are not shipped.

The shared `csbsju.edu` host identifies College of Saint Benedict and Saint John’s University together; it does not arbitrarily select one college. The explicitly reviewed `morris.umn.edu` host identifies University of Minnesota–Morris before the broader Minnesota root. Duplicate Shanghai Jiao Tong/Minnesota web-host records are consolidated into their existing institutional identity without dropping source membership.

## Regional completeness and shared-host limits

The Taiwan civil list is no longer filtered to general universities. All 149 official rows are reviewed: 66 general universities, 73 technological/vocational institutions, 8 religious institutes and 2 open universities. Two religious institutes have no permitted host in that source, leaving 147 bundled civil institutions. The official military-academy directory adds seven higher-education schools (not the secondary preparatory school); the two police higher-education schools are also included. Keep `afats.khc.edu.tw` specific; never claim the broader `khc.edu.tw` education host. Official directory English names are reliable; military/police entries without a reviewed current English name omit the optional row. Do not import presidents’ names, their email addresses or phone numbers from the civil source.

Hong Kong retains all EDB degree-awarding and CSPE provider-level entries and now reviews every CSPE subsidiary provider. IVE/HKDI/HKIIT have their distinct confirmed hosts. HKU SPACE and its Community College share a descriptive group. LiPACE/LIFE are documented under their parent host because their current official URLs distinguish them by paths; an email address does not carry that path, and no child domain is fabricated. Macau remains the full official ten-institution directory, including the exact shared-government-mailbox exception.

Indiana and Inter American system roots are separate from the explicit `southeast.iu.edu` and `metro.inter.edu` campus hosts. The shared `pucpr.edu` host describes Pontifical Catholic University of Puerto Rico rather than arbitrarily selecting Arecibo. Preserve true name hyphens (Hampden-Sydney, Randolph-Macon, Gardner-Webb, Bethune-Cookman, Harris-Stowe and East-West); campus separators use en dashes.
