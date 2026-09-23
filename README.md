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

Discovery covers responsive and lazy-loaded sources, linked originals, CSS images, open shadow roots, frames, inline SVG, canvas captures, structured metadata, and images observed during the active session. Related variants stay together, and the strongest original candidate is selected by default.

You can rescan the page, reveal lazy-loaded images, capture part of the visible page, preserve original formats, or convert compatible images locally. Selected images can be downloaded separately or combined in one ZIP file.

### Video Download

Video Download finds downloadable media in the current tab and opens its format list immediately. A page thumbnail and title identify the current video. The quality menu keeps one preferred option for each main resolution and offers Audio only when a compatible track is available.

Codec, container, duration, and known file-size details remain visible for the selected option without crowding the menu or pre-downloading media for metadata. Direct files, HLS, DASH, separate video and audio tracks, subtitles, and live snapshots are supported. Stream assembly and remuxing begin locally only after you select a download.

While a file is being prepared, the red cancel control stops its network reading and local processing before Chrome begins the download.

Dedicated discovery covers YouTube, Bilibili, Vimeo, Facebook, Instagram, OK, VK Video, Canva, iQIYI, TwitCasting, Osmosis, Kick, Chaturbate, and compatible wrapped HLS players. Bilibili formats can be found from embedded playback data or the public video API without requiring the player to start.

Detection remains limited to the active tab session. It follows same-site navigation until you stop it or leave the website.

On X / Twitter, enabling Video Download adds a download arrow to videos on the page. Click an arrow to open the media menu for that video. On a post’s detail page, the menu initially lists all videos belonging to that post, without mixing in replies or other posts. Thumbnails, available qualities, and durations appear when provided by the source.

Quality options include the file size when it is known before downloading. For direct files, Video Download can check response headers without downloading the media. Streams whose final size is not available leave that value blank.

### Page Display

Adjust webpage colors without changing their content, layout, or controls. Page Display includes independent Reduce White Point and Greyscale features: use the first to reduce the intensity of bright colors at your chosen strength, and the second to render the page in shades of grey. Both cover the complete rendered page, including images, animations, Canvas, embedded content, and video.

Page Display has one master switch. Turning it off restores affected pages and makes its child settings unavailable without discarding their saved selections.

### Satellites – General features

Satellites contains optional tools that do not need permanent rows in the popup.

#### Mailto Capture

Stop mailto links from opening your system mail app before you can inspect them. Mailto Capture intercepts each link and shows its recipients, CC and BCC addresses, subject, message, and other included fields in a compact page popover for copying. It also supports external protocol links using `tel:` and `sms:`, formats recognized international telephone numbers for their numbering plan, and identifies their country or region. NANP locations remain in English; other international locations follow the interface language. Chinese fixed-line numbers additionally show the recognized area-code location, while mobile numbers remain at country level. Mexican numbers show their official one-digit directional zone.

#### Clipboard Protect

Keep selected text free of content a website adds during copying, such as links, credits, and promotional messages. Clipboard Protect preserves the selected text and available formatting, with no clipboard reading, logging, or uploads. It is off by default and has one independent switch in Satellites. Editable areas, including rich-text editors and spreadsheet grids, keep their own copy handling. Normal copy buttons with no selected text also keep their existing behavior. When Any Copy is active on the current page, it takes priority and Clipboard Protect remains inactive there.

#### Access Control

Block visits to selected domains, every level of their subdomains, and exact IPv4 or IPv6 addresses. Access Control is off by default and uses one master switch. Entering a plain domain such as `example.com` covers both that domain and all of its subdomains; an IP entry covers that exact address on every port. Rule changes take effect when a matching page is reloaded or opened again. An optional one-time-visit setting is also off by default. When selected and the current page is blocked, a contextual popup button can allow that visit in the current tab without changing the saved rule; the exception ends after the tab leaves the blocked domain or closes.

#### Website Knowledge Control

Control the language and regional format, time zone, and privacy preference sent to websites. Website Knowledge Control is off by default. Enable its master switch, then select the categories to adjust. Language and regional formats is one combined choice that applies to requests, browser language information, and default Intl formatting; it defaults to `en-US`. The optional time-zone setting defaults to New York and follows daylight saving time. Global Privacy Control is selected by default and asks websites not to sell or share your personal data.

