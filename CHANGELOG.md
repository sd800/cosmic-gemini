# Changelog

[Simplified Chinese](CHANGELOG_zh.md)

## 5.17.1 — 2026-09-01

- Video Download now keeps separate media identities when one page contains multiple videos. Each video receives its own card, thumbnail or title when available, and compact quality, audio, and subtitle choices.
- DOM players, embedded frames, compatible site adapters, and expanded HLS or DASH streams now carry their media identity through discovery and format expansion. Unassigned streams remain visible as separate results instead of being silently merged by quality.

## 5.16.1 — 2026-09-01

- Image Download now publishes a fast first pass from direct page and resource sources before completing bounded source enrichment. Standard scans focus on the main page, while Full-page scan continues into frames, lazy-loaded content, CSS backgrounds, SVG, Canvas, and Shadow DOM.
- The workspace now shows distinct startup, discovery, and source-checking stages with a spinner, progress bar, and live result count. A scan that exceeds its time limit ends in a recoverable state instead of leaving refresh unavailable indefinitely.
- Duplicate scans in the same tab are combined. Large galleries render in batches, and preview dimensions are written back together, reducing repeated storage updates and full-gallery redraws.

## 5.15.5 — 2026-09-01

- Fixed a first-open race between the Image Download Side Panel and its source-tab session. The workspace now waits briefly for the session, retains updates received while hidden, and shows a localized startup message instead of an empty view with disabled controls.

## 5.15.3 — 2026-09-01

- Fixed the Image Download button failing to open its Side Panel because current-tab validation consumed Chrome's user-gesture window. The Side Panel request now begins directly from the click while current-tab validation continues alongside it.

## 5.15.2 — 2026-09-01

- Image Download and Video Download now show their discovery lifecycle in the popup. Active scanning uses a blue icon with a background, the two-minute discovery period uses a blue icon without a background, and a paused scan returns to the neutral icon.

## 5.15.1 — 2026-09-01

- Fixed Native Scroll sometimes failing to resume protection after being disabled and re-enabled on the same page. While disabled, it retains only inert weak-reference metadata for previously observed scrolling takeover listeners, and runs no hooks, observers, or interceptors. A new runtime may read this metadata only after the user re-enables Native Scroll and Central authorizes it to start again.

## 5.13.1 — 2026-09-01

- Native Scroll now preserves Xiaohongshu's native page APIs and layout from the start of page initialization, allowing feed post cards to open and their image navigation to work while protection remains unchanged on other websites.

## 5.12.1 — 2026-09-01

- Incognito windows now use an independent, memory-only settings environment. Every new incognito session starts with all products inactive and does not inherit ordinary saved settings, website rules, or interface language.
- Choices explicitly made in incognito remain available only for that incognito session. Closing the last incognito window discards them, and resetting settings from an incognito page leaves ordinary browsing settings unchanged.
- Native Scroll and No Autoplay settings identify their incognito default as disabled. Bili Daily Login replaces its switch with “Disabled in Incognito” and cannot be scheduled from an incognito background.

## 5.11.1 — 2026-09-01

- Expanded reliability checks across shared settings, regular and incognito background contexts, scheduled work, initial interface loading, and media handoff.
- Settings changed in one Chrome context now refresh affected page products, open settings pages, and the popup in the other context. Download-only preferences do not trigger unrelated webpage synchronization.
- Bili Daily Login is now owned exclusively by the regular browsing context. It removes any earlier incognito schedule and waits for a regular Chrome window before making a request.
- The popup and Image Download workspace remain hidden until their first state read completes. If the Service Worker is temporarily unavailable, product controls stay disabled instead of becoming clickable without current state.
- Image Download and Video Download retain newly created local artifacts before the offscreen request releases its keepalive. Closing a source tab or stopping a session during Chrome download handoff can no longer revoke the file being transferred.

## 5.10.1 — 2026-09-01

