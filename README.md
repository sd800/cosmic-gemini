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

Satellites contains optional tools that do not need permanent rows in the popup.

#### Mailto Capture

Stop mailto links from opening your system mail app before you can inspect them. Mailto Capture intercepts each link and shows its recipients, CC and BCC addresses, subject, message, and other included fields in a compact page popover for copying.

#### Page Display

Adjust webpage colors without changing their content, layout, or controls. Page Display includes independent Reduce White Point and Greyscale features: use the first to reduce the intensity of bright colors at your chosen strength, and the second to render the page in shades of grey. Both cover the complete rendered page, including images, animations, Canvas, embedded content, and video.

#### XHS Image Dark Mode

Make bright text images easier to view after Dark Reader applies page-wide dark mode to Xiaohongshu’s website. XHS Image Dark Mode analyzes a reduced sample from each image, switches light text cards to dark, deepens uniform gray cards to a black background, and recognizes text layouts built from stable light and dark panels. Text cards with colored frames are supported, while photographs and mixed photo-and-text images remain unchanged. After opening a post, you can switch each image between light and dark from the control beside its page count.

#### Bili Daily Login

Bilibili gives every signed-in account one coin for completing its daily login. Receiving that coin otherwise depends on remembering to check in every day. Bili Daily Login handles the recurring check-in in the background while Chrome is available, allowing the daily coin to be credited automatically.

#### Ad Marshal

Stop persistent advertising, reporting, and tracking components from repeatedly reconnecting on managed sites. Ad Marshal uses lightweight, site-specific rules to neutralize known loaders and request loops at the source, return local success responses to matching telemetry calls, and hide related advertising containers.

Each supported site has its own narrowly scoped policy. These policies target only confirmed advertising and telemetry components without interfering with ordinary page content, sign-in, or account security.

The current managed-site choices cover Tencent News and Zhihu.

## Features

- Global defaults and independent current-site overrides for Native Scroll and No Autoplay, including Standard and Enhanced modes
- Website activation for Any Copy and a current-tab session for Any Copy Enhanced
- On-demand image discovery with original-source recommendations, filtering, local conversion, area capture, and batch ZIP downloads
- On-demand video detection with direct files, HLS, DASH, local audio-video remuxing, subtitles, and service-specific discovery
- Optional Satellites with their own concise settings and privacy details
- Adjustable white-point reduction that applies locally across ordinary webpages
- A contextual Xiaohongshu image reader that adapts bright text cards, including cards with colored frames, without changing ordinary photographs
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

All Settings links to Native Scroll, No Autoplay, Any Copy, Image Download, Video Download, and Satellites. Mailto Capture is on by default in ordinary windows, while both Page Display features, XHS Image Dark Mode, Bili Daily Login, and every Ad Marshal website are off by default. Ad Marshal lets each managed website group be selected independently.

On `www.xiaohongshu.com`, the popup adds a contextual XHS Image Dark Mode control below the fixed product rows. The control remains blue without a background while waiting for page-wide dark mode, then gains a blue background while image adaptation is running. Settings can always apply image adjustments, hide the per-image theme controls shown only in expanded posts, or adjust their opacity.

After you enable Bili Daily Login, the task runs on its own schedule while Chrome and the computer are running.

After downtime, only the latest eligible current-day check can run. Earlier checks and prior dates are never replayed.

Incognito windows use a separate temporary configuration. Each new incognito session starts with every product inactive and does not inherit settings or website rules from ordinary windows. Choices made in incognito last only until the final incognito window closes, and Bili Daily Login remains unavailable there.

Cosmic Gemini routes every product and settings command through one central entry, then delegates it through the responsible product group to an independent product implementation. The page entry contains no product behavior; each page runtime starts only after its product is active. All Settings has no webpage runtime of its own and uses the same command path.

Native Scroll and No Autoplay settings begin with a global default. Website settings then assign each product-specific rule to Always inactive, Always use Standard mode, or Always use Enhanced mode.

Both pages also show the same shared whitelist. On a matching website, neither product intercepts, observes, styles, pauses, or removes page content unless you explicitly start another click-activated tool. No Autoplay keeps audio autoplay permissions in a separate section.

Popup product controls use only neutral and blue icon states. Primary products, including Any Copy Enhanced, use a stronger neutral color than the secondary mode controls for Native Scroll and No Autoplay.

Blue means that the product is available to work in the current tab. A blue control with a background is active and may continue changing or displaying page behavior. Image Download and Video Download use blue without a background while their current-tab sessions are active.

After Native Scroll or No Autoplay intervenes on the page, a thin blue outline appears around the active Standard or Enhanced control.

The Cosmic Gemini mark in the browser toolbar remains unchanged. Activity continues to appear in the popup controls and the toolbar title.

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

Native Scroll, No Autoplay, Any Copy, Any Copy Enhanced, Image Download, Video Download, Mailto Capture, Page Display, XHS Image Dark Mode, and Ad Marshal run locally. Website rules contain hostnames rather than complete URLs. Any Copy Enhanced keeps its current-tab state only in browser session storage, while Bili Daily Login retains limited completion and schedule state to avoid duplicate checks.

Image Download and Video Download keep detected source addresses only in `chrome.storage.session` for the active tab. Those addresses are deleted when the session ends.

Cosmic Gemini does not keep browsing history or an activity log or use analytics. Mailto Capture does not store the addresses or message fields it previews. Page Display applies its local visual adjustments without reading or retaining page content. XHS Image Dark Mode analyzes reduced-resolution image samples on the device and keeps only a bounded in-memory result cache while the page is open. Bili Daily Login does not inspect whether or when you open Bilibili.

When Bili Daily Login is enabled, its background schedule contacts only Bilibili account services while Chrome and the computer are running. It uses the account already signed in to Chrome and never reads or stores your Bilibili password.

## Compatibility

Cosmic Gemini targets Chrome 120 or later on macOS, Windows, and Linux. Chrome prevents extensions from running on internal pages such as `chrome://`, the Chrome Web Store, and some built-in viewers.

Image Download and Video Download can access compatible sources available to the current browser session. Video Download does not decrypt DRM, use private third-party rule services, or reproduce another extension’s licensing and paid-feature checks.

## Development

Cosmic Gemini uses Manifest V3 and bundles its local media-processing dependencies with the extension. See [Technical design](docs/TECHNICAL.md) for the architecture and [Verification](docs/QA.md) for focused checks.

```sh
npm test
npm run check
```
