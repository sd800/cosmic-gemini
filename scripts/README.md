# Development scripts

Run commands from the project root. `npm test` and `npm run check` remain the main entry points.

| Folder | Purpose |
| --- | --- |
| `checks/` | Static checks and the unit-test runner. |
| `browser/` | Browser integration checks and their shared PDF lifecycle helper. |
| `build/` | Generated document-renderer bundles and the compact site-key helper. First-party renderer adapters live in `build/document-renderer/`. |
| `update/` | Curated suffix, telephone, and institution-reference updates. |
| `vendor/` | Pinned PDF.js packaging and its rendering patch. |

Browser checks accept their documented local Playwright/Chrome environment variables. For example:

```sh
PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs TEST_CHROME=/path/to/chrome node scripts/browser/test-crash-page-warden-browser.mjs
```

Use the focused check for the changed feature. Reusable fixtures and concise instructions belong in ignored `test-dist/`; see [QA](../docs/QA.md) for individual procedures.