- Expanded reliability checks across settings reset, interface teardown, media handoff, offscreen processing, Service Worker lifetime, and split-incognito operation.
- Resetting the extension now preserves the temporary-file records still required by downloads already accepted by Chrome. Optional offscreen cleanup no longer turns a completed action into an error, and stopping Image Download releases an idle local processor after capture files are removed.
- Image Download and Video Download claim an accepted download immediately and reconcile downloads that finish before session metadata is saved. A later state-write failure can no longer revoke a file that Chrome is already downloading, and completed formats no longer remain stuck in a downloading state after a fast handoff.
- User-requested offscreen media work now keeps its Service Worker available only for the duration of the active processing request. Regular and incognito backgrounds use separate temporary request-rule ranges so one context cannot remove the other's media headers.
- The popup and Image Download workspace no longer reconnect or refresh after their page begins closing. Image Download also rejects a workspace URL without a valid source tab instead of treating it as tab 0.
- Changing the interface language now refreshes active toolbar titles immediately. Temporary locale-read or toolbar-refresh failures no longer turn a saved state change into an error.

## 5.9.1 — 2026-09-01

- Expanded lifecycle checks across Service Worker recovery, page-script composition, media cancellation, download handoff, image capture, and response-observation restoration.
- Video Download now recovers formats left in processing after a Service Worker restart. Stopping the product, closing its source tab, or resetting the extension cancels active local assembly, while completed Chrome handoff remains intact.
- Video scanners and page hooks now remove their document-scoped state when discovery ends. Retained wrappers become inert if a webpage installs another wrapper above them, and temporary request-header rules use a dedicated bounded identifier range.
- Image Download now keeps one capture overlay per page and dismisses it when the session ends. Reopening capture no longer leaves an older keyboard listener behind.
- Page bridges ignore configuration replies that arrive after the product has been disposed. Customs Province also reconciles stale response-observation state after recovery instead of retaining a listener for a session that no longer collects resources.
- Local media artifacts remain available until Chrome finishes an accepted download even when temporary session storage cannot record the handoff immediately. Added regression checks for interrupted processing, retained artifacts, composed page wrappers, and complete runtime cleanup.

## 5.8.1 — 2026-09-01

- Expanded lifecycle and recovery checks across central routing, page runtimes, popup actions, current-tab tools, scheduled work, image capture, and extension UI connections.
- Central now verifies the source of webpage events, extension commands, processing updates, and long-lived UI connections. Page-runtime work is bound to the exact Chrome document that requested it, and a partial injection is rolled back before the failure is returned. Inactive products no longer inject cleanup code into pages where they never started.
- Current-website actions confirm that the source tab has not navigated before changing a rule. Image Download and Video Download read the current source tab when they start instead of relying on an older popup snapshot.
- Any Copy Enhanced serializes rapid tab controls. Disabling Bili Daily Login aborts an in-progress request and cannot recreate its schedule, while changing its preference no longer refreshes unrelated webpages.
- Image Download rejects a capture if the visible source tab changes, removes incomplete capture artifacts, and rescans same-origin single-page navigation. Short-lived image and video response queues are bounded on resource-dense pages.
- Added regression coverage for message and connection sources, document-scoped runtime rollback, concurrent tab controls, stale popup actions, and scheduled-task cancellation.

## 5.7.1 — 2026-09-01

- Expanded recovery and lifecycle checks across Image Download and Video Download, including inputs received from webpages, temporary session storage, scanner injection, offscreen processing, and Chrome download handoff.
- Video Download now removes its page and extension message listeners when the two-minute discovery period ends. A partial scanner injection is rolled back across both page worlds instead of leaving one runtime active.
- Bounded media URLs, manifest messages, candidate collections, and automatic manifest expansion. If Chrome's temporary storage approaches its capacity, inactive discovery results are reduced progressively while local captures and active downloads are retained.
- Temporary media files now remain available for the full lifetime of an accepted Chrome download. Failed image captures remove incomplete files, and unreferenced files older than seven days are reclaimed the next time the local processor starts.
- Added regression coverage for oversized media input, bounded session data, retained download artifacts, and symmetric scanner cleanup.

## 5.6.1 — 2026-09-01

