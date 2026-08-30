# Verification

## Automated checks

From the project directory, run:

```sh
npm test
npm run check
```

The focused suite covers configuration isolation, exact and wildcard rules, Any Copy mode transitions, whitelist priority, temporary sound expiry, Bilibili calendar-day handling, locale selection, page runtimes, Manifest V3 permissions, local-only assets, script syntax, and interface constraints.

## Chrome checks

1. Open `chrome://extensions`, enable Developer mode, and load the `extension` folder as an unpacked extension.
2. Open the popup and confirm that all four product rows align, while the large Cosmic Gemini mark remains static.
3. Turn Native Scroll or No Autoplay off and confirm that its Enhanced and whitelist buttons become unavailable while Settings remains available.
4. Open all five settings pages. Refresh them quickly and switch among them. Confirm that the structure and en-US or zh-CN copy appear together without a blank or wrong-language frame, and that Satellites remains the rightmost switch.
5. On a page with a wheel takeover handler, confirm that Native Scroll preserves browser scrolling. Its product icon should be blue while armed and green after an intervention.
6. Add the hostname to Native Scroll's whitelist and confirm that protection becomes inactive. Confirm that a matching whitelist still takes priority over an Enhanced-site rule.
7. On a page that automatically calls `video.play()`, confirm that No Autoplay stops the video while direct playback after a user action still works.
8. On a page that starts audible audio or Web Audio automatically, confirm that the sound prompt appears. Test **Allow this time** and **Always allow**, and confirm that autoplaying video remains blocked.
9. Add a hostname to No Autoplay Enhanced sites and confirm that existing and later video or audio elements are removed.
10. On a page that disables selection or changes copied text, click the Any Copy product icon. Confirm that the icon turns green and the original selection reaches the clipboard without an added suffix.
11. Enter Any Copy Enhanced mode directly from off and confirm that leaving Enhanced mode turns Any Copy off. Then enable standard Any Copy, enter Enhanced mode, and confirm that leaving it returns to standard mode.
12. Confirm that Any Copy Enhanced mode produces a selectable static reading view, preserves useful text and images, and restores the original page without reloading.
13. On a page with a direct MP4 or WebM source, click Video Download. Confirm that its result view opens immediately, the icon changes from blue to green after detection, and the selected file is streamed locally before being handed to Chrome Downloads.
14. On a page with a compatible HLS master playlist, confirm that available variants and alternate audio are shown, the selected playlist is assembled without loading the complete output into memory, and its temporary artifact is removed when Chrome finishes or interrupts the download.
15. On a Bilibili video, confirm that Video Download shows multiple qualities and merges the selected video and audio tracks locally. Repeat on YouTube and confirm that combined or locally remuxed formats and subtitles are listed when available.
16. On a compatible unprotected DASH page, confirm that representations are expanded and selected audio and video tracks produce one MP4 or MKV file. Confirm that a protected representation remains unavailable.
17. Confirm that Video Download continues across same-origin navigation, clears old candidates, and stops after cross-origin navigation, tab closure, or the result view's stop button. Confirm that an inactive tab is not scanned.
18. Confirm that wildcard-covered current-page actions open Settings instead of deleting the wildcard rule.
19. Navigate away and confirm that the toolbar intervention icon returns to its default state.
20. Open Satellites and enable Bili Daily Login while a Bilibili account is already signed in to Chrome. Confirm that an incomplete task is scheduled without opening or inspecting a Bilibili tab, that later work follows the 00:05 China Standard Time boundary, and that disabling the feature clears its alarm.
