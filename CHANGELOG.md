# Changelog

## 1.3.10 — 2026-08-30

- Keeps Video Download’s Other formats section open while the media list refreshes its status.

## 1.3.9 — 2026-08-30

- Added local remuxing for separated video and audio tracks, with MP4 and MKV output selected for compatible codec families.
- Added dedicated YouTube and Bilibili discovery, including Bilibili WBI playback requests, Bilibili international videos, YouTube signature transformation, subtitles, and local track pairing.
- Expanded HLS and DASH handling with alternate audio, inline manifests, live snapshots, SegmentTemplate and SegmentTimeline support, and compatible wrapped HLS playlists.
- Added local adapters for the service-specific playback sources represented by Vimeo, Facebook, Instagram, OK, VK Video, Canva, iQIYI, TwitCasting, Osmosis, Kick, and Chaturbate.
- Streams direct files through the local offscreen processor so authenticated and referrer-sensitive media can retain the active page context.
- Bundled Mediabunny and YouTube.js locally for media processing without a runtime CDN or private rule service.

## 1.3.8 — 2026-08-30

- Removed the webpage title from the Video Download media-list header.

## 1.3.7 — 2026-08-30

- Shows media duration in Video Download when it is already available from player metadata or HLS playlists, without downloading video content to calculate it.

## 1.3.6 — 2026-08-30

- Rebuilt the Video Download refresh icon with a balanced circular arrow.
- Shows a media file size when it is already available from response headers or Resource Timing, without pre-downloading media to calculate it.

## 1.3.5 — 2026-08-30

- Moved the Video Download symbol into the former moon position and enlarged its arrow while shortening the stem.

## 1.3.3 — 2026-08-30

- Redesigned the Video Download product icon around the No Autoplay play mark, replacing its moon with a solid download symbol.

## 1.3.2 — 2026-08-30

- Separated the Video Download play and download marks for a clearer product icon at compact sizes.

## 1.3.1 — 2026-08-30

- Added Video Download as an on-demand current-tab product with an immediate media result view.
- Added browser-level and isolated-page media detection for direct video, embedded frames, HLS, and DASH manifests.
- Added direct-file downloads and local, streamed HLS assembly with master variants, byte ranges, fragmented MP4, MPEG-TS, and standard AES-128 support.
- Added Video Download settings, session-only media state, automatic same-site continuation, and cross-site cleanup.

## 1.2.17 — 2026-08-30

- Removed the asynchronous full-page reveal that could make Settings flash during refresh.
- Synchronously renders the localized settings shell, navigation icons, version, default controls, and cached user-selected rules before the first visible frame.

## 1.2.16 — 2026-08-30

- Deferred settings display until localization, navigation, rule lists, and saved state were ready to reduce content movement.
- Made Native Scroll and No Autoplay switches render on by default while still applying a user’s saved off state before the page becomes visible.

## 1.2.15 — 2026-08-30

- Structured each service-specific Satellite Background in the README as three sentences covering external context, the recurring problem, and the Satellite’s solution.

## 1.2.13 — 2026-08-30

- Expanded Bili Daily Login’s README and Settings descriptions so Bilibili’s daily coin mechanism is introduced before the scheduled behavior.

## 1.2.12 — 2026-08-30

- Changed README Background labels to plain text for a quieter product overview.

## 1.2.11 — 2026-08-30

- Listed individual Satellites as subcategories in the README product overview.
- Added a concise Background paragraph to every individual product explaining the problem it addresses.

## 1.2.10 — 2026-08-30

- Renamed Any Copy’s “Enforced sites” section to “Standard mode sites” to pair it with “Enhanced mode sites.”

## 1.2.9 — 2026-08-30

- Placed the language heading and selector on one compact row in the settings sidebar.

## 1.2.8 — 2026-08-30

- Removed the redundant language explanation from settings while retaining the global language selector.

## 1.2.7 — 2026-08-30

- Reorganized the first settings card around each product’s Standard mode, with a separate site-activation label for Any Copy.
- Standardized English settings terminology on “Enhanced mode” and increased English heading spacing.
- Moved the language selector to the bottom of the settings sidebar and added a dedicated Satellites overview card.

## 1.2.6 — 2026-08-30

- Standardized the Simplified Chinese interface on “强力模式” for the more intensive mode while keeping the English interface unchanged.

## 1.2.5 — 2026-08-30

- Reworded Native Scroll’s “How it works” introduction so Native Scroll is the explicit subject.

## 1.2.3 — 2026-08-30

- Refined Simplified Chinese UI copy for more natural punctuation and phrasing.
- Reworded the Bili Daily Login introduction so Bilibili is the subject of its opening sentence.

## 1.2.2 — 2026-08-30

- Refined the custom Satellites mark with a balanced, axis-symmetric main sparkle.
- Improved the Satellites guidance sidebar and Bili Daily Login explanation.

## 1.2.1 — 2026-08-30

- Added Satellites as the final settings destination for optional tools that do not need popup controls.
- Added the opt-in Bili Daily Login Satellite with a 00:05 China Standard Time background schedule, current-day recovery, and no Bilibili page monitoring.
- Kept each Satellite in its own settings card with its control, description, and feature-specific privacy details.
- Replaced shared settings privacy copy with product-specific statements.

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
