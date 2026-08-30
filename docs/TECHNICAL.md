# Technical design

Cosmic Gemini is a Manifest V3 Chrome extension with feature-isolated products: Native Scroll, No Autoplay, Any Copy, Video Download, and Satellites. Each product owns its configuration and runtime state. Shared code covers the extension shell, localization, hostname-rule parsing, service-worker lifecycle, and toolbar rendering.

## Page startup

Main-world runtimes load at `document_start` on HTTP and HTTPS pages. Native Scroll patches gesture-listener registration, No Autoplay patches media playback and Web Audio resume, and Any Copy installs capture-phase selection and clipboard handling before ordinary website scripts.

Isolated-world bridges retrieve only the current page state from the service worker and pass it to main-world runtimes through token-bound events. Stored rule collections and extension APIs are not exposed to page code. The shared bridge renders the No Autoplay sound prompt in a closed Shadow DOM. Any Copy uses a separate all-frame bridge so restrictions inside same-origin and cross-origin frames can be handled without coupling its lifecycle to the other products.

Settings pages contain their complete first-frame structure. A synchronous locale preloader applies the cached Chrome UI locale before the page becomes visible; asynchronous storage then confirms that selection without rebuilding the initial view.

## Native Scroll

Standard protection prevents matching page-level wheel and touch events from reaching website handlers without cancelling the browser's native default action. It preserves pinch zoom, horizontal gestures, interactive controls, maps, editors, media controls, and ordinary nested scroll areas.

Enhanced protection also handles scripted nested movement and narrowly detected full-page transformed wrappers. Inline style changes are recorded and restored when protection becomes inactive or the page is whitelisted. Listener records use weak references, and DOM observation is limited to structural roots.

## No Autoplay

Standard protection blocks `HTMLMediaElement.play()` and captured playback events unless playback follows direct user activation. Audio elements and Web Audio may run when the hostname has a valid temporary or permanent sound rule. Sound permission does not allow autoplaying video.

An audible automatic playback attempt triggers one prompt per document. Enhanced protection removes video and audio elements, including matching nodes inserted later. Its subtree observer exists only while Enhanced mode is active.

## Any Copy

Any Copy is enabled per hostname. The main-world runtime restores text selection, prevents page handlers from intercepting copy shortcuts, and writes the user's original selection to `text/plain`. When a reliable selection fragment is available, it also writes sanitized `text/html`. DOM observation starts only after a page restriction is detected.

Enhanced mode creates a closed-Shadow-DOM reading layer over the original page. It builds a new tree from readable page content and never executes copied page markup. Scripts, forms, frames, media, navigation, overlays, and common advertising containers are omitted. Text structure, tables, links, code, figures, captions, and images are preserved. Removing the Enhanced rule destroys the reading layer and restores the original page without reloading.

The Standard mode and Enhanced mode rule lists remain independent. An Enhanced mode rule can enable Any Copy by itself. Removing that rule therefore turns the feature off unless a Standard mode site rule still matches.

## Video Download

Video Download is activated for one tab at a time from the popup. Main-world and isolated-world scanners are injected only after activation. Together they inspect media elements, page metadata, embedded frames, mutation changes, player state, fetch and XHR responses, inline streaming manifests, and buffered Resource Timing entries. A non-blocking `webRequest.onHeadersReceived` listener supplies the browser-level path: after a constant-time active-tab check, it recognizes video responses and HLS or DASH manifests by URL and response MIME type. This remains effective when a page hides its player markup, moves media into a frame, embeds a manifest in script state, or repeatedly replaces its DOM.

Candidate URLs and transient download state live in `chrome.storage.session` under the tab ID. Same-origin navigation clears stale candidates and reinjects the scanner. A different origin, tab closure, or an explicit stop removes the session. Signed URLs are retained without rewriting while the session is active, but are never copied into persistent settings or history.

