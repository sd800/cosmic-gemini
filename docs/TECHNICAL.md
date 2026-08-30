# Technical design

Cosmic Gemini is a Manifest V3 Chrome extension with two isolated products: Native Scroll and No Autoplay. Each product owns its configuration, page runtime, intervention state, whitelist, and Strong-site rules. Shared code is limited to the extension shell, localization, rule parsing, message bridge, service worker, and toolbar rendering.

## Page startup

Both main-world runtimes load at `document_start` on HTTP and HTTPS pages. Native Scroll patches listener registration before ordinary page scripts can install wheel or touch handlers. No Autoplay patches media playback and Web Audio resume before ordinary page scripts can request playback.

An isolated-world bridge reads settings through the service worker and sends only the current page configuration into each main-world runtime. It exposes neither extension APIs nor stored rules to page code. The same bridge renders the No Autoplay sound prompt inside a closed Shadow DOM after an audible automatic playback attempt.

## Native Scroll

Standard protection stops matching page-level wheel and touch events from reaching website handlers without cancelling the browser's native default action. It preserves pinch zoom, horizontal gestures, interactive controls, maps, editors, media, and ordinary nested scroll areas. Root smooth scrolling and scroll snapping are neutralized while protection is active.

Strong protection additionally handles scripted nested movement and narrowly detected full-page transformed wrappers. It is selected by hostname rule rather than a global mode. Inline style changes are recorded and restored when the feature becomes inactive or the page is whitelisted.

Listener records use weak references. DOM observation is limited to structural roots and is disabled with the feature.

## No Autoplay

Standard protection blocks `HTMLMediaElement.play()` and captured playback events unless playback follows a direct user action. Audio elements and Web Audio may also run when the hostname has a valid temporary or permanent sound rule. These sound rules never allow autoplaying video.

An audible automatic audio attempt triggers one prompt for the document. Granting sound resumes only pending audio elements and Web Audio contexts. Video remains stopped.

Strong protection removes video and audio elements, including matching nodes inserted later. Its subtree observer exists only on hostnames covered by a Strong-site rule and disconnects as soon as the feature becomes inactive.

## State and lifecycle

`chrome.storage.local` stores one versioned settings object:

- Native Scroll: enabled state, whitelist rules, and Strong-site rules
- No Autoplay: enabled state, whitelist rules, Strong-site rules, and permanent sound rules
- Interface locale

Exact and wildcard rules contain hostnames only. Paths, ports, queries, and complete URLs are rejected. Whitelist matches take priority over Strong-site matches.

Temporary sound permission is stored in `chrome.storage.session` as an exact hostname and expiry timestamp. It expires after two days or when no tab remains open for that hostname, whichever comes first. `chrome.alarms` provides expiry while the browser remains open; session storage also clears when the browser session ends.

Per-tab intervention status contains only two booleans. It controls the shared toolbar icon and is cleared on navigation or tab closure. No activity log or browsing history is stored.

## Resource use

Both runtimes are event-driven. There is no polling, network client, analytics code, or persistent background page. Standard No Autoplay does not keep a document observer. Strong No Autoplay observes only added nodes while active, and pending media collections are bounded.

## Browser boundaries

Chrome does not allow content scripts on internal pages such as `chrome://`, the Chrome Web Store, or some built-in viewers. Cosmic Gemini remains inactive there.
