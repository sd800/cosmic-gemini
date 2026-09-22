# Document Preview renderer build

The package files pin the build tools and the complete dependency tree outside
the extension package. No npm code is installed or fetched at extension runtime.

Copy `package.json` and `package-lock.json` from this directory into a temporary
build directory, then run from the repository root:

```sh
npm ci --prefix /path/to/build-directory --ignore-scripts --no-audit --no-fund
node scripts/build-document-renderer.mjs /path/to/build-directory
```

The script bundles Mammoth's browser entry, minifies it, gathers complete license
texts (including dependencies embedded by other packages), and prints its hash.
Update the vendor NOTICE with that hash when intentionally rebuilding. The
conversion worker validates ZIP sizes and output separately; do not remove those
checks or render unsanitized converter output.
