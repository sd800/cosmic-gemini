# Technical design

Cosmic Gemini is a Manifest V3 Chrome extension with three feature-isolated products: Native Scroll, No Autoplay, and Any Copy. Each product owns its configuration, page runtime, intervention state, and website rules. Shared code covers the extension shell, localization, hostname-rule parsing, service-worker lifecycle, and toolbar rendering.

## Page startup

Main-world runtimes load at `document_start` on HTTP and HTTPS pages. Native Scroll patches gesture-listener registration, No Autoplay patches media playback and Web Audio resume, and Any Copy installs capture-phase selection and clipboard handling before ordinary website scripts.

Isolated-world bridges retrieve only the current page state from the service worker and pass it to main-world runtimes through token-bound events. Stored rule collections and extension APIs are not exposed to page code. The shared bridge renders the No Autoplay sound prompt in a closed Shadow DOM. Any Copy uses a separate all-frame bridge so restrictions inside same-origin and cross-origin frames can be handled without coupling its lifecycle to the other products.

## Native Scroll

Standard protection prevents matching page-level wheel and touch events from reaching website handlers without cancelling the browser's native default action. It preserves pinch zoom, horizontal gestures, interactive controls, maps, editors, media controls, and ordinary nested scroll areas.

Enhanced protection also handles scripted nested movement and narrowly detected full-page transformed wrappers. Inline style changes are recorded and restored when protection becomes inactive or the page is whitelisted. Listener records use weak references, and DOM observation is limited to structural roots.

## No Autoplay

Standard protection blocks `HTMLMediaElement.play()` and captured playback events unless playback follows direct user activation. Audio elements and Web Audio may run when the hostname has a valid temporary or permanent sound rule. Sound permission does not allow autoplaying video.

An audible automatic playback attempt triggers one prompt per document. Enhanced protection removes video and audio elements, including matching nodes inserted later. Its subtree observer exists only while Enhanced mode is active.

## Any Copy

Any Copy is enabled per hostname. The main-world runtime restores text selection, prevents page handlers from intercepting copy shortcuts, and writes the user's original selection to `text/plain`. When a reliable selection fragment is available, it also writes sanitized `text/html`. DOM observation starts only after a page restriction is detected.

Enhanced mode creates a closed-Shadow-DOM reading layer over the original page. It builds a new tree from readable page content and never executes copied page markup. Scripts, forms, frames, media, navigation, overlays, and common advertising containers are omitted. Text structure, tables, links, code, figures, captions, and images are preserved. Removing the Enhanced rule destroys the reading layer and restores the original page without reloading.

The standard and Enhanced rule lists remain independent. An Enhanced rule can enable Any Copy by itself. Removing that rule therefore turns the feature off unless a standard Enforced-site rule still matches.

## State and lifecycle

`chrome.storage.local` stores one versioned settings object:

- Native Scroll: enabled state, whitelist rules, and Enhanced-site rules
- No Autoplay: enabled state, whitelist rules, Enhanced-site rules, and permanent sound rules
- Any Copy: Enforced-site rules and Enhanced-site rules
- Interface locale

Exact and wildcard rules contain hostnames only. Paths, ports, queries, and complete URLs are rejected. Native Scroll and No Autoplay whitelist matches take priority over Enhanced-site matches.

Temporary sound permission is stored in `chrome.storage.session` as an exact hostname and expiry timestamp. It expires after two days or when no tab remains open for that hostname, whichever comes first. Per-tab intervention state contains three booleans and is cleared on navigation or tab closure.

## Resource use

The runtimes are event-driven. There is no polling, network client, analytics code, or persistent background page. Observers are feature-scoped and activated only when required: after Any Copy detects a restriction, during an Any Copy reading view, or while No Autoplay Enhanced mode removes newly inserted media.

## Browser boundaries

Chrome does not allow content scripts on internal pages such as `chrome://`, the Chrome Web Store, or some built-in viewers. Cosmic Gemini remains inactive there.
