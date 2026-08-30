# Verification

## Automated checks

From the project directory, run:

```sh
npm test
npm run check
```

The focused suite covers configuration isolation, exact and wildcard rules, Any Copy mode transitions, whitelist priority, temporary sound expiry, locale selection, page runtimes, Manifest V3 permissions, local-only assets, script syntax, and interface constraints.

## Chrome checks

1. Open `chrome://extensions`, enable Developer mode, and load the `extension` folder as an unpacked extension.
2. Open the popup and confirm that all three product rows align, while the large Cosmic Gemini mark remains static.
3. Turn Native Scroll or No Autoplay off and confirm that its Enhanced and whitelist buttons become unavailable while Settings remains available.
4. Open all three settings pages. Confirm the product switch controls, system theme, and en-US or zh-CN first-frame localization.
5. On a page with a wheel takeover handler, confirm that Native Scroll preserves browser scrolling. Its product icon should be blue while armed and green after an intervention.
6. Add the hostname to Native Scroll's whitelist and confirm that protection becomes inactive. Confirm that a matching whitelist still takes priority over an Enhanced-site rule.
7. On a page that automatically calls `video.play()`, confirm that No Autoplay stops the video while direct playback after a user action still works.
8. On a page that starts audible audio or Web Audio automatically, confirm that the sound prompt appears. Test **Allow this time** and **Always allow**, and confirm that autoplaying video remains blocked.
9. Add a hostname to No Autoplay Enhanced sites and confirm that existing and later video or audio elements are removed.
10. On a page that disables selection or changes copied text, click the Any Copy product icon. Confirm that the icon turns green and the original selection reaches the clipboard without an added suffix.
11. Enter Any Copy Enhanced mode directly from off and confirm that leaving Enhanced mode turns Any Copy off. Then enable standard Any Copy, enter Enhanced mode, and confirm that leaving it returns to standard mode.
12. Confirm that Any Copy Enhanced mode produces a selectable static reading view, preserves useful text and images, and restores the original page without reloading.
13. Confirm that wildcard-covered current-page actions open Settings instead of deleting the wildcard rule.
14. Navigate away and confirm that the toolbar intervention icon returns to its default state.