- Corrected Any Copy website-rule removal and kept the selected interface language available through temporary Service Worker read failures.
- Page products now retry together when one synchronization step fails. Events left by a previous website are ignored after navigation, and tab refreshes use bounded recovery attempts.
- Media sessions now distinguish an unavailable Chrome download-status lookup from a completed download. Completed-download cleanup is retried, while restart-safe artifact identifiers keep temporary files recoverable across offscreen document restarts.
- Serialized offscreen document creation and closure so active media work cannot lose its processor. Failed scan timers stop discovery safely, reset cleanup disables any surviving scanner, and Bili Daily Login repairs a missed schedule within bounded attempts.
- Fixed Image Download capture cancellation, retryable image metadata reporting, and Video Download scanner replies. Automated checks now verify bilingual localization parity and the new recovery boundaries.

## 5.5.1 — 2026-09-01

- Serialized activity and download-session updates by tab, preventing simultaneous product events from overwriting one another or dropping newly discovered media.
- Unified settings, locale, and reset writes under one recoverable sequence. A completed reset can no longer be reversed by an older pending write.
- Isolated product state failures so one unavailable product does not disable the whole popup or Settings. Page bridges now recover from brief Service Worker interruptions without undoing a configuration that was already applied.
- Discarded scan results produced for a page after that tab has navigated elsewhere. Service Worker recovery also removes orphaned sessions, activity records, temporary request-header rules, and completed media artifacts.
- Kept active Chrome downloads independent from their media workspace, preserved filenames for simultaneous downloads of the same source, and separated saved Bili Daily Login preferences from bounded schedule repair.

## 5.3.3 — 2026-09-01

- Separated completed popup and Image Download actions from subsequent state refreshes, so a transient readback failure no longer presents a successful action as failed.
- Added bounded retries to read-only state refreshes in Settings, the popup, and the Image Download workspace. Settings writes and user actions are never submitted again automatically.

## 5.3.2 — 2026-09-01

- Fixed transient Shared whitelist update errors by separating the saved settings result from best-effort open-page and settings-view refresh work.
- A failed settings write no longer leaves the serialized write queue rejected, so later updates can proceed without waiting for the Service Worker to restart.

## 5.3.1 — 2026-09-01

- Native Scroll now preserves wheel-based image switching inside enlarged Xiaohongshu post cards while continuing to protect the rest of the page.
- Native Scroll Enhanced also leaves the enlarged post shell intact instead of normalizing the structure required by the viewer.

## 5.2.1 — 2026-09-01

- Image Download and Video Download now share a lifecycle-managed browser-response listener. It remains registered only while at least one download session is active or within its two-minute discovery grace period, and is released after the final session pauses or ends.
- Reopening either download workspace restores response observation before scanning resumes. Multiple products and tabs coordinate through Customs Province without controlling one another.
- Service Worker startup restores existing download sessions before deciding whether observation can stop. If restoration is uncertain, the listener remains available so valid sessions do not miss resources.

## 5.1.1 — 2026-08-31

- Rebuilt the extension background around a four-level `central → province → product → feature` structure. Central now decides jurisdiction and routes work, while three provincial modules coordinate their assigned products and independent product modules perform the work.
- Assigned Native Scroll and No Autoplay to Standing Province; Any Copy, Any Copy Enhanced, Satellites, and extension administration to Operations Province; and Image Download and Video Download to Customs Province. Each province keeps a stable interface so its jurisdiction can change without collapsing the architecture back into central.
- Separated Image Download and Video Download into independent execution modules while retaining one Customs Province coordinator for their shared offscreen document. Products cannot import or control sibling products.
- Kept page bridges, runtimes, scanners, adapters, and offscreen processors at the feature level, with room for further technical subfeatures where required.
- Updated architecture checks, technical documentation, and maintenance notes to enforce the routing and execution boundaries.

## 3.5.1 — 2026-08-31

- Added one shared whitelist to Native Scroll and No Autoplay. It appears in both settings pages, takes priority over product-specific website rules, and preserves those rules for use after a website is removed.
- Added `background/central.js` as the single controller for every product, popup action, settings command, All Settings command, scheduled task, download session, browser-tab lookup, stored interface preference, and page-runtime decision. `content/central-page.js` is now the only declarative page entry and contains no product behavior or independent storage observer.
- Central now injects Native Scroll, No Autoplay, Any Copy, and Any Copy Enhanced independently only when each product is active in that page context. An inactive product does not start its bridge or runtime. Disabling an active product restores its page changes and disposes its feature code.
- Matching shared-whitelist websites receive no Native Scroll or No Autoplay page hooks, observers, style changes, or media intervention. The popup keeps both products unavailable there while click-activated tools remain available when explicitly started.
- Renamed “Website behavior” to “Website settings” in both settings pages.

