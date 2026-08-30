# Technical design

Cosmic Gemini is a Manifest V3 Chrome extension with feature-isolated products: Native Scroll, No Autoplay, Any Copy, Image Download, Video Download, and Satellites. Each product owns its configuration and runtime state. Shared code covers the extension shell, localization, hostname-rule parsing, service-worker lifecycle, and toolbar rendering.

## Page startup

Main-world runtimes load at `document_start` on HTTP and HTTPS pages. Native Scroll patches gesture-listener registration, No Autoplay patches media playback and Web Audio resume, and Any Copy installs capture-phase selection and clipboard handling before ordinary website scripts.

Isolated-world bridges retrieve only the current page state from the service worker and pass it to main-world runtimes through token-bound events. Stored rule collections and extension APIs are not exposed to page code. Any Copy uses a separate all-frame bridge so restrictions inside same-origin and cross-origin frames can be handled without coupling its lifecycle to the other products.

Settings pages contain their complete first-frame structure. A synchronous locale preloader applies the cached Chrome UI locale before the page becomes visible; asynchronous storage then confirms that selection without rebuilding the initial view.

## Native Scroll

Standard protection prevents matching page-level wheel and touch events from reaching website handlers without cancelling the browser's native default action. It preserves pinch zoom, horizontal gestures, interactive controls, maps, editors, media controls, and ordinary nested scroll areas.

Enhanced protection also handles scripted nested movement and narrowly detected full-page transformed wrappers. Inline style changes are recorded and restored when protection becomes inactive or the page is whitelisted. Listener records use weak references, and DOM observation is limited to structural roots.

## No Autoplay

Standard protection blocks `HTMLMediaElement.play()` and captured playback events unless playback follows direct user activation. A short trusted-input window also recognizes custom page controls that call `play()` after their own pointer or keyboard handler. Audio elements and Web Audio may run when the all-sites audio setting is enabled or the hostname matches a saved audio autoplay rule. Audio autoplay permission does not allow autoplaying video.

Audio autoplay is denied silently by default. A matching No Autoplay whitelist rule deactivates all media interception and permits video, audio, and Web Audio autoplay. Enhanced protection removes video and audio elements, including matching nodes inserted later. Its subtree observer exists only while Enhanced mode is active.

No Autoplay operates only on media elements and audio contexts inside the current webpage. The extension declares no `commands` or `nativeMessaging` permission and does not use Media Session action handlers, operating-system media keys, AppleScript, or system audio APIs. Releasing blocked webpage media can call that page element's original `play()` or audio context `resume()` method, but it cannot issue a play or pause command to a separate desktop music application.

## Any Copy

Any Copy is enabled per hostname. The main-world runtime restores text selection, prevents page handlers from intercepting copy shortcuts, and writes the user's original selection to `text/plain`. When a reliable selection fragment is available, it also writes sanitized `text/html`. DOM observation starts only after a page restriction is detected.

Enhanced mode creates a closed-Shadow-DOM reading layer over the original page. It builds a new tree from readable page content and never executes copied page markup. Scripts, forms, frames, media, navigation, overlays, and common advertising containers are omitted. Text structure, tables, links, code, figures, captions, and images are preserved. Removing the Enhanced rule destroys the reading layer and restores the original page without reloading.

The Standard mode and Enhanced mode rule lists remain independent. An Enhanced mode rule can enable Any Copy by itself. Removing that rule therefore turns the feature off unless a Standard mode site rule still matches.

## Image Download

Image Download is activated for one source tab from the popup. While the popup loads, the worker prepares a tab-specific `chrome.sidePanel` path before the product control becomes available. The user action therefore opens an already-configured panel instead of racing panel configuration against `chrome.sidePanel.open()`. A transient Side Panel error remains an error and never opens or focuses another tab. A normal extension tab is used only when selected in Settings or requested from the Side Panel. The same workspace document supports both surfaces, with a synchronous view preloader selecting the narrow Side Panel layout before CSS renders.