Unselected categories keep their original values. These adjustments do not change your system settings. Each page keeps the browser information it received when it loaded, so changed or disabled settings take effect when that page next loads.

#### Document Preview

Preview documents, spreadsheets, slides and email messages in the browser before saving them. This default-off feature offers **Preview** and **Download** for supported downloads before Chrome asks for a save location. The dialog shows the filename and any size Chrome already knows. Document bytes are fetched, validated and cached only after you choose an action; dismissing an accidental prompt creates no document cache. A remembered action applies to all supported formats for the current website session. The contextual Document Preview button in the extension popup restores asking each time.

A website whitelist skips the preview prompt and keeps normal downloads on matching source pages. Every entered domain includes all of its subdomains; existing preview pages remain available.

Supported formats: documents `.docx/.docm/.dotx/.dotm/.doc/.rtf/.odt`; spreadsheets `.xlsx/.xlsm/.xltx/.xltm/.xls/.ods`; slides `.pptx/.pptm/.potx/.potm/.ppsx/.ppsm/.ppt/.odp`; PDF `.pdf`; other `.eml`. Settings also provides this list in a collapsed **Supported file formats** section.

Legacy Word, Excel and PowerPoint previews retain supported fonts, paragraph formatting, tables and slide text positions. Rich Text and OpenDocument previews also preserve common formatting. Email previews retain supported text and table styles while showing attachments as names only. Exact Word pagination and complex drawing effects are not reproduced. Password-protected files are not supported. A loading line appears while the file is being prepared, without percentage numbers.

Office previews preserve common text and table formatting, with worksheet and slide navigation where applicable. Word page breaks appear as separator lines. Zoom controls adjust Office content in 10% steps from 50% to 200%. Original fonts are preferred when available to the browser; otherwise, similar local fonts are used. Fonts are not downloaded. These are content previews, not full Office applications: complex layouts, charts, SmartArt, animations and embedded media may be omitted or differ. Spreadsheet formulas show saved results when available; they are never recalculated. PDF files open in Chrome’s built-in viewer, with its own zoom and download controls. The extension toolbar automatically hides while the PDF is displayed, leaving the full preview area to the native viewer. PDFs already open in that viewer retain their normal behavior.

For other documents, a single toolbar shows the filename in the center with the source website below it, alongside the reading controls. File size is omitted from the toolbar.

Choose **Auto**, **Light** or **Dark** in settings. For non-PDF documents, a sun/moon button switches the reading appearance for the current website session; **Default** restores the settings preference. PDF dark mode uses Dark Reader-style color inversion and contrast adjustment while retaining Chrome’s built-in viewer. This also changes PDF pictures, viewer controls and the background outside the pages. Non-PDF embedded pictures and all original files remain unchanged. Turning off Document Preview stops new captures while keeping existing previews available until their session expires.

Non-PDF files are converted locally in a separate worker and displayed in a script-free sandbox with remote content blocked. Macro-enabled files expose static content only: macros, ActiveX controls and embedded programs do not run. PDF rendering relies on Chrome’s native viewer and browser sandbox. These measures reduce risk, but do not certify a file as safe; downloading keeps the original file, including any macros it contains.

Document caches live only in browser memory and are not uploaded to a conversion service. A cached file is cleared **30 minutes after its last preview closes**, when the source website’s last tab closes or leaves, or when Chrome exits, whichever comes first. Reopening before expiry cancels the countdown while a preview remains open. Website choices and appearance overrides last for that website session across formats and subdomains, using eTLD+1; ordinary and incognito sessions are separate. Unsupported or uncorrelated downloads keep Chrome’s normal handling. A supported file that cannot be rendered can still be downloaded in its original form.

#### Ad Marshal

Stop persistent advertising, reporting, and tracking components from repeatedly reconnecting on managed sites. Ad Marshal uses lightweight, site-specific rules to neutralize known loaders and request loops at the source, return local success responses to matching telemetry calls, and hide related advertising containers.

Each supported site has its own narrowly scoped policy. These policies target only confirmed advertising and telemetry components without interfering with ordinary page content, sign-in, or account security.

The current managed-site choices cover Tencent News and Zhihu.

### Satellites – Site-specific features

#### XHS Image Dark Mode

Make bright text images easier to view when a page-wide dark mode is active on Xiaohongshu.

