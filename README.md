<p align="center">
  <img src="extension/icons/icon-128.png" width="112" height="112" alt="Cosmic Gemini logo">
</p>

<h1 align="center">Cosmic Gemini</h1>

<p align="center"><a href="README_zh.md">Simplified Chinese</a></p>

Cosmic Gemini is a personal Chrome toolkit for a calmer, more controllable web. It combines Native Scroll, No Autoplay, Any Copy, Image Download, Video Download, and a collection of smaller tools called Satellites.

## Products

### Native Scroll

Native Scroll intercepts page code that takes over wheel or trackpad gestures while preserving ordinary controls and scrollable areas. Enhanced mode handles selected websites that repeatedly restore custom scrolling or simulate page movement.

Background: Some websites replace the browser’s native scrolling with scripted motion, changing the familiar feel of a trackpad and making navigation less predictable. Native Scroll restores a consistent, browser-controlled scrolling experience.

### No Autoplay

No Autoplay stops video and audio that starts without your action. Media you intentionally play remains available. Audio autoplay stays blocked unless you allow it for all sites or through a matching website rule. Enhanced mode removes media elements on selected websites.

Background: Pages can begin playing video or sound before you ask, interrupting reading and competing with audio already in use. No Autoplay keeps media quiet until you choose to start it.

### Any Copy

Any Copy restores text selection and copy shortcuts on websites that disable them. It also prevents pages from replacing copied text or adding unwanted promotional content.

Any Copy Enhanced is an independently controlled reading mode for the current tab. It rebuilds the page as a clean, static view with selectable text and unobstructed images. The original page remains available underneath and returns immediately when Any Copy Enhanced ends.

Background: Some websites disable selection, block copy shortcuts, or rewrite clipboard content with unwanted additions. Any Copy brings ordinary selection and copying back under your control.

### Image Download

Image Download finds images in the current tab and opens a dedicated workspace in Chrome’s Side Panel by default. The source page stays visible while you preview, filter, select, and download images. You can choose a separate tab in Settings or open the full-page workspace from the Side Panel.

Discovery covers responsive and lazy-loaded sources, linked originals, CSS images, open shadow roots, frames, inline SVG, canvas captures, structured metadata, and images observed during the active session. Related variants stay together, and the strongest original candidate is recommended by default.

You can rescan the page, reveal lazy-loaded images, capture part of the visible page, preserve original formats, or convert compatible images locally. Selected images can be downloaded separately or combined in one ZIP file.

### Video Download

Video Download finds downloadable media in the current tab and opens its format list immediately. A page thumbnail and title identify the current video. The quality menu keeps one preferred option for each main resolution and offers Audio only when a compatible track is available.

Codec, container, duration, and known file-size details remain visible for the selected option without crowding the menu or pre-downloading media for metadata. Direct files, HLS, DASH, separate video and audio tracks, subtitles, and live snapshots are supported. Stream assembly and remuxing begin locally only after you select a download.

While a file is being prepared, the red cancel control stops its network reading and local processing before Chrome begins the download.

Dedicated discovery covers YouTube, Bilibili, Vimeo, Facebook, Instagram, OK, VK Video, Canva, iQIYI, TwitCasting, Osmosis, Kick, Chaturbate, and compatible wrapped HLS players. Bilibili formats can be found from embedded playback data or the public video API without requiring the player to start.

Detection remains limited to the active tab session. It follows same-site navigation until you stop it or leave the website.

### Satellites

Satellites contains optional tools that perform small background tasks without needing controls in the popup.

#### Bili Daily Login

Bilibili gives every signed-in account one coin when it visits each day. Receiving that coin otherwise depends on remembering to return every day. Bili Daily Login handles the recurring visit at 00:05 China Standard Time while Chrome is available, allowing the daily coin to be credited automatically.

## Features

- Global defaults and independent current-site overrides for Native Scroll and No Autoplay, including Standard and Enhanced modes
- Website activation for Any Copy and a current-tab session for Any Copy Enhanced
- On-demand image discovery with original-source recommendations, filtering, local conversion, area capture, and batch ZIP downloads
- On-demand video detection with direct files, HLS, DASH, local audio-video remuxing, subtitles, and service-specific discovery
- Optional Satellites with their own concise settings and privacy details
- Exact-host and wildcard rules such as `example.com` and `*.example.com`
- A compact four-row popup with paired current-page controls and All Settings on its own bottom row
- Separate settings pages, an All Settings hub with a complete reset action, direct product switching, and stable first-frame localization
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

The popup uses four compact rows, with two related controls in each row.

### Popup controls

- The first row contains **Native Scroll** and **Native Scroll Enhanced**.
- The second row contains **No Autoplay** and **No Autoplay Enhanced**.
- The third row contains **Any Copy** and **Any Copy Enhanced**.
- The fourth row contains **Image Download** and **Video Download**.

Native Scroll and No Autoplay controls change only the current website. A current-site setting may enable a product while its global default is off, or disable it while the global default is on. Turning an active Enhanced control off returns that website to Standard mode.

Any Copy is enabled for the current website and stores the corresponding hostname rule. Any Copy Enhanced applies only to the current tab and ends when you turn it off or close the tab. They may run together, and turning either one off does not change the other.