Its isolated scanner inspects ordinary and responsive images, lazy-load attributes, links to image files, computed CSS and pseudo-element images, open shadow roots, frames, inline SVG, canvas content, image metadata, JSON-LD, and existing Resource Timing entries. A browser-level response listener adds image resources that load while the session is active.

Candidates are normalized, deduplicated, and grouped into related families. Recommendation scoring favors explicit original links and attributes, high-resolution responsive sources, known deterministic original-image URL forms, larger verified dimensions, and useful response metadata. Alternate sizes and formats remain selectable in the same family. A normal rescan reads the current page state. Deep scan is available only after an explicit user action, briefly advances through the page to reveal lazy-loaded images, and restores the original scroll position.

The workspace filters by search text, format, layout, and minimum dimensions. It can select visible results, download one image or a batch, capture a user-selected part of the visible page, preserve original formats, or convert compatible images locally to JPEG, PNG, or WebP. Multiple selections can be sent to Chrome separately or placed in a locally generated ZIP file. Fetching, conversion, capture cropping, and ZIP creation share the offscreen processor with Video Download. Temporary artifacts use the Origin Private File System and are removed after Chrome completes or interrupts the download.

Candidate addresses and page details live only in `chrome.storage.session` for the active source tab. The session also records its current workspace surface and optional full-page tab ID so capture actions can return to the correct view. Same-origin navigation clears old candidates and starts a new scan. Cross-origin navigation, source-tab closure, or explicit stop removes the session and captured artifacts and disables that source tab’s Side Panel configuration.

## Video Download

Video Download is activated for one tab at a time from the popup. Main-world and isolated-world scanners are injected only after activation. Together they inspect media elements, page metadata, embedded frames, mutation changes, player state, fetch and XHR responses, inline streaming manifests, and buffered Resource Timing entries. A non-blocking `webRequest.onHeadersReceived` listener supplies the browser-level path: after a constant-time active-tab check, it recognizes video responses and HLS or DASH manifests by URL and response MIME type. This remains effective when a page hides its player markup, moves media into a frame, embeds a manifest in script state, or repeatedly replaces its DOM.

Candidate URLs and transient download state live in `chrome.storage.session` under the tab ID. Same-origin navigation clears stale candidates and reinjects the scanner. A different origin, tab closure, or an explicit stop removes the session. Signed URLs are retained without rewriting while the session is active, but are never copied into persistent settings or history.

Before a selected source is fetched, the worker installs temporary session rules for its media directories so restricted request headers such as the active-page `Referer` reach authenticated and referrer-sensitive servers. The rules apply only while the selected media is being prepared and are removed afterward. Direct files are streamed through an offscreen document. Compatible HLS playlists are parsed locally, including master variants, alternate audio, initialization maps, byte ranges, standard AES-128 keys, live snapshots, and supported wrapped playlist formats. DASH supports BaseURL, SegmentList, SegmentTemplate, SegmentTimeline, byte ranges, separate audio and video representations, and common protection markers.

Separated HLS, DASH, Bilibili, and YouTube tracks are remuxed locally with the bundled Mediabunny build. MP4-compatible tracks produce MP4 output; WebM-family combinations use MKV. Remote separated tracks are streamed to temporary OPFS files and validated before remuxing, so a CDN does not need to support random-access Range responses and the complete sources do not occupy memory. The popup shows page metadata for source confirmation and groups equivalent codec or internal-track candidates into one preferred choice per main quality. Technical details remain in the selected-result summary, and compatible standalone Bilibili or YouTube audio tracks appear as Audio only. Live polling compares render signatures and never replaces a focused quality control. YouTube discovery uses the bundled YouTube.js browser build for local player-response parsing and signature transformation. Bilibili discovery reads inline `__playinfo__` even after the page removes its global reference. When that data is absent, it resolves the current part through Bilibili's public video information endpoint before using WBI-signed or international playback data. This path does not start the player and therefore remains available while No Autoplay is active. Primary and alternate Bilibili CDN addresses remain attached to each video and audio track so local preparation can retry an unavailable route. Dedicated page adapters cover the service-specific sources represented by Vimeo, Facebook and Instagram inline DASH, OK, VK Video, Canva, iQIYI, TwitCasting, Osmosis, Kick, Chaturbate, and wrapped xgplayer HLS.

