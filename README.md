# Cosmic Gemini

[简体中文](README_zh.md)

Cosmic Gemini is a personal Chrome toolkit for a calmer, more controllable web. It combines Native Scroll, No Autoplay, Any Copy, Image Download, Video Download, and a collection of smaller tools called Satellites.

## Products

### Native Scroll

Native Scroll intercepts page code that takes over wheel or trackpad gestures while preserving ordinary controls and scrollable areas. Enhanced mode handles selected websites that repeatedly restore custom scrolling or simulate page movement.

Background: Some websites replace the browser’s native scrolling with scripted motion, changing the familiar feel of a trackpad and making navigation less predictable. Native Scroll restores a consistent, browser-controlled scrolling experience.

### No Autoplay

No Autoplay stops video and audio that starts without your action. Media you intentionally play remains available. Audio autoplay stays blocked unless you allow it for all sites or through a matching website rule. Enhanced mode removes media elements on selected websites.

Background: Pages can begin playing video or sound before you ask, interrupting reading and competing with audio already in use. No Autoplay keeps media quiet until you choose to start it.

### Any Copy

Any Copy restores text selection and copy shortcuts on websites that disable them. It also prevents pages from replacing copied text or adding unwanted promotional content. Enhanced mode rebuilds a page as a clean, static reading view with selectable text and unobstructed images. The original page remains available underneath and returns immediately when Enhanced mode ends.

Background: Some websites disable selection, block copy shortcuts, or rewrite clipboard content with unwanted additions. Any Copy brings ordinary selection and copying back under your control.

### Image Download

Image Download finds images in the current tab and opens a dedicated workspace in Chrome’s Side Panel by default, keeping the source page visible while you preview, filter, select, and download them. You can instead use a separate tab from Settings or open the full-page workspace directly from the Side Panel. It recognizes responsive and lazy-loaded sources, linked originals, CSS images, open shadow roots, frames, inline SVG, canvas captures, structured metadata, and images observed during the active session. Related variants stay together, with the strongest original candidate recommended by default. You can rescan, reveal lazy-loaded images, capture part of the visible page, preserve original formats or convert compatible images locally, and download selections separately or in one ZIP file.

### Video Download

Video Download finds downloadable media in the current tab and opens its format list immediately. A page thumbnail and title identify the current video, while the quality menu keeps one preferred option for each main resolution and offers Audio only when a compatible track is available. Codec, container, duration, and known file-size details remain visible for the selected option without crowding the menu or pre-downloading media for metadata. It supports direct files, HLS, DASH, separate video and audio tracks, subtitles, and live snapshots, with local stream assembly and remuxing after you select a download. While a file is being prepared, the red cancel control stops its network reading and local processing before Chrome begins the download. Dedicated discovery covers YouTube, Bilibili, Vimeo, Facebook, Instagram, OK, VK Video, Canva, iQIYI, TwitCasting, Osmosis, Kick, Chaturbate, and compatible wrapped HLS players. Bilibili formats can be found from embedded playback data or the public video API without requiring the player to start. Detection remains limited to the active tab session and follows same-site navigation until you stop it or leave the website.

### Satellites

Satellites contains optional tools that perform small background tasks without needing controls in the popup.

#### Bili Daily Login

Background: Bilibili gives every signed-in account one coin when it visits each day. Receiving that coin otherwise depends on remembering to return every day. Bili Daily Login handles the recurring visit at 00:05 China Standard Time while Chrome is available, allowing the daily coin to be credited automatically.

## Features

- Independent controls and website rules for Native Scroll, No Autoplay, and Any Copy
- On-demand image discovery with original-source recommendations, filtering, local conversion, area capture, and batch ZIP downloads
- On-demand video detection with direct files, HLS, DASH, local audio-video remuxing, subtitles, and service-specific discovery
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
- Image Download is enabled for the current tab by clicking its product icon. Its workspace opens in the Side Panel by default, while Settings can use a separate tab instead. It remains active through same-site navigation until you stop it, close the source tab, or leave the website.
- Video Download is enabled for the current tab by clicking its product icon. Its media list opens immediately, remains available through same-site navigation, and closes when you stop it, close the tab, or leave the website.
- Satellites are managed only from the rightmost settings icon. Bili Daily Login is off by default. After you enable it, the task runs on its own schedule while Chrome and the computer are running. After any length of downtime, one current-day task catches up when Chrome can next run; earlier missed days are never replayed.
- When Any Copy enters Enhanced mode directly from off, leaving Enhanced mode turns Any Copy off. If standard Any Copy was already enabled, leaving Enhanced mode returns to standard behavior.

Native Scroll and No Autoplay icons are neutral when unavailable or off, blue while enabled, green after the feature intervenes on the current page, and dimmed when the current website matches a whitelist rule. The product icon, power control, and Enhanced control share the same neutral opacity in that state. A matching whitelist control uses a green icon, and the product does not start on that website. Any Copy has no blue state: it turns green while enabled for the current website. Image Download and Video Download are neutral while off, blue while scanning, and green after compatible results are found. The main Cosmic Gemini mark in the popup remains unchanged.

### Website rules

`example.com` matches that hostname only. `*.example.com` matches the root domain and all of its subdomains. Popup actions save the exact current hostname; Settings also accepts wildcard rules. If several rules match, the exact rule takes priority, followed by the most specific wildcard. Clicking an active Whitelist or Enhanced control removes the matched rule directly; only a Settings control opens Settings. A whitelist rule takes priority over an Enhanced-site rule for Native Scroll and No Autoplay. On the No Autoplay whitelist, video, audio, and Web Audio may start automatically.

### Audio autoplay

Audio autoplay is blocked by default without interrupting you with a page prompt. In No Autoplay settings, you can allow audio elements and Web Audio on all sites or add hostname rules for selected websites. These permissions do not allow autoplaying video.

## Privacy

Native Scroll, No Autoplay, Any Copy, Image Download, and Video Download run locally. Cosmic Gemini stores only product settings, website rules you choose, the No Autoplay audio autoplay setting, and the Bili Daily Login completion date. Image Download and Video Download keep detected source addresses only in `chrome.storage.session` for the active tab and delete them when that session ends. Cosmic Gemini does not keep browsing history or an activity log or use analytics. Bili Daily Login does not inspect whether or when you open Bilibili. When enabled, its background schedule contacts Bilibili while Chrome and the computer are running, using the account already signed in to Chrome; it never reads or stores your Bilibili password. Stored website rules contain hostnames rather than complete URLs.

## Compatibility

Cosmic Gemini targets Chrome 120 or later on macOS, Windows, and Linux. Chrome prevents extensions from running on internal pages such as `chrome://`, the Chrome Web Store, and some built-in viewers. Image Download and Video Download can access compatible sources available to the current browser session. Video Download does not decrypt DRM, use private third-party rule services, or reproduce another extension’s licensing and paid-feature checks.

## Development

Cosmic Gemini uses Manifest V3 and bundles its local media-processing dependencies with the extension. See [Technical design](docs/TECHNICAL.md) for the architecture and [Verification](docs/QA.md) for focused checks.

```sh
npm test
npm run check
```

© 2026 Songming.org
