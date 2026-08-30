# Changelog

## 2.1.3 — 2026-08-30

- Keeps the popup on its main view when reopened, even while a Video Download session remains active. The media list now opens only after the user selects Video Download again.
- Enlarged the image frame inside the Image Download icon and moved it slightly toward the upper-left while preserving the existing download badge.

## 2.1.2 — 2026-08-30

- Enlarged and repositioned the solid lightning badge in the Any Copy Enhanced icon, with a surface-colored separation outline for clearer recognition in every product state.

## 2.1.1 — 2026-08-30

- Rebuilt the popup as three compact rows. The third row now contains Any Copy, Any Copy Enhanced, Image Download, Video Download, and All Settings in that order.
- Added the Any Copy Enhanced icon by pairing the existing copy mark with a solid lightning badge. Any Copy and Any Copy Enhanced now use independent neutral and green states.
- Separated Any Copy and Any Copy Enhanced into their own settings objects, website rules, main-world runtimes, isolated-world bridges, event namespaces, and activity states. Either product can run alone or alongside the other.
- Redesigned the Any Copy settings page with separate Any Copy sites and Any Copy Enhanced sites sections, each using its matching product icon.
- Added All Settings as the rightmost settings navigation item and a hub containing direct links to all six first-level product pages.
- Collapsed Image Download's complete Filters card by default, including search, format, layout, dimensions, sorting, and clear controls. The summary reports the number of active filters, while refreshes preserve its open state and current values.

## 1.5.19 — 2026-08-30

- Removes the page-level audio autoplay question. No Autoplay now blocks audio autoplay silently by default.
- Adds a default-off setting that can allow audio elements and Web Audio on all sites while retaining hostname-specific audio rules. Autoplaying video remains blocked by both permissions.
- Recognizes trusted clicks and keyboard actions on custom playback controls so a manually started video plays on the first attempt.

## 1.5.18 — 2026-08-30

- Uses “audio autoplay” consistently throughout the English interface and current documentation.
- Freezes the No Autoplay audio autoplay prompt to two code-defined choices: Continue blocking and Allow this time.

## 1.5.17 — 2026-08-30

- Audits every user-visible control across the popup, all settings pages, Image Download, Video Download, and the No Autoplay sound question.
- Makes matched Enhanced-mode controls remove their exact or wildcard rule directly. Settings now opens only from a Settings control.
- Prevents rapid repeated clicks from reversing popup changes, submitting the same settings action twice, starting duplicate image or video work, or sending multiple sound decisions.
- Restores settings controls after a failed save, keeps the sound question available when its choice cannot be saved, and disables Image Download rescans while a scan is already running.

## 1.5.16 — 2026-08-30

- Uses one consistent neutral opacity for the Native Scroll and No Autoplay product, power, and Enhanced controls when a whitelist rule is active.
- Makes the active whitelist control remove the exact or wildcard rule that currently matches the website, instead of unexpectedly opening Settings.
- Prefers an exact rule, then the most specific wildcard, when several saved rules match the same website.

## 1.5.15 — 2026-08-30

- Prepares Image Download's tab-specific Side Panel before its popup control is used, removing the race between panel configuration and opening.
- Stops transient Side Panel errors from silently opening or focusing a separate tab. The full-page workspace now appears only when selected in Settings or requested from the Side Panel.
- Avoids reapplying an unchanged panel configuration while the popup remains open.

## 1.5.13 — 2026-08-30

- Adds a red cancel icon beside Video Download's Processing control.
- Cancels active network reading and local media assembly, removes partial temporary artifacts, and returns the selected format to a downloadable state without starting a Chrome download.
- Ignores delayed progress from a canceled request so the media card does not return to Processing.

## 1.5.12 — 2026-08-30

- Opens Image Download in Chrome’s Side Panel by default, keeping the source page visible while images are reviewed and selected.
- Adds an Image Download setting for choosing between the Side Panel and a separate tab, with automatic separate-tab fallback when the Side Panel is unavailable.
- Adds an open-in-tab action to the Side Panel and a responsive workspace layout for narrow panel widths.
- Keeps the Image Download workspace bound to its source tab and closes the tab-specific panel when that session ends.