## 3.1.38 — 2026-08-31

- Added each product's neutral icon beside the title in the introduction card of every dedicated settings page, including All Settings.
- Moved the Any Copy icon from the Any Copy sites section to the main Any Copy introduction title.

## 3.1.37 — 2026-08-31

- Standardized click-activated settings labels to “On click,” matching Chrome's site-access terminology.

## 3.1.36 — 2026-08-31

- Clarified in Any Copy settings that Any Copy Enhanced applies only to current tabs where the user enables it by clicking the control.

## 3.1.35 — 2026-08-31

- Matched the spacing between headings and supporting copy in the Any Copy sites and Any Copy Enhanced settings cards with the rest of the settings interface.

## 3.1.33 — 2026-08-31

- Replaced Native Scroll and No Autoplay's overlapping activation and mode lists with one Website behavior editor. Each rule now belongs to Always inactive, Always use Standard mode, or Always use Enhanced mode, and can move directly between them.
- Existing website settings migrate to the new three-behavior model. Exact and wildcard precedence is preserved, while Standard and Enhanced rules can continue to activate a website when its global default is off.
- Added one shared rule form, categorized saved rules, and separate guidance for exact hostnames and wildcard domains to both settings pages.

## 3.1.32 — 2026-08-31

- Changed Any Copy Enhanced from website-based activation to a current-tab session. It now remains limited to the tab where it was opened, survives navigation within that tab, and ends when it is turned off or the tab closes.
- Replaced the Any Copy Enhanced website-rule editor with a concise current-tab explanation and removed legacy Enhanced website rules from active settings.

## 3.1.31 — 2026-08-31

- Removed the “Default behavior” kicker from the Native Scroll and No Autoplay introduction cards.

## 3.1.29 — 2026-08-31

- Reworded the Website exceptions guidance in Native Scroll and No Autoplay settings to describe adding websites that should follow the user’s preferences.

## 3.1.28 — 2026-08-31

- Keeps Image Download and Video Download discovery active while their workspace is visible and for two minutes after it closes. Discovery then pauses without discarding results and resumes with an immediate scan when the workspace reopens.
- Replaces download-workspace polling with event-driven updates, batches nearby network discoveries, and limits Video Download DOM rescans to changed page regions.
- Gives the first introduction card on every product settings page and All Settings the same blue-tinted border used by Native Scroll and No Autoplay.

## 3.1.27 — 2026-08-30

- Added links between the English and Simplified Chinese changelogs.

## 3.1.26 — 2026-08-30

- Removed the standalone “Background:” label from the Bili Daily Login introduction so Satellite descriptions read as direct, continuous explanations.

## 3.1.25 — 2026-08-30

- Reorganized the extension source by responsibility. `manifest.json` is now the only file stored directly inside `extension`. The service worker resides in `background`, the control popup in `popup`, shared UI and localization modules in `shared`, and the Image Download workspace in `workspaces/image-download`. All Chrome entry paths, runtime URLs, imports, checks, and documentation were updated without changing product behavior.

## 3.1.23 — 2026-08-30

- Enlarged the All Settings icon and button so the icon is only slightly smaller than the popup product icons while retaining its secondary visual hierarchy.

## 3.1.22 — 2026-08-30

- Enlarged the popup product icons and buttons again, and moderately enlarged All Settings. Column spacing was rebalanced so the compact popup keeps even margins at its existing width.

## 3.1.21 — 2026-08-30

- Enlarged the eight popup product icons and their button hit areas together, with rebalanced column spacing. The compact popup width and All Settings control remain unchanged.

## 3.1.19 — 2026-08-30

- Slightly enlarged the eight product icons in the popup while preserving their button hit areas and the existing All Settings icon size.

## 3.1.18 — 2026-08-30

- Applied the brighter blue throughout the extension in dark mode, including settings and download workspaces. Solid blue buttons now use a dedicated dark foreground color for clearer contrast, while light mode remains unchanged.

## 3.1.17 — 2026-08-30

