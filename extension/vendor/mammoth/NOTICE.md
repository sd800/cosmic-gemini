# Mammoth

Mammoth 1.12.3, BSD-2-Clause license, by Michael Williamson.
Upstream: https://github.com/mwilliamson/mammoth.js
Package: https://registry.npmjs.org/mammoth/-/mammoth-1.12.3.tgz
The browser bundle is rebuilt locally from the upstream source with locked
compatible dependencies and Cosmic Gemini’s local formatting adapter and static spreadsheet/presentation, legacy Office, RTF, OpenDocument and email readers. Exact-match
build hooks carry formatting context through parsing and HTML conversion and reuse
parsed XML parts. First-party adapter sources are in `scripts/document-renderer/`.
Full runtime dependency notices are included in
THIRD_PARTY_NOTICES.txt. JSZip is used under its MIT license.

Package integrity (SHA-512/base64):
`kkv2MrSFk3f/w3uLsz4FG/91LdWp2j+qmp7AjG2v7w2xgX5YDxiaFlaWourXrXtyUR6335+9guyIlPBnhHLvKw==`

Browser bundle SHA-256:
`325175167c93ba66f3501dab2698b413db7808babbe6b80a63fe53cd4371b085`

Build inputs: docs/document-renderer-build/package-lock.json.
Build command: node scripts/build-document-renderer.mjs <build-directory>.

The renderer is loaded only by Document Preview's dedicated worker. No CDN or
remote conversion service is used. External file access and embedded style maps
are disabled. Converter output is rebuilt as an allowlisted tree and shown in a
script-free sandbox with external subresources blocked.