Temporary artifacts are written to the Origin Private File System instead of holding completed media in memory. Their random internal identifiers never become user-facing filenames: the worker supplies the title shown in the media card to Chrome Downloads and confirms it during filename determination. Each preparation carries one request ID through the popup, worker, network readers, playlist assembly, and remuxing pipeline. The red cancel control aborts the active readers, stops local packet processing, removes partial OPFS artifacts, rejects stale progress from that request, and returns the candidate to its ready state before Chrome Downloads receives a file. Completed artifacts are removed after Chrome completes or interrupts the download. DRM decryption, private third-party rule services, and third-party authorization or paid-feature checks are outside the implementation.

## Satellites

Satellites contains opt-in tools that do not require popup controls. Each Satellite owns one settings card containing its control, description, and privacy details.

Bili Daily Login is disabled by default and has no Bilibili content script, tab listener, URL inspection, or browsing trigger. A service-worker alarm schedules the task for 00:05 China Standard Time and uses the same UTC+8 boundary for its completion date. Chrome alarms do not wake a sleeping computer or run after Chrome exits; after a missed run, Chrome schedules one task for the current day and never replays earlier dates. An in-memory single-flight guard merges simultaneous startup and restored-alarm triggers. Before any network request, the worker skips the attempt when `navigator.onLine` explicitly reports offline. An online result is treated only as permission to try because it does not guarantee internet reachability. The service worker then requests Bilibili's account navigation and daily reward endpoints with the existing signed-in Chrome session and records the completed date after verification. Failed work may run at most three times that day; its retry counter is session-only.

## State and lifecycle

`chrome.storage.local` stores one versioned settings object:

- Native Scroll: enabled state, whitelist rules, and Enhanced-site rules
- No Autoplay: enabled state, whitelist rules, Enhanced-site rules, an all-sites audio autoplay setting, and hostname-specific audio autoplay rules
- Any Copy: Standard mode site rules and Enhanced mode site rules
- Image Download: workspace location, default output format, batch-download behavior, and save-location preference
- Video Download: preferred quality and whether Chrome should ask for a save location
- Satellites: Bili Daily Login switch state and last completed date
- Interface locale

Exact and wildcard rules contain hostnames only. Paths, ports, queries, and complete URLs are rejected. Matching prefers an exact rule, then the most specific wildcard. Native Scroll and No Autoplay whitelist matches take priority over Enhanced-site matches. Active Whitelist and Enhanced popup controls remove their currently matched rule directly, including a wildcard rule. Popup navigation to Settings is exclusive to Settings controls.

Per-tab intervention state contains product booleans and is cleared on navigation or tab closure. Image Download and Video Download session storage additionally contains the current origin and detected candidate addresses only while that tab session is active.

## Resource use

The runtimes are event-driven. There is no analytics code or persistent background page. Observers are feature-scoped and activated only when required: after Any Copy detects a restriction, during an Any Copy reading view, while No Autoplay Enhanced mode removes newly inserted media, or during an explicitly activated Video Download tab session. Image Download scanning runs only for an explicitly activated source tab, and its workspace polls only while open. The popup polls Video Download state only while its result view is open. Image or media fetching, processing, and the offscreen document start only after a download or capture action. Bili Daily Login contacts Bilibili only from its own alarm while Chrome and the computer are running.

## Browser boundaries

Chrome does not allow content scripts on internal pages such as `chrome://`, the Chrome Web Store, or some built-in viewers. Cosmic Gemini remains inactive there. Image Download can retrieve only image sources available to the current browser session. Video Download does not decrypt DRM systems or circumvent access controls. A source may stop working when its public page or playback API changes, in which case its local adapter must be updated.
