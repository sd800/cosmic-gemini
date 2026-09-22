# Document Preview renderer build

The package files pin the build tools and the complete dependency tree outside
the extension package. No npm code is installed or fetched at extension runtime.

Copy `package.json` and `package-lock.json` from this directory into a temporary
build directory, then run from the repository root:

```sh
npm ci --prefix /path/to/build-directory --ignore-scripts --no-audit --no-fund
node scripts/build-document-renderer.mjs /path/to/build-directory
```

The script bundles the first-party entry in `scripts/document-renderer/` with Mammoth, minifies it, gathers complete license
texts (including dependencies embedded by other packages), and prints its hash.
Update the vendor NOTICE with that hash when intentionally rebuilding. The
conversion worker validates ZIP sizes and output separately; do not remove those
checks or render unsanitized converter output.

The adapter preserves common Word formatting alongside Mammoth’s content model.
Small, exact-match build hooks attach parsing context and decorate HTML nodes;
they do not edit installed dependencies. Missing or changed hooks fail the build.
Styles are deduplicated data, checked again by the preview’s property/value
allowlist. Updating the parser requires rerunning the bundled-conversion tests
in `test/document-preview.test.mjs`, as well as browser checks for light/dark
appearance, narrow viewports, tables, embedded images and page-break separators.

The same bundle includes first-party static OOXML spreadsheet and presentation readers. They reuse the existing bounded ZIP/XML dependencies; no Office runtime is used. Family dispatch covers document/template/macro and slideshow suffixes without evaluating VBA, formulas, ActiveX or embedded programs. Worksheet cells use cached values, and presentations render static text, tables, shapes and local raster pictures. Test package relationships, inherited slide transforms, external-resource exclusion and the macro/template variants whenever rebuilding. PDF uses Chrome’s native viewer and does not load this bundle.

The same worker also bundles first-party CFB/MS-DOC/MS-PPT, RTF and OpenDocument readers, plus PostalMime 3.0.0 for EML. SheetJS CE 0.20.3 is copied as a separate local bundle and imported only for legacy XLS; its full build preserves legacy codepages. The package lock pins the official SheetJS tarball and all build inputs. No dynamic package lookup occurs at runtime. PostalMime’s license is included with the renderer notices; SheetJS’s license and bundle hash are under `vendor/sheetjs`. Legacy Word/PowerPoint intentionally provide content previews instead of layout emulation.

When changing any reader, test malformed/encrypted containers, cyclic compound streams, excessive repetitions, MIME nesting, remote resources, active HTML and output limits. Verify the sanitization boundary in a real independent browser, not only converter unit tests. PDF stays in Chrome’s native viewer and is not modified by this build.
