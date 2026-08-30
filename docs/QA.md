# Verification

## Automated checks

From the project directory, run:

```sh
npm test
npm run check
```

The focused suite covers configuration isolation, exact and wildcard rules, Any Copy mode transitions, whitelist priority, No Autoplay audio permission, direct media-play intent, image grouping and original-source ranking, Bilibili calendar-day handling, locale selection, page runtimes, Manifest V3 permissions, local-only assets, script syntax, and interface constraints.

## Chrome checks

1. Open `chrome://extensions`, enable Developer mode, and load the `extension` folder as an unpacked extension.
2. Open the popup and confirm that all five product rows align, while the large Cosmic Gemini mark remains static.
3. Turn Native Scroll or No Autoplay off and confirm that its Enhanced and whitelist buttons become unavailable while Settings remains available.
4. Open all six settings pages. Refresh them quickly and switch among them. Confirm that the structure and en-US or zh-CN copy appear together without a blank or wrong-language frame, and that Satellites remains the rightmost switch.
5. On a page with a wheel takeover handler, confirm that Native Scroll preserves browser scrolling. Its product icon should be blue while armed and green after an intervention.
6. Add the hostname to Native Scroll's whitelist and confirm that protection does not start on that website. The product icon, power control, and Enhanced control should use the same neutral opacity, while the whitelist icon turns green as soon as the rule matches. Confirm that a matching whitelist still takes priority over an Enhanced-site rule. Repeat with No Autoplay and confirm that video, audio, and Web Audio may autoplay there.
7. On a page that automatically calls `video.play()`, confirm that No Autoplay stops the video. Click both native and custom playback controls and confirm that the first trusted click starts playback and updates the page control normally.
8. On a page that starts audible audio or Web Audio automatically, confirm that No Autoplay blocks it without showing a page prompt. Turn on **Allow audio autoplay on all sites** and confirm that audio elements and Web Audio may start everywhere while autoplaying video remains blocked. Turn it off, add a website under **Always allow audio autoplay**, and confirm that only matching websites receive the same audio permission.
9. Add a hostname to No Autoplay Enhanced sites and confirm that existing and later video or audio elements are removed.
10. On a page that disables selection or changes copied text, click the Any Copy product icon. Confirm that the icon turns green and the original selection reaches the clipboard without an added suffix.
11. Enter Any Copy Enhanced mode directly from off and confirm that leaving Enhanced mode turns Any Copy off. Then enable standard Any Copy, enter Enhanced mode, and confirm that leaving it returns to standard mode.
12. Confirm that Any Copy Enhanced mode produces a selectable static reading view, preserves useful text and images, and restores the original page without reloading.
13. On a page containing regular, responsive, lazy-loaded, linked, CSS, SVG, and canvas images, open the popup and click Image Download. Confirm that the already-prepared workspace opens in Chrome’s Side Panel without replacing or leaving the source tab, remains bound to that tab, and uses a usable single-column layout at a narrow width. Repeat several times and confirm that no separate workspace tab appears after a transient Side Panel error. Confirm that related variants stay grouped and the largest valid original candidate is recommended without hiding alternatives.
14. Filter Image Download results by text, format, layout, and dimensions. Select visible results and verify separate and ZIP downloads. Confirm that original format is preserved by default and that JPEG, PNG, and WebP conversion happens only after selection.
15. Use Image Download’s area capture, normal rescan, and deep scan. Confirm that the selected visible region becomes a result, the rescan icon is a single circular arrow, deep scan reveals compatible lazy images, and the source page returns to its original scroll position. During a scan, confirm that both scan controls remain unavailable and rapid clicks do not start another scan. Confirm that rapid clicks on open, capture, stop, or download controls also produce one action. Use the Side Panel action to open the full workspace in a separate tab, then change the workspace-location setting and confirm the next session opens directly in that tab. Change the setting back to Side Panel and confirm that an opening failure leaves the source tab selected instead of silently creating a separate tab.
16. On a page with a direct MP4 or WebM source, click Video Download. Confirm that its result view opens immediately, the icon changes from blue to green after detection, and the selected file is streamed locally before being handed to Chrome Downloads.
17. On a page with a compatible HLS master playlist, confirm that available variants and alternate audio are shown, the selected playlist is assembled without loading the complete output into memory, and its temporary artifact is removed when Chrome finishes or interrupts the download.
18. With No Autoplay enabled, open `https://www.bilibili.com/video/BV1yM4y1t7zB/` without starting playback. Confirm that Video Download shows the video thumbnail and title, presents one concise option for each main quality, and keeps an open quality menu stable while status polling continues. Start a selected format and use the red cancel icon while it is being prepared. Confirm that processing stops, no Chrome download begins, partial local files and media-header rules are removed, and the format can be selected again. Then complete a selected video after local audio-video merging and confirm that a CDN returning a complete response without Range support produces no Mediabunny warning. Confirm that Chrome uses the displayed video title rather than the temporary artifact identifier as its filename. Choose Audio only and confirm that the standalone track uses the same title when available. Repeat on YouTube and confirm that combined or locally remuxed formats and subtitles remain available.
19. On a compatible unprotected DASH page, confirm that representations are expanded and selected audio and video tracks produce one MP4 or MKV file. Confirm that a protected representation remains unavailable.
20. Confirm that Image Download and Video Download continue across same-origin navigation, clear old candidates, and stop after cross-origin navigation, source-tab closure, or their stop controls. Confirm that inactive tabs are not scanned.
21. Add wildcard Whitelist and Enhanced rules that cover the current website. Click each active control in the popup and confirm that its matched wildcard rule is removed directly. Confirm that only the Settings control opens Settings.
22. Rapidly click each popup state control twice and confirm that only one action is accepted. In Settings, repeat with switches, selects, Add, and rule removal controls. Confirm that one save occurs and that a failed save restores the last confirmed value.
23. Navigate away and confirm that the toolbar intervention icon returns to its default state.
24. Open Satellites and enable Bili Daily Login while a Bilibili account is already signed in to Chrome. Confirm that an incomplete task is scheduled without opening or inspecting a Bilibili tab, that later work follows the 00:05 China Standard Time boundary, and that disabling the feature clears its alarm.
