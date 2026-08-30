# Verification

## Automated checks

From the project directory, run:

```sh
npm test
npm run check
```

The focused tests cover configuration isolation, exact and wildcard matching, whitelist priority, temporary sound expiry, locale selection, both page runtimes, Manifest V3 permissions, local-only assets, script syntax, and interface constraints.

## Chrome checks

1. Open `chrome://extensions`, enable Developer mode, and load the `extension` folder as an unpacked extension.
2. Open the popup and confirm that its Cosmic Gemini mark remains static while the two product rows operate independently.
3. Turn either product off and confirm that its Strong-site and whitelist buttons become unavailable while its Settings button remains available.
4. Open both settings pages. Confirm the two-line product wordmarks, product switch controls, system theme, and en-US or zh-CN first-frame localization.
5. On a page with a wheel takeover handler, confirm that Native Scroll preserves browser scrolling and changes the toolbar icon only after an intervention.
6. Add the hostname to Native Scroll's whitelist, then confirm that protection becomes inactive. Add the same hostname to Strong sites and confirm that the whitelist still takes priority.
7. On a page that automatically calls `video.play()`, confirm that No Autoplay stops the video while direct playback after a user action still works.
8. On a page that automatically starts audible audio or Web Audio, confirm that the sound prompt appears at the top right.
9. Choose **Allow this time** and confirm that audio resumes while autoplaying video remains stopped. Close every tab for that hostname and confirm that a new visit asks again.
10. Choose **Always allow** and confirm that the exact hostname appears in No Autoplay settings and can be removed there.
11. Add a hostname to No Autoplay Strong sites and confirm that video and audio elements already present or added later are removed.
12. Confirm that the toolbar icon returns to its default state after navigation and changes when either product intervenes.
