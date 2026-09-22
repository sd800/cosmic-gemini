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