### Download sessions

Click Image Download to start finding images in the current tab. Its workspace opens in the Side Panel by default, although Settings can use a separate tab instead. The session remains active through same-site navigation until you stop it, close the source tab, or leave the website.

Click Video Download to start finding video in the current tab and open its media list. The session remains active through same-site navigation until you stop it, close the tab, or leave the website.

Discovery stays active while a download workspace is visible and for two minutes after it closes. It then pauses without discarding the results. When every download session has paused, Cosmic Gemini also releases its shared browser-response listener. Reopening either workspace restores observation before discovery resumes and immediately checks the current page again.

### Settings and scheduled tools

**All Settings** occupies its own bottom row and aligns to the right. The Cosmic Gemini wordmark is hidden in this compact main view. All Settings opens the product directory and the command for restoring all settings and website rules to their defaults.

All Settings links to Native Scroll, No Autoplay, Any Copy, Image Download, Video Download, and Satellites. Bili Daily Login is off by default. After you enable it, the task runs on its own schedule while Chrome and the computer are running.

After any length of downtime, one current-day task catches up when Chrome can next run. Earlier missed days are never replayed.

Cosmic Gemini routes every product and settings command through one central entry, then delegates it through the responsible product group to an independent product implementation. The page entry contains no product behavior; each page runtime starts only after its product is active. All Settings has no webpage runtime of its own and uses the same command path.

Native Scroll and No Autoplay settings begin with a global default. Website settings then assign each product-specific rule to Always inactive, Always use Standard mode, or Always use Enhanced mode.

Both pages also show the same shared whitelist. On a matching website, neither product intercepts, observes, styles, pauses, or removes page content unless you explicitly start another click-activated tool. No Autoplay keeps audio autoplay permissions in a separate section.

Popup product controls use only neutral and blue icon states. Primary products, including Any Copy Enhanced, use a stronger neutral color than the secondary mode controls for Native Scroll and No Autoplay.

Blue means that the product is available to work in the current tab. A blue control with a background is active and may continue changing or displaying page behavior. Image Download and Video Download use blue without a background while their current-tab sessions are active.

After Native Scroll or No Autoplay intervenes on the page, a thin blue outline appears around the active Standard or Enhanced control.

The Cosmic Gemini mark in the browser toolbar remains unchanged. Its existing green artwork remains available for the separate toolbar activity indicator.

### Website rules

`example.com` matches that hostname only. `*.example.com` matches the root domain and all of its subdomains. Popup actions save exact current-site overrides, while Settings also accepts wildcard rules.

Native Scroll and No Autoplay each have a global default plus three website behaviors: Always inactive, Always use Standard mode, and Always use Enhanced mode. A website without a matching rule follows the global default. Standard and Enhanced rules keep their matching websites active even when that default is off.

The shared whitelist takes priority over those product-specific rules and keeps both products inactive. Removing a website from the shared whitelist restores its previously saved Native Scroll and No Autoplay behavior.

An exact rule takes priority over a wildcard, followed by the most specific wildcard. Each saved rule belongs to one behavior, and its behavior can be changed directly in Settings. This makes it possible to place a narrow exception inside a broader rule without maintaining overlapping lists.

The popup's primary control creates an exact current-site behavior or returns an existing exact rule to the broader setting. The Enhanced control enables the current site when necessary and switches it between Enhanced and Standard mode.

Any Copy keeps its own website activation list. Any Copy Enhanced uses no website rules and keeps only a current-tab session state. On a website where No Autoplay is disabled, video, audio, and Web Audio may autoplay.

### Audio autoplay

Audio autoplay is blocked by default without interrupting you with a page prompt. In No Autoplay settings, you can allow audio elements and Web Audio on all sites or add hostname rules for selected websites. These permissions do not allow autoplaying video.

## Privacy

Native Scroll, No Autoplay, Any Copy, Any Copy Enhanced, Image Download, and Video Download run locally. Cosmic Gemini stores only product settings, website rules you choose, the No Autoplay audio autoplay setting, and the Bili Daily Login completion date. Stored website rules contain hostnames rather than complete URLs. Any Copy Enhanced keeps its current-tab state only in browser session storage.

Image Download and Video Download keep detected source addresses only in `chrome.storage.session` for the active tab. Those addresses are deleted when the session ends.

Cosmic Gemini does not keep browsing history or an activity log or use analytics. Bili Daily Login does not inspect whether or when you open Bilibili.

When Bili Daily Login is enabled, its background schedule contacts Bilibili while Chrome and the computer are running. It uses the account already signed in to Chrome and never reads or stores your Bilibili password.

## Compatibility

Cosmic Gemini targets Chrome 120 or later on macOS, Windows, and Linux. Chrome prevents extensions from running on internal pages such as `chrome://`, the Chrome Web Store, and some built-in viewers.

Image Download and Video Download can access compatible sources available to the current browser session. Video Download does not decrypt DRM, use private third-party rule services, or reproduce another extension’s licensing and paid-feature checks.

## Development

Cosmic Gemini uses Manifest V3 and bundles its local media-processing dependencies with the extension. See [Technical design](docs/TECHNICAL.md) for the architecture and [Verification](docs/QA.md) for focused checks.

```sh
npm test
npm run check
```