## 1.5.11 — 2026-08-30

- Prevents range-request warnings from Bilibili CDN routes that return a complete response instead of `206 Partial Content`.
- Streams selected separate video and audio tracks into temporary local files before remuxing, so media processing no longer depends on remote random-access support or keeps the complete source in memory.
- Validates each local track and continues through its alternate CDN addresses before starting the final merge.

## 1.5.10 — 2026-08-30

- Keeps the title shown in the Video Download media card as the Chrome download filename instead of exposing the temporary local artifact identifier.
- Applies the same stable naming to video and audio downloads, while subtitle files retain their language in the filename.

## 1.5.9 — 2026-08-30

- Keeps the quality menu open while live download status refreshes instead of recreating its focused control.
- Redesigns the Video Download result view as one balanced media card with a wider workspace, integrated preview, concise quality selection, format details, and download action.
- Combines duplicate codec and internal-track entries into one preferred option for each main quality while retaining the selected format's technical details below the menu.
- Adds a separate Audio only option when Bilibili or YouTube provides a compatible audio track.

## 1.5.8 — 2026-08-30

- Fixed Bilibili downloads that found formats but failed while reading separate video and audio tracks by applying the source-page referrer through temporary media-directory rules.
- Removes each temporary media rule after local preparation and continues through Bilibili's alternate CDN addresses when required.
- Added a thumbnail and title for confirming the current video, plus a direct quality selector for every detected resolution and compatible codec.
- Fixed page-response capture for JSON-mode `XMLHttpRequest` objects without reading an unavailable `responseText` value.

## 1.5.7 — 2026-08-30

- Confirms that a No Autoplay whitelist rule permits video, audio, and Web Audio autoplay without showing the sound question.
- Dismisses an already-visible sound question when the current website becomes whitelisted.

## 1.5.6 — 2026-08-30

- Fixed Bilibili discovery on pages that remove the global playback object after embedding it in the document.
- Added public video-information fallback so Bilibili formats remain discoverable before playback and while No Autoplay is active.
- Retains and retries Bilibili's alternate CDN addresses when reading separate video and audio tracks for local remuxing.

## 1.5.5 — 2026-08-30

- Replaced the shared media-list refresh symbol with a single circular arrow.

## 1.5.3 — 2026-08-30

- Reduced the Video Download media-list header height and aligned its wordmark to the left.
- Rescaled the Cosmic Gemini line to follow the settings-page wordmark proportions.

## 1.5.2 — 2026-08-30

- Removed the detected webpage title from the Image Download workspace header.
- Added Cosmic Gemini to the visible Image Download and Video Download result-view wordmarks.
- Applied the settings-page English heading tracking to popup titles.
- Turns the whitelist icon green immediately when an exact or wildcard rule matches, and keeps Native Scroll or No Autoplay inactive on that website without a separate effect check.

## 1.5.1 — 2026-08-30

- Added Image Download as an on-demand current-tab product with a dedicated workspace for previewing, filtering, selecting, and downloading images.
- Added discovery for responsive and lazy-loaded images, linked originals, CSS images, open shadow roots, frames, inline SVG, canvas content, structured metadata, and image responses observed during the active session.
- Groups related variants and recommends the strongest original candidate while keeping alternate sizes and formats available.
- Added normal and deep rescans, visible-area capture, local JPEG, PNG, and WebP conversion, separate downloads, and locally generated ZIP batches.
- Keeps Image Download candidates and artifacts temporary, continues across same-origin navigation, and clears the session after explicit stop, source-tab closure, or cross-origin navigation.
- Added the fourth popup row, Image Download settings, complete en-US and zh-CN interfaces, and the corresponding technical and verification documentation.
- Rebuilt the shared media-list refresh mark as a symmetric two-arrow loop.
- Limits the No Autoplay sound question to once while a website remains open, including after reloads and same-site navigation.
- Dims Native Scroll and No Autoplay product and power controls on whitelisted websites while showing an effective whitelist control with a blue selected surface and green icon.
- Removed the README Background paragraphs from Image Download and Video Download.

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