- Increased the visibility of active popup icons, backgrounds, and activity outlines in dark mode with a brighter blue scoped to the popup. Light mode and other extension surfaces retain their existing colors.

## 3.1.16 — 2026-08-30

- Added a thin blue activity outline to the active Native Scroll or No Autoplay mode after it intervenes on the current page. The popup updates the indicator while open.

## 3.1.15 — 2026-08-30

- Further reduced the main popup width while retaining the existing icon sizes, spacing, and button hit areas.

## 3.1.13 — 2026-08-30

- Reduced the main popup width while preserving the existing two-column control layout and button hit areas. The Video Download media panel keeps its existing width.

## 3.1.12 — 2026-08-30

- Redesigned the compact popup as four paired two-button rows: Native Scroll, No Autoplay, Any Copy, and downloads. The Cosmic Gemini wordmark is temporarily hidden, while All Settings now occupies a separate bottom row aligned to the right.

## 3.1.11 — 2026-08-30

- Corrected the gray icon tile in All Settings so layered artwork uses the tile’s actual surface instead of the surrounding card background in dark mode. The Any Copy artwork itself is unchanged.

## 3.1.10 — 2026-08-30

- Matched the Native Scroll and No Autoplay intro purpose statements to the muted color used by the supporting text below them.

## 3.1.9 — 2026-08-30

- Aligned the Native Scroll and No Autoplay intro-card switches with their product-name rows.

## 3.1.8 — 2026-08-30

- Shortened the Native Scroll and No Autoplay intro copy using the earlier direct purpose statements while retaining the current card design and settings flow.

## 3.1.7 — 2026-08-30

- Added the Click to enable label to the Any Copy settings intro card, matching the activation guidance used by Image Download and Video Download.

## 3.1.6 — 2026-08-30

- Restored direct, verb-led purpose statements to the Native Scroll and No Autoplay intro cards. Each card now separates the product’s main function from its default-behavior and website-exception guidance.

## 3.1.5 — 2026-08-30

- Added the Cosmic Gemini logo above the centered project title in both the English and Simplified Chinese READMEs.

## 3.1.3 — 2026-08-30

- Redesigned Native Scroll and No Autoplay settings around a clear sequence: choose the global default, add website activation exceptions, then apply mode exceptions only where needed. Opposing rule lists now share compact paired cards instead of appearing as a long stack of separate sections.
- Moved No Autoplay audio autoplay permissions into their own final step and replaced the general help copy with a concise setup guide that follows the page flow.
- Promoted Any Copy Enhanced to the primary-product color tier in the popup, giving its inactive icon the same visual weight as Any Copy, Image Download, and Video Download.

## 3.1.2 — 2026-08-30

- Reorganized the English and Simplified Chinese READMEs into shorter, topic-focused paragraphs so product capabilities, usage, website rules, privacy details, and compatibility information are easier to scan.

## 3.1.1 — 2026-08-30

- Redesigned the popup as two four-button rows and moved All Settings beside the Cosmic Gemini wordmark. The first row contains Native Scroll, Native Scroll Enhanced, No Autoplay, and No Autoplay Enhanced. The second contains Any Copy, Any Copy Enhanced, Image Download, and Video Download.
- Replaced popup product states with a neutral-and-blue system. Primary products use a stronger inactive color than secondary Enhanced controls. A blue background identifies products with a continuing page effect, while active Image Download and Video Download sessions remain blue without a background.
- Added current-site overrides for Native Scroll and No Autoplay. Either product can now be enabled on one website while its global default is off, or disabled there while the global default is on. Turning Enhanced mode off returns the current website to Standard mode.
- Added Enabled sites, Disabled sites, Enhanced mode sites, and Standard mode sites to Native Scroll and No Autoplay settings. Exact rules can override broader wildcard rules, while opposing rules at the same scope resolve toward Disabled or Standard mode.
- Matched the Any Copy and Any Copy Enhanced rule icons to their heading text color.
- Added the Cosmic Gemini mark and matching product icon before the Image Download and Video Download workspace wordmarks.
- Added Reset all settings below Language in All Settings. The confirmed action restores product settings and website rules, returns language selection to the Chrome UI default, and stops current temporary sessions without affecting downloaded files.
- Cleans temporary Video Download artifacts when a session is stopped.

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