Direct files are streamed through an offscreen document with the active page as referrer so authenticated and referrer-sensitive sources retain the request context available to the extension. Compatible HLS playlists are parsed locally, including master variants, alternate audio, initialization maps, byte ranges, standard AES-128 keys, live snapshots, and supported wrapped playlist formats. DASH supports BaseURL, SegmentList, SegmentTemplate, SegmentTimeline, byte ranges, separate audio and video representations, and common protection markers.

Separated HLS, DASH, Bilibili, and YouTube tracks are remuxed locally with the bundled Mediabunny build. MP4-compatible tracks produce MP4 output; WebM-family combinations use MKV. YouTube discovery uses the bundled YouTube.js browser build for local player-response parsing and signature transformation. Bilibili uses the page's video identifiers and Bilibili playback APIs, including WBI signing and the international playback endpoint. Dedicated page adapters cover the service-specific sources represented by Vimeo, Facebook and Instagram inline DASH, OK, VK Video, Canva, iQIYI, TwitCasting, Osmosis, Kick, Chaturbate, and wrapped xgplayer HLS.

Temporary artifacts are written to the Origin Private File System instead of holding completed media in memory. The file is exposed to Chrome Downloads only after local processing and is removed after Chrome completes or interrupts the download. DRM decryption, private third-party rule services, and third-party authorization or paid-feature checks are outside the implementation.

## Satellites

Satellites contains opt-in tools that do not require popup controls. Each Satellite owns one settings card containing its control, description, and privacy details.

Bili Daily Login is disabled by default and has no Bilibili content script, tab listener, URL inspection, or browsing trigger. A service-worker alarm schedules the task for 00:05 China Standard Time and uses the same UTC+8 boundary for its completion date. Chrome alarms do not wake a sleeping computer or run after Chrome exits; after a missed run, Chrome schedules one task for the current day and never replays earlier dates. An in-memory single-flight guard merges simultaneous startup and restored-alarm triggers. Before any network request, the worker skips the attempt when `navigator.onLine` explicitly reports offline. An online result is treated only as permission to try because it does not guarantee internet reachability. The service worker then requests Bilibili's account navigation and daily reward endpoints with the existing signed-in Chrome session and records the completed date after verification. Failed work may run at most three times that day; its retry counter is session-only.

## State and lifecycle

`chrome.storage.local` stores one versioned settings object:

- Native Scroll: enabled state, whitelist rules, and Enhanced-site rules
- No Autoplay: enabled state, whitelist rules, Enhanced-site rules, and permanent sound rules
- Any Copy: Standard mode site rules and Enhanced mode site rules
- Video Download: preferred quality and whether Chrome should ask for a save location
- Satellites: Bili Daily Login switch state and last completed date
- Interface locale

Exact and wildcard rules contain hostnames only. Paths, ports, queries, and complete URLs are rejected. Native Scroll and No Autoplay whitelist matches take priority over Enhanced-site matches.

Temporary sound permission is stored in `chrome.storage.session` as an exact hostname and expiry timestamp. It expires after two days or when no tab remains open for that hostname, whichever comes first. Per-tab intervention state contains four booleans and is cleared on navigation or tab closure. Video Download session storage additionally contains the current origin and detected candidate addresses only while that tab session is active.

## Resource use

The runtimes are event-driven. There is no analytics code or persistent background page. Observers are feature-scoped and activated only when required: after Any Copy detects a restriction, during an Any Copy reading view, while No Autoplay Enhanced mode removes newly inserted media, or during an explicitly activated Video Download tab session. The popup polls session state only while its Video Download result view is open. Media fetching, assembly, remuxing, and the offscreen document start only after the user selects a download. Bili Daily Login contacts Bilibili only from its own alarm while Chrome and the computer are running.

## Browser boundaries

Chrome does not allow content scripts on internal pages such as `chrome://`, the Chrome Web Store, or some built-in viewers. Cosmic Gemini remains inactive there. Video Download does not decrypt DRM systems or circumvent access controls. A source may stop working when its public page or playback API changes, in which case its local adapter must be updated.
