# Technical design

Native Scroll is a Manifest V3 Chrome extension. It runs at `document_start` on HTTP and HTTPS pages so its capture-phase gesture listeners are registered before ordinary page scripts.

## Runtime model

The extension uses two content-script worlds. A small isolated-world bridge reads extension settings through the service worker. A main-world runtime applies the selected behavior inside the page and reports when it actually suppresses a scrolling handler. The bridge exposes no extension API or stored data to the page.

Standard mode stops page-level wheel and touch events from reaching website handlers without cancelling the browser's default action. It preserves pinch zoom, horizontal-dominant trackpad gestures, interactive controls, maps, editors, media, and ordinary nested scroll areas. It also disables root smooth scrolling and scroll snapping while active.

Strong mode uses the same foundation and additionally neutralizes scripted nested movement during the active gesture, disables scroll snapping throughout the document, and normalizes a narrowly detected full-page transformed wrapper. Every inline style change is recorded and restored when protection is disabled or the page becomes whitelisted.

The runtime remains installed for the document lifetime because a site may register new handlers at any time. It is dormant when the extension is off or the hostname matches the whitelist.

The runtime uses no polling. DOM observation is limited to the document root, `head`, `body`, and direct structural changes; listener records use weak references. The service worker is event-driven and can sleep whenever Chrome no longer needs it.

## State and permissions

`chrome.storage.local` stores three settings: the global enabled state, the selected mode, and whitelist rules. The popup uses `activeTab` to identify the current hostname. Host access on HTTP and HTTPS pages is required because protection must start before page scripts across the web.

The service worker keeps an in-memory set of tabs where suppression has occurred. It adds a blue badge dot to the toolbar icon for those tabs and clears the state on navigation, deactivation, or whitelisting. This status is intentionally not persisted across service-worker restarts.

## Whitelist matching

An exact rule such as `example.com` matches only that hostname. A wildcard rule such as `*.example.com` matches `example.com` and every subdomain below it. Rules contain hostnames only; URLs, paths, ports, and queries are rejected.

## Boundaries

Chrome does not allow content scripts on internal pages such as `chrome://`, the Chrome Web Store, or some built-in viewers. Native Scroll therefore remains inactive there. Standard mode favors compatibility; Strong mode is available for pages that require broader intervention.
