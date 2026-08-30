# Verification

## Automated checks

From the project directory, run:

```sh
npm test
npm run check
```

The tests cover whitelist matching, settings normalization, locale selection, manifest permissions, local-only assets, script syntax, and interface constraints.

## Chrome checks

1. Open `chrome://extensions`, enable Developer mode, and load the `extension` folder as an unpacked extension.
2. Confirm that Standard mode is active by default and that the global, mode, whitelist, and settings controls are keyboard accessible.
3. Visit a page that installs a page-level `wheel` handler. Scroll with a trackpad and confirm that native browser scrolling continues while the toolbar icon shows the blue suppression dot.
4. Navigate to another page and confirm that the suppression dot clears.
5. Add the current hostname to the whitelist from the popup. Confirm that protection becomes inactive on that page, then remove it in Settings.
6. Add `*.example.com` in Settings and confirm that it covers both `example.com` and its subdomains.
7. Switch to Strong mode and confirm that the setting is reflected in both the popup and Settings.
8. Switch Chrome between light and dark appearance and verify both interfaces.
9. Set Chrome's preferred language to Simplified Chinese, reopen the extension, and verify that the first rendered frame is localized without an English flash.