The feature analyzes reduced image samples, switches light text cards to dark, deepens uniform gray cards to a black background, and recognizes text layouts built from stable light and dark panels. Text cards with colored frames are supported, while photographs and mixed photo-and-text images remain unchanged.

Comment images are considered only after their post is opened and are processed near the viewport. Opening a comment image provides a separate light-or-dark control.

In an expanded post, press and hold the post image button to alternate the complete post between forced dark and forced light display; click it to restore automatic recognition. On a user profile, a separate control can pause analysis and adjustment for every post on that profile.

This is an experimental feature.

#### Bili Daily Login

Bilibili gives every signed-in account one coin for completing its daily login. Receiving that coin otherwise depends on remembering to check in every day. Bili Daily Login handles the recurring check-in in the background while Chrome is available, allowing the daily coin to be credited automatically.

#### Chinese Response Display Optimization for Claude

Claude can render Chinese replies with half-width punctuation and omit spaces around embedded Latin text, numbers, or related symbols. Chinese Response Display Optimization for Claude replaces those displayed marks and adds consistent spaces at these boundaries. Code, links, formulas, and editable text remain unchanged; only the text displayed in your browser is adjusted. An independently controlled option also keeps selected browser identity signals consistent for Claude use in the United States.

#### Following/Follower List Check for Instagram

Compare a profile’s following and follower lists to see accounts that have not followed back, mutual follows, and followers the profile does not follow. Open an Instagram profile and select **IG±** in the popup to start reading its lists in a side panel. On your own signed-in profile, you can confirm and unfollow individual accounts that have not followed you back.

Each list shows its own progress once reading begins. Results show usernames with display names on a separate line, and can be searched by either. Reading continues when the side panel is closed. Reopen it to see progress or results, or choose **Stop** to end the check.

Instagram may require sign-in or limit list access; comparison appears only after both lists have been read completely. Results are compared locally and kept only in memory until you leave the profile or close its source tab.

#### Serch Result Language Designate for Google Search

Choose the languages of Google Search results with a `lang:` command in the search box. For example, `openai lang:zh` becomes a search for `openai` with `lr=lang_zh-CN`; `lang:en,ja` requests English or Japanese results. Video, image, and other search modes are preserved.

Commands are case-insensitive. `zh`, `zhs`, `zh-Hans`, and Simplified Chinese regional codes map to `lang_zh-CN`. `zht`, `zh-Hant`, and Traditional Chinese regional codes map to `lang_zh-TW`. Use commas to combine any supported languages; quoted text and unsupported commands remain unchanged. The feature is off by default and appears last in Satellites. URL processing is local, with no search-history storage or additional service.

## Features

- Global defaults and independent current-site overrides for Native Scroll and No Autoplay, including Standard and Enhanced modes
- Website activation for Any Copy and a current-tab session for Any Copy Enhanced
- On-demand image discovery with automatic original-source selection, filtering, local conversion, area capture, and batch ZIP downloads
- On-demand video detection with direct files, HLS, DASH, local audio-video remuxing, subtitles, and service-specific discovery
- Independent Page Display controls for white-point reduction and greyscale rendering
- Optional Satellites with their own concise settings and privacy details
- Adjustable white-point reduction that applies locally across ordinary webpages
- A contextual Xiaohongshu image reader that adapts bright text cards, including cards with colored frames, without changing ordinary photographs
- Exact-host, exact-IP, and wildcard domain rules such as `example.com`, `192.0.2.1`, and `*.example.com`
- A compact five-row popup with paired controls and All Settings on its own bottom row
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

The popup uses five compact rows, with two related controls in each row.

### Popup controls

- The first row contains **Native Scroll** and **Native Scroll Enhanced**.
- The second row contains **No Autoplay** and **No Autoplay Enhanced**.
- The third row contains **Any Copy** and **Any Copy Enhanced**.
- The fourth row contains **Image Download** and **Video Download**.
- The fifth row contains the global **Reduce White Point** and **Greyscale** switches.

Native Scroll and No Autoplay controls change only the current website. A current-site setting may enable a product while its global default is off, or disable it while the global default is on. Turning an active Enhanced control off returns that website to Standard mode.

Any Copy is enabled for the current website and stores the corresponding hostname or IP-address rule. Any Copy Enhanced applies only to the current tab and ends when you turn it off or close the tab. They may run together, and turning either one off does not change the other.

Reduce White Point and Greyscale are global controls. Enabling either one from the popup also enables the Page Display master switch when needed.

