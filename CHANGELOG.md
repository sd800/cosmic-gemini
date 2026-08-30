# Changelog

## 1.1.2 — 2026-08-30

- Removed the delayed blank frame and duplicate initial rendering from Settings.
- Applied the selected interface language before the first visible settings frame and kept product switching stable.

## 1.1.1 — 2026-08-29

- Prevented disallowed `unload` listener registrations from appearing as Native Scroll extension errors.
- Safely handled tabs that close while Cosmic Gemini refreshes page settings or toolbar state.

## 1.1.0 — 2026-08-29

- Added Any Copy with per-site selection and clipboard restoration.
- Added Enhanced Any Copy reading views and direct off-to-Enhanced mode transitions.
- Renamed Strong mode and Strong sites to Enhanced mode and Enhanced sites throughout the current interface and implementation.
- Added three-state Native Scroll and No Autoplay indicators, plus the green site-active state for Any Copy.
- Updated the extension description to “A personal toolkit for the web.”

## 1.0.0 — 2026-08-29

- Introduced Cosmic Gemini as the shared extension for Native Scroll and No Autoplay.
- Added independent controls, whitelists, and site-specific Strong protection for both products.
- Added automatic video and audio suppression with temporary and permanent sound choices.
- Added separate product settings with direct switching, localized interfaces, and automatic temporary-permission cleanup.
- Preserved the original Native Scroll design language and toolbar intervention indicator.

## 0.1.0 — 2026-08-29

- Added global Standard and Strong protection modes.
- Added exact-host and wildcard whitelist management.
- Added a compact popup, localized Settings, and system-aware theming.
- Added a toolbar suppression indicator for the current page.
- Added focused validation and project documentation.
