# Cosmic Gemini

[简体中文](README_zh.md)

Cosmic Gemini is a personal Chrome toolkit for a calmer, more controllable web. It combines Native Scroll, No Autoplay, Any Copy, Video Download, and a collection of smaller tools called Satellites.

## Products

### Native Scroll

Native Scroll intercepts page code that takes over wheel or trackpad gestures while preserving ordinary controls and scrollable areas. Enhanced mode handles selected websites that repeatedly restore custom scrolling or simulate page movement.

Background: Some websites replace the browser’s native scrolling with scripted motion, changing the familiar feel of a trackpad and making navigation less predictable. Native Scroll restores a consistent, browser-controlled scrolling experience.

### No Autoplay

No Autoplay stops video and sound that starts without your action. Media you intentionally play remains available. When a website attempts to autoplay sound, you can keep blocking it, allow it temporarily, or always allow sound for that website. Enhanced mode removes media elements on selected websites.

Background: Pages can begin playing video or sound before you ask, interrupting reading and competing with audio already in use. No Autoplay keeps media quiet until you choose to start it.

### Any Copy

Any Copy restores text selection and copy shortcuts on websites that disable them. It also prevents pages from replacing copied text or adding unwanted promotional content. Enhanced mode rebuilds a page as a clean, static reading view with selectable text and unobstructed images. The original page remains available underneath and returns immediately when Enhanced mode ends.

Background: Some websites disable selection, block copy shortcuts, or rewrite clipboard content with unwanted additions. Any Copy brings ordinary selection and copying back under your control.

### Video Download

Video Download finds downloadable media in the current tab and opens its format list immediately. It shows duration and file size whenever the page or existing response data makes them available, without pre-downloading media for metadata. It supports direct files, HLS, DASH, separate video and audio tracks, subtitles, and live snapshots, with local stream assembly and remuxing after you select a download. Dedicated discovery covers YouTube, Bilibili, Vimeo, Facebook, Instagram, OK, VK Video, Canva, iQIYI, TwitCasting, Osmosis, Kick, Chaturbate, and compatible wrapped HLS players. Detection remains limited to the active tab session and follows same-site navigation until you stop it or leave the website.

Background: Web players often hide media addresses behind scripts, streaming manifests, or embedded frames, making a video that already plays in Chrome difficult to save. Video Download finds compatible sources when you ask and sends the selected result to Chrome’s download system.

### Satellites

Satellites contains optional tools that perform small background tasks without needing controls in the popup.

#### Bili Daily Login

Background: Bilibili gives every signed-in account one coin when it visits each day. Receiving that coin otherwise depends on remembering to return every day. Bili Daily Login handles the recurring visit at 00:05 China Standard Time while Chrome is available, allowing the daily coin to be credited automatically.

## Features

- Independent controls and website rules for Native Scroll, No Autoplay, and Any Copy
- On-demand media detection with direct files, HLS, DASH, local audio-video remuxing, subtitles, and service-specific discovery
- Optional Satellites with their own concise settings and privacy details
- Exact-host and wildcard rules such as `example.com` and `*.example.com`
- A compact popup with current-page controls
- Separate settings pages with direct product switching and stable first-frame localization
- Natural en-US and zh-CN interfaces with system-aware light and dark themes
- Event-driven runtimes without polling or a persistent background page
- No analytics, browsing history, or activity log

## Install

1. Clone or download this repository.
2. Open `chrome://extensions` in Chrome.
3. Enable **Developer mode**.
4. Select **Load unpacked** and choose the [`extension`](extension) folder.

Chrome requests access to HTTP and HTTPS pages so the tools can begin before ordinary website scripts.

## Use

The popup contains one row for each product.

- Native Scroll and No Autoplay provide **Power**, **Enhanced**, **Whitelist**, and **Settings** controls.
- Any Copy is enabled for the current website by clicking its product icon. Its **Enhanced** control may be used directly from the off state, and **Settings** manages Standard mode and Enhanced mode sites.
- Video Download is enabled for the current tab by clicking its product icon. Its media list opens immediately, remains available through same-site navigation, and closes when you stop it, close the tab, or leave the website.
- Satellites are managed only from the rightmost settings icon. Bili Daily Login is off by default. After you enable it, the task runs on its own schedule while Chrome and the computer are running. After any length of downtime, one current-day task catches up when Chrome can next run; earlier missed days are never replayed.
- When Any Copy enters Enhanced mode directly from off, leaving Enhanced mode turns Any Copy off. If standard Any Copy was already enabled, leaving Enhanced mode returns to standard behavior.

Native Scroll and No Autoplay icons are neutral when unavailable or off, blue while enabled, and green after the feature intervenes on the current page. Any Copy has no blue state: it turns green while enabled for the current website. Video Download is neutral while off, blue while scanning, and green after compatible media is found. The main Cosmic Gemini mark in the popup remains unchanged.

### Website rules

`example.com` matches that hostname only. `*.example.com` matches the root domain and all of its subdomains. Popup actions save the exact current hostname; Settings also accepts wildcard rules. A whitelist rule takes priority over an Enhanced-site rule for Native Scroll and No Autoplay.

### Temporary sound permission

**Allow this time** applies to the current hostname until all matching pages are closed or two days have passed, whichever happens first. The permission is then deleted automatically. **Always allow** creates a rule that remains in No Autoplay settings until removed.

## Privacy

Native Scroll, No Autoplay, Any Copy, and Video Download run locally. Cosmic Gemini stores only product settings, website rules you choose, valid temporary sound permission, and the Bili Daily Login completion date. Video Download keeps detected media addresses only in `chrome.storage.session` for its active tab and deletes them when that session ends. It does not keep browsing history or an activity log or use analytics. Bili Daily Login does not inspect whether or when you open Bilibili. When enabled, its background schedule contacts Bilibili while Chrome and the computer are running, using the account already signed in to Chrome; it never reads or stores your Bilibili password. Stored website rules contain hostnames rather than complete URLs.

## Compatibility

Cosmic Gemini targets Chrome 120 or later on macOS, Windows, and Linux. Chrome prevents extensions from running on internal pages such as `chrome://`, the Chrome Web Store, and some built-in viewers. Video Download handles compatible media made available to the current browser session. It does not decrypt DRM, use private third-party rule services, or reproduce another extension’s licensing and paid-feature checks.

## Development

Cosmic Gemini uses Manifest V3 and bundles its local media-processing dependencies with the extension. See [Technical design](docs/TECHNICAL.md) for the architecture and [Verification](docs/QA.md) for focused checks.

```sh
npm test
npm run check
```

© 2026 Songming.org
