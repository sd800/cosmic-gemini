# Public Suffix List source

Cosmic Gemini includes a generated `etld` snapshot derived from the Public Suffix List.

- Source: https://publicsuffix.org/list/public_suffix_list.dat
- Included: the complete ICANN section; the GitHub, GitLab, Cloudflare, CentralNic, Coordination Center for TLD RU, and EU.org PRIVATE groups; and PRIVATE rules below `.scot` and `.krd`
- Excluded: all other PRIVATE groups
- Update command: `node scripts/update-etld.mjs`
- License: Mozilla Public License 2.0 (see `LICENSE` in this directory)

The source version, commit, SHA-256 digest, and rule counts are recorded in `etld.js`.