### Download sessions

Click Image Download to start finding images in the current tab. Its workspace opens in the Side Panel by default, although Settings can use a separate tab instead. The session remains active through same-site navigation until you stop it, close the source tab, or leave the website.

Click Video Download to start finding video in the current tab and open its media list. The session remains active through same-site navigation until you stop it, close the tab, or leave the website.

Discovery stays active while a download workspace is visible and for two minutes after it closes. It then pauses without discarding the results. When every download session has paused, Cosmic Gemini also releases its shared browser-response listener. Reopening either workspace restores observation before discovery resumes and immediately checks the current page again.

### Settings and scheduled tools

**All Settings** occupies its own bottom row and aligns to the right. The Cosmic Gemini wordmark is hidden in this compact main view. All Settings opens the product directory and the command for restoring all settings and website rules to their defaults.

All Settings links to Native Scroll, No Autoplay, Any Copy, Image Download, Video Download, Page Display, and Satellites. Mailto Capture is on by default in ordinary windows, while Clipboard Protect, Access Control, Website Knowledge Control, Page Display, both of its visual adjustments, XHS Image Dark Mode, Chinese Response Display Optimization for Claude, Bili Daily Login, and every Ad Marshal website are off by default. Ad Marshal lets each managed website group be selected independently.

On `www.xiaohongshu.com`, the popup adds a contextual XHS Image Dark Mode control below the fixed product rows. Its open-book-and-bulb icon remains blue without a background while waiting for page-wide dark mode, then fills the bulb and gains a blue background while image adaptation is running. Settings can keep image adjustment always on, hide the per-image theme controls shown only in expanded posts, or adjust their opacity.

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

`example.com` or an IP address matches that host only. `*.example.com` matches the root domain and all of its subdomains. Popup actions save exact current-site overrides, while Settings also accepts wildcard domain rules.

Native Scroll and No Autoplay each have a global default plus three website behaviors: Always inactive, Always use Standard mode, and Always use Enhanced mode. A website without a matching rule follows the global default. Standard and Enhanced rules keep their matching websites active even when that default is off.

The shared whitelist takes priority over those product-specific rules and keeps both products inactive. Removing a website from the shared whitelist restores its previously saved Native Scroll and No Autoplay behavior.

An exact rule takes priority over a wildcard, followed by the most specific wildcard. Each saved rule belongs to one behavior, and its behavior can be changed directly in Settings. This makes it possible to place a narrow exception inside a broader rule without maintaining overlapping lists.

The popup's primary control creates an exact current-site behavior or returns an existing exact rule to the broader setting. The Enhanced control enables the current site when necessary and switches it between Enhanced and Standard mode.

Any Copy keeps its own website activation list. Any Copy Enhanced uses no website rules and keeps only a current-tab session state. On a website where No Autoplay is disabled, video, audio, and Web Audio may autoplay.

### Audio autoplay

Audio autoplay is blocked by default without interrupting you with a page prompt. In No Autoplay settings, you can allow audio elements and Web Audio on all sites or add hostname or IP-address rules for selected websites. These permissions do not allow autoplaying video.

## Privacy

Native Scroll, No Autoplay, Any Copy, Any Copy Enhanced, Image Download, Video Download, Mailto Capture, Clipboard Protect, Access Control, Website Knowledge Control, Page Display, XHS Image Dark Mode, Chinese Response Display Optimization for Claude, and Ad Marshal run locally. Website rules contain hostnames or IP addresses rather than complete URLs. Any Copy Enhanced keeps its current-tab state only in browser session storage, while Bili Daily Login retains limited completion and schedule state to avoid duplicate checks.

Image Download and Video Download keep detected source addresses only in `chrome.storage.session` for the active tab. Those addresses are deleted when the session ends.

Cosmic Gemini does not keep browsing history or an activity log or use analytics. Mailto Capture does not store the email addresses, telephone numbers, or message fields it previews. Access Control applies local browser network rules without recording attempted visits. Page Display applies its local visual adjustments without reading or retaining page content. XHS Image Dark Mode analyzes reduced-resolution image samples on the device and keeps only a bounded in-memory result cache while the page is open. Chinese Response Display Optimization for Claude applies its reply-display and browser-identity consistency adjustments within the page without separately sending or retaining reply content or identity information. Bili Daily Login does not inspect whether or when you open Bilibili.

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
