# Changelog

[Simplified Chinese](CHANGELOG_zh.md)

## 9.10.1 — 2026-09-25

- Improve coordination and recovery across page features, navigation, and extension lifecycle changes.
- Strengthen isolation of ordinary and incognito session data, website rules, and cleanup.
- Prevent stalled image analysis from holding up subsequent images.
- Improve document preview restoration and PDF dialog and page-navigation reliability.
- Improve authenticated and redirected document downloads, preview retries, and download cancellation.

## 9.9.1 — 2026-09-25

- Preserve the browser background during elastic overscroll while White Softer is active.
- Add thumbnail navigation and continuous scrolling to presentation previews, with smaller, fitted slides and synchronized page selection.
- Improve presentation background handling, including dark backgrounds inherited from themes.
- Organize page scripts and supporting modules by function, and strengthen resource-path checks.

## 9.8.53 — 2026-09-25

- Preserve clearly identified dark-paper PDF pages in dark mode and keep their display consistent after zooming, rotation, and theme changes.
- Mark the default 4× PDF sampling option in Settings.

## 9.8.52 — 2026-09-25

- Align the Translate Override icon outline with the settings icon color.

## 9.8.51 — 2026-09-25

- Adjust the rear sheet of the Translate Override settings icon to an outline.

## 9.8.50 — 2026-09-25

- Refine the filled appearance of the Translate Override settings icon.

## 9.8.39 — 2026-09-25

- Refine the Translate Override settings icon.

## 9.8.38 — 2026-09-25

- Add distinct settings icons for Translate Override and Stay on the page.

## 9.8.37 — 2026-09-25

- Add a long-press confirmation on the popup’s All Settings button to reload the extension.

## 9.8.36 — 2026-09-25

- Fix dark-mode recovery during repeated internal navigation in LeetCode Explore.
- Add an independent white-text tone selector with warm ivory selected by default, sharing White Softer’s color choices.

## 9.8.35 — 2026-09-25

- Improve document preview recovery, independent download prompts, and image-capture isolation during navigation and interrupted operations.
- Harden message validation and page activity handling, and expand automatic regression coverage.

## 9.8.33 — 2026-09-24

- Update XHS image display icons and Chinese menu wording, and keep image controls stable when dismissing the context menu.

## 9.8.32 — 2026-09-24

- Improve XHS Image Dark Mode when opening comment images and fullscreen post images, reducing bright flashes and preserving image controls and display choices.

## 9.8.31 — 2026-09-24

- Improve temporary media-request isolation, image workspace cleanup, and document-specific XHS activity across delayed page operations.

## 9.8.30 — 2026-09-24

- Improve navigation and tab-state handling across Website Fixer, Ad Marshal, and Website Knowledge Control, including separation of regular and private browsing rules.

## 9.8.29 — 2026-09-24

- Harden Access Control's one-time visits across delayed navigation events, completed loads, overlapping site rules, list changes, and failed retries. Stale toolbar actions no longer redirect an already loaded page.

## 9.8.28 — 2026-09-24

- Keep the normal extension popup available on already loaded Access Control pages; retry navigation only after a recorded block, so a later toolbar click cannot refresh the page unexpectedly.

## 9.8.27 — 2026-09-24

- Improve synchronization and isolation of saved website choices across Website Fixer and related site controls.

## 9.8.26 — 2026-09-24

- Improve Access Control reliability when website rules change, including after edits to Stay on the page. Its site list and temporary visits remain independent of Website Fixer.

## 9.8.25 — 2026-09-24

- Restore the Standing Province navigation-request hook and reject unrecognized province hooks instead of silently dropping them.

## 9.8.24 — 2026-09-24

- Allow Stay on the page rules to be removed by entering a domain or website URL prefixed with `-`, including when no saved rule matches.
- Clarify the addition and removal confirmations in Website Fixer.

## 9.8.23 — 2026-09-24

- Remove excess spacing below the XHS Image Dark Mode button-opacity setting.

## 9.8.22 — 2026-09-24

- Shorten the Chinese wording for the XHS whole-post image option.

## 9.8.21 — 2026-09-24

- Stabilize XHS image controls by limiting motion-related hiding to the active image’s actual geometric changes.

## 9.8.20 — 2026-09-24

- Make browser context-menu actions bypass Stay on the page reliably, including links, images, media and selected-text searches, while keeping unrelated website popups blocked.

## 9.8.19 — 2026-09-24

- Add an Original choice at the end of both XHS image menu groups, preserving separate choices for one image and the complete post.
- Limit Stay on the page to website-initiated navigation from protected tabs while allowing browser context-menu actions, manually entered addresses, and tabs opened by other extensions.

## 9.8.18 — 2026-09-24

- Shorten the Website Fixer save confirmation to 1.5 seconds.

## 9.8.17 — 2026-09-24

- Recognize comment images when navigating their preview with previous and next controls, and pre-analyze the neighboring images when available.
- Make Hide display black whenever XHS Image Dark Mode is active, regardless of the image's display mode.

## 9.8.16 — 2026-09-24

- Open the XHS image options menu without initially highlighting Hide; keyboard navigation still starts with the selected direction.
- Show the switch icon for hidden images and restore the affected image or post with the next click.
- Keep XHS image controls out of opening and closing zoom animations, then position them after the image settles.

## 9.8.15 — 2026-09-24

- Improve XHS Image Dark Mode button responsiveness, manual display choices and resource cleanup, while reducing repeated image processing.
- Add a grouped right-click menu for hiding images and choosing automatic, dark or light display for the current image or post.

## 9.8.13 — 2026-09-24

- Add a lighter warm-white tone to White Softer and mark the original warm ivory as the default.
- Hide the Page Display popup controls when its master switch is off.

## 9.8.12 — 2026-09-24

- Add White Softer with four selectable tones to soften webpage whites, including white text.

## 9.8.11 — 2026-09-24

- Use the full LeetCode Explore name throughout the feature’s descriptions and documentation.

## 9.8.10 — 2026-09-24

- Slightly soften text brightness in LeetCode Explore dark mode.

## 9.8.9 — 2026-09-24

- Refine LeetCode Explore course-overview backgrounds, text contrast, lesson borders, and completion icons, with consistent sidebar, footer, and loading surfaces.

## 9.8.8 — 2026-09-24

- Adapt the MathJax loading status message to LeetCode Explore dark mode.

## 9.8.7 — 2026-09-24

- Remove the brief bright sidebar outline while LeetCode Explore lessons are loading.

## 9.8.6 — 2026-09-24

- Prevent dark-mode flashes when switching LeetCode Explore chapters and refine completion icons in chapter overviews.

## 9.8.5 — 2026-09-24

- Refine LeetCode Explore dark-mode chapter fades, code-language tab borders, and completion icons.

## 9.8.3 — 2026-09-24

- Slightly reduce the Google Search language feature icon in Settings.

## 9.8.2 — 2026-09-24

- Add feature icons for LeetCode Explore dark mode, Instagram follow-list checking, and Google Search language designation.

## 9.8.1 — 2026-09-24

- Add optional dark-mode support for LeetCode Explore courses, lessons, and exercises, following LeetCode’s native appearance.

## 9.7.11 — 2026-09-24

- Refine empty website-list spacing in Settings, including the Document Preview whitelist.

## 9.7.10 — 2026-09-24

- Place Any Copy Enhanced developer-mode details below its heading row instead of beside the title.

## 9.7.9 — 2026-09-24

- Keep feature titles, icons, and switches in place when Settings developer mode adds its information rows.

## 9.7.8 — 2026-09-24

- Use the standard muted text color for developer-mode metadata labels and correct the Google Search feature name throughout the extension and documentation.

## 9.7.7 — 2026-09-24

- Soften the developer-mode metadata label color.

## 9.7.6 — 2026-09-24

- Refine developer-mode text colors to distinguish the metadata labels and match affiliation paths to technical-tag values.

## 9.7.5 — 2026-09-24

- Add a temporary Settings developer mode: press 1 outside website inputs to show technical tags and affiliation hierarchies beneath feature names. Press 1 again to hide them; refreshing closes the mode.

## 9.7.4 — 2026-09-23

- Make clearing Stay on the page’s website list an inline two-click confirmation.

## 9.7.3 — 2026-09-23

- Add punctuation to the Stay on the page saved-website count and shorten its save confirmation to three seconds.

## 9.7.2 — 2026-09-23

- Remove the Sharpen PDFs option and its PDF rendering filter.
- Add separators between Website Fixer’s main heading and child features, and dim the child controls when the main switch is off.
- Show the number of saved Stay on the page websites without listing them, and clear the save confirmation after five seconds.

## 9.7.1 — 2026-09-23

- Add Stay on the page to Website Fixer to restrict selected websites from opening other sites.
- Refine the Website Fixer card, with independent controls and a hidden saved website list for Stay on the page.

## 9.6.30 — 2026-09-23

- Clear website-rule validation messages as soon as an invalid entry is removed from the input.
- Accept website addresses with unlisted top-level domains and improve pasted-address handling.

## 9.6.29 — 2026-09-23

- Move the shared subdomain coverage note below each populated domain list and simplify its wording.
- Strengthen Translate Override on selected websites that mark the whole page or its content as non-translatable.
- Remove excess spacing around empty website lists throughout Settings.

## 9.6.28 — 2026-09-23

- Website domain inputs in Satellites now accept pasted URLs and identify the corresponding site automatically, while preserving existing direct-domain entries.
- Remove excess space between domain-entry forms and their saved website lists throughout Settings.
- Show subdomain coverage once above populated website lists instead of repeating it after each domain.

## 9.6.27 — 2026-09-23

- Add Website Fixer in Satellites with a Translate Override option for selected websites and their subdomains. It removes website requests that disable Chrome Translate while leaving translation to Chrome.

## 9.6.26 — 2026-09-23

- Dim and disable No Autoplay's audio autoplay settings while its main switch is off, without discarding saved choices.

## 9.6.25 — 2026-09-23

- Refined the English Native Scroll and No Autoplay setup wording.

## 9.6.23 — 2026-09-23

- Refined the Native Scroll and No Autoplay setup descriptions in English and Simplified Chinese.

## 9.6.22 — 2026-09-23

- Refine the Chinese Native Scroll settings description.

## 9.6.21 — 2026-09-23

- Start every feature off for new installations, including previously enabled automatic protections and Website Knowledge Control categories. Keep existing user choices unchanged.
- Remove redundant default-state text from the Native Scroll and No Autoplay settings pages.

## 9.6.20 — 2026-09-23

- Allow a blocked Access Control visit by clicking the extension toolbar button directly; remove the former popup action.

## 9.6.19 — 2026-09-23

- Refine project documentation.

## 9.6.18 — 2026-09-23

- Add confirmation prompts for external web and application links in Document Preview, including PDF previews; email, telephone and SMS links offer copying only.
- Share protocol parsing with Mailto Capture while preserving document isolation and blocked unsafe content.

## 9.6.17 — 2026-09-23

- Fix PDF background-worker startup and whole-document copying in the isolated reader, and avoid cross-frame dialog autofocus.
- Remove page-interior PDF loading symbols while scrolling; use the toolbar-divider progress line only when a visible page needs longer to render, without moving the document.

## 9.6.16 — 2026-09-23

- Keep only the newest Settings tab open across All Settings and individual feature pages, automatically closing earlier Settings tabs without affecting other extension pages.
- Place the Document Preview loading indicator to the left of Preview without shifting or enlarging the prompt.

## 9.6.15 — 2026-09-23

- Make PDF document properties more compact without reducing text size, and open overflowing dialogs at the top.

## 9.6.13 — 2026-09-23

- Refine the PDF reader’s centered toolbar spacing, symmetric page indicator and zoom menu while retaining previous/next controls.
- Combine appearance switching into one button while keeping its existing tooltip.

## 9.6.12 — 2026-09-23

- Open PDF document properties by clicking the toolbar filename, with ISO-style dates, available seconds and compact time-zone notation.
- Prepare the PDF reader in parallel with document loading and prioritize the first visible page.
- Remove the PDF reader’s built-in search controls and leave Find to Chrome.

## 9.6.11 — 2026-09-23

- Update the PDF reader’s Rotate left icon to a rounded square with a counterclockwise arrow, aligned with the other toolbar icons.

## 9.6.10 — 2026-09-23

- Updated the Document Preview icon with the document design used in Cosmic PDF, retaining Cosmic Gemini's existing icon colors and styling.

## 9.6.9 — 2026-09-23

- Made PDF sharpening an optional checkbox, off by default. Turning it off also removes sharpening from open readers without recreating their canvases.
- Added 1×/3×/5× PDF sampling choices, keeping 4× as the default. The 1× option also uses a smaller page-canvas budget to reduce memory use.

## 9.6.8 — 2026-09-23

- Added a PDF sampling dropdown in Document Preview settings with 2×/4×/6× options, defaulting to 4×. Changes apply only to newly opened PDF readers.
- Improved high-zoom clarity and added gentle sharpening for scanned pages, while retaining the previous dark-mode contrast. High-resolution rendering stays focused on the visible area, with bounded page caches.

## 9.6.7 — 2026-09-23

- Improved PDF text and fine-line rendering, including fractional zoom, while keeping rendering and page caches bounded. Dark mode now uses darker paper and brighter text while preserving visible page edges.

## 9.6.6 — 2026-09-22

- Improved PDF Viewer clarity on high-density displays. Normal pages and sidebar thumbnails render at sharper pixel densities, while high-zoom detail rendering and bounded canvas resources remain in place.

## 9.6.5 — 2026-09-22

- Refocused the Document Preview README introduction on what visitors can preview, the supported file families and the main preview limitations. Detailed controls and lifecycle rules remain in Settings and technical documentation.
- Fixed spreadsheet preview headers so scrolling does not expose cells above the column labels or cover the blank corner. The preview toolbar now shows a localized, lowercase file family beside the source website.

## 9.6.3 — 2026-09-22

- Shortened the English and Chinese README descriptions for Document Preview and XHS Image Dark Mode. Combined the three-part XHS Image Dark Mode Settings description into one paragraph while keeping its experimental note separate.

## 9.6.2 — 2026-09-22

- Open and reload PDFs at the top of the document, keeping the gap above the first page visible. Normal navigation, zoom and appearance changes retain their existing reading-position behavior.

## 9.6.1 — 2026-09-22

- Added PDF Viewer as an internal reading capability for Document Preview, with no separate Settings entry. It supports text selection, search, page navigation, thumbnails, document outlines, fit modes, full screen, password-protected PDFs, printing and downloading originals; no editing or drawing tools are included.
- Added independent light/dark PDF reading, visible page-edge borders, display-only Rotate left, 100% default zoom and fixed 10-percentage-point zoom steps. Refined the centered toolbar with borderless buttons, group separators and a compact M / N page indicator, and prevented light loading surfaces in dark mode.
- Prioritized visible pages, delayed sharp redraws until continuous zoom settles and bounded offscreen page/thumbnail resources. Parse PDFs locally in a separate worker and isolated sandbox without extension privileges, document scripts or remote content.

## 9.5.8 — 2026-09-22

- Improved Word-family previews (`.doc/.docx/.docm/.dotx/.dotm`): preserved visible consecutive spaces and blank underlined fields, corrected direct text-style overrides, and refined character positioning, paragraph borders/spacing and table formatting.
- Added passive rendering of common Word equations, phonetic annotations and checkbox symbols, retained authored picture dimensions, and expanded legacy Word support for embedded raster pictures, character spacing and safe document links. Conversion remains local and bounded; macros and remote content remain disabled.
- Refined Word lists with aligned wrapped text, multilevel style links, continued and restarted numbering, Unicode bullets and additional Chinese numbering formats. Corrected embedded raster-picture record handling shared with legacy PowerPoint.
- Open document previews immediately to the right of their source tab, including remembered preview choices.
- Keep the preview toolbar, filename and source website unchanged during browser translation.

## 9.5.7 — 2026-09-22

- Reduced Document Preview’s post-close temporary cache retention to 10 minutes.

## 9.5.6 — 2026-09-22

- Reduced Document Preview’s temporary cache retention to 30 minutes after the last preview closes. Earlier cleanup when the source website session ends or Chrome exits still applies.

## 9.5.5 — 2026-09-22

- Merged document information into the preview toolbar: Cosmic Gemini now sits below Document Preview, the slightly smaller filename occupies a wider centered area on one line, with the source website beneath it and no file size. Long filenames use an ellipsis and remain available in full on hover. Slightly increased toolbar height and adapted the layout for narrow windows; PDF previews continue to hide the extension toolbar.

## 9.5.3 — 2026-09-22

- Automatically hide the extension toolbar and file-information header while displaying a PDF, giving Chrome’s native viewer the full preview area. Other document formats retain their headers.

## 9.5.2 — 2026-09-22

- Added Dark Reader-style PDF dark mode to Document Preview, following the existing appearance preference and manual toggle without reloading the document. Chrome's native viewer remains in use; the display filter also changes embedded pictures and the viewer's controls and background, while original files remain unchanged.

## 9.5.1 — 2026-09-22

- Improved Document Preview for legacy `.doc/.xls/.ppt`: preserved common fonts and text styles, paragraph spacing and indentation, list numbering, table geometry and cell formatting, plus supported slide text boxes, colors and embedded pictures.
- Refined non-PDF previews with richer spreadsheet text, corrected merged cells around hidden rows/columns, improved RTF/OpenDocument formatting and slide text layout, and safely retained common email presentation styles.
- Corrected font inheritance and Chinese/Latin font selection, with local substitutes when the original font is unavailable.
- Corrected Word paragraph spacing and retained blank fields, heading whitespace and default tab widths.
- Displayed file sizes in decimal units with at most one decimal place, using byte/bytes for unscaled sizes.
- Fixed preview defaults overriding document formatting. Reused image and formatting data, reduced repeated parsing and bounded complex layouts to keep local conversion responsive. Remote content and executable content remain disabled; PDF continues to use Chrome’s native viewer.

## 9.4.1 — 2026-09-22

- Expanded Document Preview to `.doc/.xls/.ppt/.rtf/.odt/.ods/.odp/.eml`, including email messages under Other in the supported-format list. Legacy Word and PowerPoint files use content-oriented previews.
- Added a loading line and status feedback as soon as Preview is selected, without percentage numbers. Refined the supported-format disclosure and removed the layout disclaimer from the document header.
- Strengthened local parsing, static-content isolation and remote-resource blocking for document previews. PDF continues to use Chrome’s native viewer.
- Hardened Customs Province’s processor authorization, document-cache transfers, original-file downloads and media-processing resource limits.
- Added a Document Preview website whitelist that includes all subdomains, with ordered editing and input help. Access Control and Document Preview domain lists now use two columns except in narrow windows.

## 9.3.1 — 2026-09-22

- Moved Document Preview under Customs Province while keeping its Settings position unchanged.
- Expanded Document Preview to spreadsheets, slides and PDF, including Office template, slideshow and macro-enabled formats. Added worksheet and slide navigation and Chrome’s native PDF viewer.
- Simplified the feature introduction and added a collapsed, categorized list of supported formats in Settings. Website-session choices now cover every supported format together.
- Added bounded local Office conversion and script-free previews; macros, embedded programs, remote content and spreadsheet formula evaluation remain inactive.
- Moved document caching to browser memory. Caches clear 3 hours after the last preview closes, when the source website session ends or when Chrome exits, whichever comes first.

## 9.2.3 — 2026-09-22

- Deferred Document Preview’s local fetch, validation, and cache creation until the user explicitly chooses Preview or Download. Dismissing a prompt now stores no document bytes.
- Refined the appearance setting so its explanatory text no longer activates the menu, simplified the localized description, and removed excess space below the row.

## 9.2.2 — 2026-09-22

- Added an Auto / Light / Dark appearance menu to Document Preview settings. Manual preview choices now apply across the source website and its subdomains for the current website session; Default restores the settings preference.
- Matched the default dark-mode document text to the filename’s brighter white for easier reading.
- Made temporary file-information notices disappear after 15 seconds, while retaining loading, rendering-failure and expired-preview states.
- Added automatic cache cleanup 10 hours after a document’s last preview closes, or when its source website session ends, whichever comes first. Reopening a preview before expiry cancels its countdown while it remains open.

## 9.2.1 — 2026-09-22

- Improved Document Preview’s reading layout and preservation of common Word formatting, including fonts, text colors, paragraph alignment and spacing, indentation, list numbering, and table column widths, borders and shading. Document colors remain readable in dark mode.
- Added visible separators for explicit page breaks and paragraphs set to begin on a new page.
- Added document-only zoom in 10% steps from 50% to 200%; click the percentage to return to 100% without reloading the document.
- Made the boundary between file information and document content clearer, while keeping the compact header and larger, two-line filename.

## 9.1.3 — 2026-09-22

- Increased the Document Preview filename size while keeping long names to two lines.

## 9.1.2 — 2026-09-22

- Made Document Preview’s toolbar and file information more compact while retaining the existing visual style. File information remains easy to read, with long filenames wrapping to at most two lines. The document now fills the remaining window height, with responsive controls for smaller windows.

## 9.1.1 — 2026-09-22

- Added Document Preview, a default-off Standing Province feature above Ad Marshal in Satellites. Supported DOCX downloads offer a local preview or the original download before the save-location prompt, with a document icon, bilingual controls, and file size when available.
- Added temporary website choices and document caching shared across subdomains using eTLD+1. Both are cleared after the website's final tab closes or leaves; a contextual popup control restores asking each time.
- Added automatic light/dark appearance and a manual toggle for the preview, including document text and tables, without changing embedded images or the original DOCX. Disabling capture keeps existing previews available until their source website session ends.
- Simplified the bilingual settings descriptions for Document Preview and XHS Image Dark Mode, retaining the separate experimental-feature notice for XHS.

## 8.14.3 — 2026-09-22

- Reduced only the Access Control one-time-visit icon in the extension popup to the standard feature-icon scale while preserving its button size and click area.

## 8.14.2 — 2026-09-22

- Added an optional, default-off one-time-visit control to Access Control. When selected, a contextual popup button can allow the current tab to visit a blocked domain without changing the saved block list; the exception ends after that tab leaves the blocked domain or closes.

## 8.14.1 — 2026-09-21

- Added Search Result Language Designate for Google Search (`lang-google`), a default-off Standing Province feature at the end of Satellites. Case-insensitive `lang:` search commands now become Google result-language filters, supporting Simplified and Traditional Chinese aliases, multiple languages, and video or other search modes.

## 8.13.31 — 2026-09-21

- Renamed the contextual input panel's alias section to `Site aliases`, placed it after `Shortcuts`, and now hides the complete section whenever the current website-rule input has no aliases. Clicking outside the panel closes it.

## 8.13.30 — 2026-09-21

- Added contextual help to every website-rule input in Settings. Entering `?` or `？` now opens a localized panel describing the current field's accepted entries and shortcuts without saving the help token as a rule.

## 8.13.29 — 2026-09-21

- Added concise input aliases for selected services in Access Control. Each alias resolves to the service's root domain and retains the existing coverage of all subdomains without adding extra background rules.

## 8.13.28 — 2026-09-21

- Replaced Mexico's numeric telephone-zone labels with the official directional names for Zones 2 through 9, localized to the interface language.
- Kept NANP location output in English while localizing other international country, region, and service names into standardized Simplified Chinese when the interface uses Chinese. Chinese fixed lines now use compact country, province-level region, and locality names without administrative suffixes.
- Kept the province-level region and country together in English China locations, and the country and province-level region together in Chinese China locations, while allowing the locality to wrap naturally.

## 8.13.27 — 2026-09-21

- Refined Mailto Capture location wrapping so a long city or metropolitan-area name can wrap naturally while the final state and `USA` remain together, without forcing that suffix onto a new line when it still fits.
- Added a compact precompiled international telephone reference to Mailto Capture, providing country or region identification and numbering-plan display formatting; Chinese fixed lines additionally resolve their area-code location without bundling mobile-prefix geocoding, and Mexican numbers show their one-digit numbering zone.
- Kept the North American Numbering Plan label together during natural wrapping, standardized the government-service label, and added quotation marks around the `tel:` and `sms:` identifiers in settings.

## 8.13.26 — 2026-09-21

- Matched Mailto Capture's inline area-code location text size to its corresponding telephone number while retaining the subdued color.

## 8.13.25 — 2026-09-21

- Standardized NANP telephone-number formatting in the Mailto Capture popover, moved each recognized area-code location directly beneath its number, and removed the separate location field; unrecognized numbers now show no location or error text.

## 8.13.23 — 2026-09-21

- Shortened `United States` to `USA` in Mailto Capture's English-only area-code location results.

## 8.13.22 — 2026-09-21

- Refined Mailto Capture's English-only `Area code location` field with a compact offline hybrid reference: reliable city or metropolitan-area results use the three-digit area code, while broader area codes use precompiled NPA-NXX detail and retain regional fallbacks when no exact assigned prefix is available.

## 8.13.21 — 2026-09-21

- Extended Mailto Capture to preview and copy `sms:` recipients and message content, added English-only offline location details for North American numbers, and restored the original feature description with a separate note for supported external protocol links.

## 8.13.20 — 2026-09-21

- Extended Mailto Capture to intercept `tel:` links, preview telephone numbers locally, and copy the complete dialing target without opening a system app.

## 8.13.19 — 2026-09-21

- Clarified in Ad Marshal settings that Zhihu support covers `zhihu.com` and subdomains.

## 8.13.18 — 2026-09-21

- Refined the Simplified Chinese wording for Claude browser identity consistency.

## 8.13.17 — 2026-09-21

- Applied the language-aware exact-host and wildcard guidance layout consistently across all website-rule sections.

## 8.13.16 — 2026-09-21

- Refined Any Copy's website-rule guidance so English always separates exact-host and wildcard explanations, while Chinese wraps only when needed.

## 8.13.15 — 2026-09-21

- Split the exact-host and wildcard guidance below No Autoplay's audio website rules into separate lines for consistency.

## 8.13.13 — 2026-09-21

- Added automatic wildcard completion for leading-dot domains and multi-label entries from the shared `etld` reference in website-rule inputs, while excluding single-label top-level domains.

## 8.13.12 — 2026-09-21

- Refined the internal classification of selected shared eTLD reference rules.

## 8.13.11 — 2026-09-21

- Generalized and completed the shared coverage of PSL PRIVATE DOMAINS-sector geographic eTLD rules without connecting the reference to a product decision.

## 8.13.10 — 2026-09-21

- Added a shared `etld` reference from the current Public Suffix List ICANN section, together with selected PRIVATE rules reserved for future features.

## 8.13.9 — 2026-09-21

- Added exact IPv4 and IPv6 support to user-maintained website rules, including Access Control, with matching across ports.

## 8.13.8 — 2026-09-21

- Added a confirmed `clean` input action for clearing every domain entry managed by a rule card.

## 8.13.7 — 2026-09-21

- Added empty-input long-press and `reset` input actions to alphabetize user-maintained domain lists while keeping later additions at the end.

## 8.13.6 — 2026-09-21

- Kept every user-maintained domain list in the order its entries were added, without storing timestamps.

## 8.13.5 — 2026-09-21

- Refined the shared trash icon with a wider, more balanced design.

## 8.13.3 — 2026-09-21

- Aligned the Access Control cursor icon’s trailing stroke with its pointer tip and inner vertex.

## 8.13.2 — 2026-09-21

- Added distinct feature icons to the Mailto Capture, Clipboard Protect, Access Control, Website Knowledge Control, Ad Marshal, XHS Image Dark Mode, and Bili Daily Login cards in Satellites, while keeping the two remaining site-specific cards text-only for now.
- Refined the English README’s Satellites group headings with en dashes.

## 8.13.1 — 2026-09-21

- Added Access Control under Standing Province, with a master switch and local domain rules that block a listed domain and all of its subdomains after the matching page is reloaded or opened again. Clipboard Protect now follows Mailto Capture, and both README editions organize Satellites into General features and Site-specific features.
- Reorganized the XHS Image Dark Mode explanation into separate purpose, image analysis, comment-image, and control paragraphs in both interface languages and README editions.

## 8.12.27 — 2026-09-21

- Matched the Satellites category-heading type size to the feature-card headings while retaining the visual group dividers.

## 8.12.26 — 2026-09-21

- Organized Satellites into General features and Site-specific features. Ad Marshal now appears directly below Clipboard Protect at the end of the General features group.

## 8.12.25 — 2026-09-21

- Removed frozen popup presentation code, including the permanently hidden main wordmark and the inactive Image Download recommendation-label hook, and deleted unused shared icon definitions. The visible Video Download panel identity remains unchanged.

## 8.12.23 — 2026-09-20

- Changed Instagram unfollow actions to open Instagram’s native confirmation without choosing either option. After the user acts, or when the account was already unfollowed elsewhere, a fresh Following search must confirm the account is absent before the side panel marks it as Unfollowed.

## 8.12.22 — 2026-09-20

- Restored Page Display on pages with strict content security policies by applying Reduce White Point and Greyscale through Chrome's protected user-origin stylesheet path, while retaining inversion-aware brightness reduction and clean restoration.

## 8.12.21 — 2026-09-20

- Made Instagram unfollow completion depend exclusively on reopening Following and confirming that a stable fresh search no longer returns the account. Temporary row removal and profile-count changes no longer mark the action complete, and failed confirmation remains retryable.

## 8.12.20 — 2026-09-20

- Corrected Instagram unfollow confirmation so page themes cannot make the tool select Cancel by changing button colors; the native confirmation structure is now used while post-action relationship verification remains required.

## 8.12.19 — 2026-09-20

- Prevented completed Instagram list scans from looping when virtualized rows keep changing the list's pixel height; completion now follows a stable account set at the actual bottom.

## 8.12.18 — 2026-09-20

- Strengthened Instagram list coverage with two complete overlapping audits and adaptive viewport settling, so slower virtual-list remounts are collected before scanning advances.

## 8.12.17 — 2026-09-20

- Applied the complete fast Instagram list audit to every scan, regardless of displayed counts or apparent DOM retention, and batched its overlapping top-to-bottom passes to reduce missed accounts without repeated background scheduling delays.
- Kept extension validation stable when macOS regenerates Finder metadata files inside the source tree.

## 8.12.16 — 2026-09-20

- Reserved a consistent display-name line for every Instagram account in the side panel, including accounts without a custom display name.

## 8.12.15 — 2026-09-20

- Simplified Instagram account results to extract one validated user handler directly from each profile destination and derive the side-panel link from it. Virtualized lists now receive a final full audit even when Instagram’s displayed count is stale, reducing missed accounts and incorrect relationship classifications.

## 8.12.13 — 2026-09-20

- Corrected Instagram verified-account handlers by reading only their painted text, and clarified the current-profile scan-data action in the side panel.

## 8.12.12 — 2026-09-20

- Removed the remaining verification text from Instagram account rows, prevented hidden verification labels from being collected as display names, and placed verified accounts at the end of the not-following-back list.

## 8.12.11 — 2026-09-20

- Replaced the Instagram side-panel verification badge with a spaced blue text check mark and removed its visible hover label.

## 8.12.10 — 2026-09-20

- Matched each Instagram account's display-name font size to its user handler in the side panel while retaining the secondary color and separate line.

## 8.12.9 — 2026-09-20

- Following/Follower List Check for Instagram now recognizes the compact blue verification mark beside an account while reading page lists and displays a small blue check after that account's visible user handler in the side panel.

## 8.12.8 — 2026-09-20

- Changed Instagram list completion to follow the stable physical end of each loaded list instead of requiring an exact match with Instagram's displayed account count. A mismatched list is checked directly when its rows remain in the DOM; only a virtualized list receives one fast, overlapping remount sweep. Completed progress no longer remains at 99% when the displayed count is stale.

## 8.12.7 — 2026-09-20

- Updated Following/Follower List Check for Instagram to use each account's visible user handler for display, deduplication, and list comparison. The account link is now retained separately for side-panel navigation, including when its path differs from the visible handler.

## 8.12.6 — 2026-09-20

- Fixed Instagram list checks that could remain one account short at 99%. Account identity now follows Instagram’s profile-link handler directly, scrolling uses overlapping checkpoints, and a near-complete virtualized list receives a finer full verification sweep before incomplete-data recovery begins.
- Refined the Simplified Chinese IG± start instruction in Satellites.

## 8.12.5 — 2026-09-20

- Refined the settings guidance and privacy description for Following/Follower List Check for Instagram.

## 8.12.3 — 2026-09-20

- Kept completed Following/Follower List Check for Instagram results in browser-session memory, so reopening a profile can restore a validated result until the browser exits. Added controls beneath completed results to clear the current profile or all Instagram list results.
- Made slow Instagram list reads more resilient. The reader now waits longer, nudges a stalled virtualized list, and can restart twice from freshly checked profile counts before reporting an incomplete result; partial comparisons remain hidden.

## 8.12.2 — 2026-09-20

- Reworked own-profile unfollowing in Following/Follower List Check for Instagram to use Instagram’s visible Following list, exact username search, and native confirmation control instead of an internal request endpoint. Existing own-profile, explicit-confirmation, and relationship checks remain in place, and an uncertain write is never repeated automatically.
- Marked the feature as “On click” in Satellites. Opening the extension popup while an Instagram check is running no longer replaces its side panel with Image Download; popup state reads no longer claim a product workspace.

## 8.12.1 — 2026-09-20

- Added Following/Follower List Check for Instagram to Satellites, with a contextual IG± popup button and a side panel for comparing following and follower lists. Each list shows its own progress bar once reading begins. Reading works independently of interface language, continues when the panel is closed, and shows comparisons only after both lists are complete. Own-profile results allow individually confirmed unfollows after checking the signed-in account and current relationship.
- Fixed side-panel switching so Image Download reopens its own workspace and does not close another tool’s panel during cleanup.

## 8.11.19 — 2026-09-20

- Improved No Autoplay compatibility with custom media players. Explicit play controls now grant a bounded playback intent to media in the same player, including playback that finishes setting up asynchronously, while blocked script-initiated play no longer reports a false success that can leave a player stuck.

## 8.11.18 — 2026-09-20

- Reduced the sustained cost of XHS Image Dark Mode on long feeds and expanded posts. New content now uses localized registration, full record cleanup is scheduled only after DOM removals, and comment-preview plus profile-control state uses dedicated indexes and URL caching instead of repeated scans or rewrites. Image sampling size, look-ahead range, and recognition rules remain unchanged.

## 8.11.17 — 2026-09-20

- Improved XHS Image Dark Mode control reliability by isolating complete pointer gestures from Xiaohongshu carousel handlers. Hidden preview layers can no longer retain an overlapping control, and only the active visible comment preview may suppress the post image control.

## 8.11.16 — 2026-09-20

- Fixed a detached XHS comment-preview control temporarily intercepting input intended for the restored post image control. Comment-thumbnail click detection is now also limited to the relevant comment container.

## 8.11.15 — 2026-09-20

- Fixed XHS Image Dark Mode handling for opened comment images when their preview uses a different resource or reuses an existing page element. Comment previews are now analyzed independently and provide their own light-or-dark control while the post image control stays hidden.

## 8.11.13 — 2026-09-20

- Added XHS Image Dark Mode support for comment images after their post is opened. Comment images remain viewport-driven, and opening a comment image preview now hides the post image control until the preview closes.

## 8.11.12 — 2026-09-20

- Changed the XHS Image Dark Mode image control so a press and hold alternates the complete post between forced dark and light display. A click now restores automatic recognition for every image in that post, including its feed cover and images loaded later.

## 8.11.11 — 2026-09-19

- Expanded XHS Image Dark Mode recognition to chat screenshots with repeated bright dialogue surfaces while preserving photographs with a single bright subject.

## 8.11.10 — 2026-09-19

- Improved XHS Image Dark Mode recognition for bright text on uniform vivid-color cards while preserving isolated bright photographic subjects.

## 8.11.9 — 2026-09-18

- Changed the XHS Image Dark Mode post-level press-and-hold action to hide the image control after pausing the open post. Its feed cover also returns to the original display, and reopening the same post keeps it paused. User profile pages now provide a separate switch that can pause image analysis and adjustment for every post on that profile.
- Cleaned up unused Ad Marshal code.

## 8.11.8 — 2026-09-18

- Changed the XHS Image Dark Mode press-and-hold action to turn image adaptation off for the open post. Every image returns to its original display, later images remain untouched, and the image control changes to an off-switch symbol. Pressing and holding again restores automatic handling for that post; short presses remain unavailable while it is paused.

## 8.11.7 — 2026-09-18

- Added a press-and-hold action to the XHS Image Dark Mode image control. A long press applies the current light-or-dark change to every image in the open post, including images loaded later; a second long press restores each image’s own automatic result. Short presses continue to affect only the current image.

## 8.11.6 — 2026-09-18

- Fixed Xiaohongshu viewer notices and overlays being mistaken for post images, which could stack light and dark controls in the same position and make the visible control appear ineffective. Image controls now attach only to actual slide media, and each viewer displays at most one control.

## 8.11.5 — 2026-09-17

- Added region-neutral Simplified Chinese (`zh-Hans`) and Traditional Chinese (`zh-Hant`) choices to Website Knowledge Control immediately after Simplified Chinese (China). Each selection applies to request language, browser language signals, and default regional formatting.

## 8.11.3 — 2026-09-17

- Fixed Clipboard Protect appearing in Satellites only after a page refresh. Refreshed Settings pages and in-page navigation now render the same controls, and automated coverage prevents their complete page content and navigation structure from drifting apart again.

## 8.11.2 — 2026-09-17

- Clipboard Protect now automatically yields whenever Any Copy is active on the current page. Central stops the outgoing copy guard before starting the incoming one, and Clipboard Protect resumes when Any Copy is no longer active there.

## 8.11.1 — 2026-09-17

- Added Clipboard Protect beneath Website Knowledge Control in Satellites. Its independent switch protects selected text from website additions during copying, preserves available formatting, and works alongside Any Copy. Editable areas retain their own copy handling. It is off by default.

## 8.10.11 — 2026-09-17

- When Zhihu is selected in Ad Marshal, Central now keeps Any Copy active across `zhihu.com` and all of its subdomains. The popup control can pause or resume Any Copy only for the current tab without changing the persistent managed-site selection or other Zhihu tabs.

## 8.10.10 — 2026-09-17

- Fixed Website Knowledge Control failing to initialize on HTTP pages where `crypto.randomUUID()` is unavailable. Its page bridge now uses the same secure random-byte fallback as the other page runtimes.

## 8.10.9 — 2026-09-17

- Fixed Xiaohongshu feed covers occasionally remaining light after the expanded first image had already been recognized as a text card. A higher-quality viewer result now supersedes an earlier cropped-cover photo result and is applied immediately to the mounted feed cover.

## 8.10.8 — 2026-09-17

- Fixed very sparse text slides in expanded Xiaohongshu galleries being mistaken for photographs. The classifier now recognizes separated text marks on an overwhelmingly uniform bright reading surface while continuing to leave isolated small photo subjects unchanged.

## 8.10.7 — 2026-09-17

- Fixed expanded Xiaohongshu galleries sometimes leaving already-decoded second and later slides unanalyzed. Newly inserted viewer images now enter the priority queue immediately, responsive image-source replacements stay attached to their owning slide, and transparent reading surfaces can be classified without turning isolated transparent photo subjects into dark-mode cards.

## 8.10.6 — 2026-09-17

- Combined Website Knowledge Control's language and Intl locale settings into one language-and-regional-formats choice, so one selection now governs request and browser languages together with default Intl formatting. Added Chinese locale choices for Macao, Chinese Taipei, Malaysia, and Singapore after Hong Kong.

## 8.10.5 — 2026-09-16

- Added a short exit animation to the Mailto Capture popover, matching its entrance motion while respecting reduced-motion preferences.

## 8.10.4 — 2026-09-16

- Removed the excess space beneath the Global Privacy Control setting.

## 8.10.3 — 2026-09-16

- Added Global Privacy Control as an independently selected option in Website Knowledge Control. When the product is enabled, the option sends `Sec-GPC: 1` with web requests and exposes `navigator.globalPrivacyControl` to pages; like the other browser-information settings, changes apply when a page next loads.

## 8.10.2 — 2026-09-16

- Added Singapore to the tertiary pinned group in the Website Knowledge Control time-zone menu.

## 8.10.1 — 2026-09-16

- Added Website Knowledge Control beneath Mailto Capture in Satellites. Its master switch and independent language, Intl locale, and time-zone controls let users choose what browser information websites receive; the language menu shares the Intl locale choices. The feature is off by default.
- Isolated request-language rules between ordinary and Incognito tabs and coordinated browser-information adjustments to prevent overlapping settings from overwriting each other.
- Kept each loaded page on its initial Website Knowledge Control policy so changing or disabling a setting restores the browser's original values only when that page next loads.

## 8.9.28 — 2026-09-16

- Extended Claude browser identity consistency to the network layer. While its independent setting is active, top-level navigations to supported Claude and Anthropic sites, together with network requests initiated by those pages, now use only `Accept-Language: en-US`; the scoped rules follow the existing retained-tab lifecycle and are removed during final cleanup or reset.

## 8.9.27 — 2026-09-16

- Refined the feature description shown in Settings for Chinese Response Display Optimization for Claude.

## 8.9.26 — 2026-09-16

- Clarified that Chinese Response Display Optimization for Claude adjusts only the reply text displayed in the user’s browser while leaving excluded content unchanged.

## 8.9.25 — 2026-09-16

- Prevented stale page scripts from reporting uncaught “Extension context invalidated” errors after Cosmic Gemini is reloaded or updated. Page bridges and media discovery now guard both synchronous message failures and asynchronous rejections while releasing runtime listeners safely.

## 8.9.24 — 2026-09-16

- Presented Claude browser identity consistency as a compact checkbox beneath the product description and removed its redundant heading and separate settings row. Saving this independent preference no longer reports a failure after the setting has already been applied.

## 8.9.23 — 2026-09-16

- Separated Claude browser identity consistency into its own setting beneath Chinese Response Display Optimization for Claude. It now operates independently from the reply-display switch while retaining the same local and reversible page-runtime boundary.

## 8.9.22 — 2026-09-16

- Extended Chinese Response Display Optimization for Claude across supported Claude and Anthropic sites with a local consistency layer for selected browser identification signals in US usage contexts. The existing reply-display adjustment remains limited to Claude chat responses, and both parts follow the same product switch and reversible page-runtime lifecycle.

## 8.9.21 — 2026-09-16

- Separated the contextual XHS Image Dark Mode control into three live signals. Its icon is blue whenever the product is enabled, its blue surface appears when Always on or a detected page-wide dark mode permits processing, and its solid outline appears only while at least one image on the page remains transformed. Restoring every transformed image or stopping the product now removes the outline.

## 8.9.20 — 2026-09-16

- Made the contextual C control's solid outline follow live page intervention state. It now appears only while transformed Claude reply text remains in the current page, clears when that text is replaced or removed during in-page navigation or when the product is off, and is reaffirmed after configuration resynchronization without repeatedly scanning the full conversation.

## 8.9.19 — 2026-09-16

- Kept the contextual C control present whenever the popup belongs to an exact `claude.ai` tab, independently of the product's saved on/off setting and transient product-state readbacks.
- Preserved half-width punctuation inside adjacent Latin-letter or numeric phrases in otherwise Chinese Claude replies. English addresses therefore retain their original punctuation, while surrounding Chinese prose continues to use full-width punctuation.

## 8.9.18 — 2026-09-16

- Added a contextual C control to the popup on `claude.ai`. Its blue surface shows that the product is enabled, while a solid blue outline appears only after the product has changed reply text on the current page.

## 8.9.17 — 2026-09-16

- Renamed Chinese Punctuation Marks Display Optimization for Claude to Chinese Response Display Optimization for Claude and changed its internal technical identity from `chinese-punctuation-claude` to `chinese-response-claude`.
- Added consistent spaces between Chinese text and adjacent Latin letters, numbers, or related symbols to the same product without another switch. This includes currency forms such as `$45`, percentages, temperatures, mentions, tags, and common operators without treating ordinary prose punctuation as a spacing symbol. The reversible text transformation follows streamed replies and excludes code, links, formulas, controls, and editable content together with punctuation conversion.
- Preserved ASCII parentheses in telephone numbers, where the parentheses are part of the number rather than Chinese prose punctuation.
- Reduced page work by limiting streamed-text observation to Claude response containers. The lightweight page observer now discovers new responses without watching unrelated character changes, and recorded writes made by the product itself are ignored before another processing task is queued.

## 8.9.16 — 2026-09-16

- Fixed Reduce White Point and Greyscale remaining interactive and using their ordinary neutral appearance on pages where Page Display cannot run. Both popup controls now use the same unavailable state and label as other products, regardless of saved Page Display settings.

## 8.9.15 — 2026-09-16

- Moved Chinese Punctuation Marks Display Optimization for Claude to the final position in Satellites. Static first-frame Settings and in-page Settings navigation now preserve the same order.

## 8.9.13 — 2026-09-16

- Added Chinese Punctuation Marks Display Optimization for Claude as a default-off Satellite governed by Operations Province. On the exact `claude.ai` host, it replaces half-width punctuation in rendered Chinese replies while excluding code, links, formulas, controls, and editable text.
- Processing is incremental and local to the page. Disabling the product restores text that it changed unless Claude has already replaced that text with newer content.

## 8.9.12 — 2026-09-16

- Fixed Native Scroll causing `Illegal invocation` errors when a page called `window.scroll`, `scrollTo`, or `scrollBy` through another object or callback. Window scrolling wrappers now preserve the owning Window receiver, while Element scrolling methods continue to use their actual element receiver.

## 8.9.11 — 2026-09-16

- Fixed No Autoplay missing media that began playing before its page configuration arrived, including players that removed their `autoplay` attribute after starting. The one-time initial check now considers current playback state without adding polling or an ongoing DOM scan.
- Applied the top-level page's No Autoplay decision inside its HTTP(S) child frames, so embedded players follow the same Standard, Enhanced, inactive, whitelist, and audio-autoplay policy as their containing page.
- Restricted playback intent to direct interaction with a media element or a control identified as play, resume, or unmute. Ordinary clicks, page controls, and Chrome's general user-activation state no longer permit delayed HTML media or Web Audio autoplay.

## 8.9.9 — 2026-09-14

- Expanded XHS Image Dark Mode to recognize white text cards containing bounded bright highlights and small illustrations. Bright annotations are evaluated as secondary reading surfaces before the remaining foreground structure is classified, while white-background product photographs and other large visual subjects remain unchanged.

## 8.9.8 — 2026-09-14

- Expanded XHS Image Dark Mode to recognize text cards built on a vivid, uniform color surface. The classifier requires a dominant stable background, contrasting text-like foreground, and multiple separated foreground structures, so colorful photographic layouts remain unchanged.

## 8.9.7 — 2026-09-14

- Fixed a low-detail Xiaohongshu CDN preview being able to classify an image as a photograph and suppress analysis of its sharper version. Negative results now remain specific to the exact image variant, while confirmed text-card results can still be reused across variants. Lightly textured pastel cards with contrasting text are therefore processed once their detailed image is available.

## 8.9.6 — 2026-09-09

- Fixed Native Scroll repeatedly generating Content Security Policy errors on websites with strict style policies. Standard and Enhanced mode page rules now use Chrome's extension stylesheet injection instead of page inline styles, and switching modes or disabling Native Scroll removes those rules cleanly.

## 8.9.5 — 2026-09-08

- On X / Twitter, enabling Video Download now adds download arrows to page videos. Clicking an arrow opens the media menu for that video. Post detail pages initially list all of the post’s own videos, with thumbnails, available qualities, and durations when supplied by the source. Other pages prompt you to choose a video. Moving between posts clears the previous results.
- Quality options now include known file sizes in parentheses across Video Download. Direct-file sizes can be read from response headers without downloading media, while stream manifests are not mistaken for video file sizes.

## 8.9.3 — 2026-09-06

- Fixed a late tab-loading event erasing XHS Image Dark Mode's current-document status after the page had already reported active processing. New documents now reset this state through their own document identity, so the popup no longer falls back to “Waiting for a page-wide dark mode” while processing is active.

## 8.9.2 — 2026-09-06

- Updated XHS Image Dark Mode to describe and follow the resulting page-wide dark appearance without naming a particular theme provider. Automatic processing recognizes compatible page-dark signals from either the website or other page styling, while Always on continues to bypass detection.

## 8.9.1 — 2026-09-06

- Extended XHS Image Dark Mode to post covers on Xiaohongshu user-profile pages, including covers discovered before their initial layout dimensions are available. Profile post covers are no longer mistaken for user avatars.
- Recognized Xiaohongshu's native page-dark marker and kept the detected state intact across same-document navigation. Document-bound, ordered status reports now prevent stale results from making the popup incorrectly say that page-wide dark mode was not detected.

## 8.8.5 — 2026-09-06

- Redesigned the XHS Image Dark Mode popup icon with the open book in the upper portion and the bulb below it. The waiting and active states continue to use hollow and solid bulbs respectively.

## 8.8.3 — 2026-09-06

- Simplified the Page Display settings hierarchy. Reduce White Point and Greyscale now place their switches directly beside their headings, while only the Reduction control remains in a subordinate row.

## 8.8.2 — 2026-09-06

- Reordered the popup so Image Download and Video Download appear above the Page Display controls. Reduce White Point and Greyscale now occupy the fifth row.

## 8.8.1 — 2026-09-06

- Added global Reduce White Point and Greyscale controls to a new fourth popup row below Any Copy. Their saved settings remain directly available on restricted tabs, and each enabled control uses the popup's blue icon and background state.
- Gave Reduce White Point the former bulb symbol and Greyscale a split solid-and-outline circle. XHS Image Dark Mode now uses a combined open-book-and-bulb icon while retaining its hollow waiting state and solid-bulb processing state.
- Moved Page Display from Satellites into its own settings page, with a brightness-sun destination immediately before Satellites and individual icons for both visual adjustments.
- Added a Page Display master switch. Turning it off restores affected pages and disables every child control while preserving its selections; turning on either popup adjustment also enables the master when needed.

## 8.7.1 — 2026-09-06

- Fixed XHS Image Dark Mode accumulating image observation, size observation, control-position work, and continuously scheduled analysis as the Xiaohongshu feed grew. Completed ordinary photographs now leave observation immediately, while reversible transformed cards retain only the state they need.
- Restricted resize and scroll-position work to expanded-view images that actually own controls. Background analysis now yields to browser-idle scheduling between images, while visible and expanded-view images remain prioritized without reducing the existing forward-processing range.
- Viewer replacement, recycled image sources, disconnection, and product restart now release obsolete controls, listeners, records, and queued work. Analysis started by an earlier lifecycle cannot update a later one.

## 8.6.1 — 2026-09-05

- Fixed Reduce White Point making some pages brighter when their page-wide dark mode uses a root inversion filter. Page Display now adjusts its compositing color to the actual ancestor-filter direction so the final rendered page can only retain or reduce brightness, including images, video, Canvas, and other rendered content.
- Theme and fullscreen changes are followed through narrowly scoped appearance events and observation, without polling or inspecting page content.

## 8.5.1 — 2026-09-05

- For the exact `news.qq.com` host only, Ad Marshal now manages article audio and video independently of No Autoplay. It stops automatic playback, keeps the article-player poster visible, and postpones media loading until the user activates the player. The first user-initiated video playback remains muted, while a later explicit unmute is respected.
- For the exact `news.qq.com` host only, Ad Marshal now suspends the article floating player instead of deleting it. The floating player is hidden, paused, and returned to `preload="none"` without removing its node or media sources, so the original inline player remains available when the reader returns to it. Ad Marshal continues to remove the identified right-rail video modules on `news.qq.com` directly.

## 8.3.7 — 2026-09-05

- Changed the `news.qq.com` video-module policy from visual hiding to direct removal. Ad Marshal now pauses and releases media before deleting `.qqcom-jxvideo`, `.video-wrap`, and Tencent Video frames, while the non-video right content rail remains hidden through CSS.

## 8.3.6 — 2026-09-05

- Added the Tencent News floating mini-player to the `news.qq.com` Ad Marshal policy. When the player enters its floating state, Ad Marshal pauses it, releases its media sources, and removes the floating node. The ordinary inline player is not targeted before that transition.

## 8.3.5 — 2026-09-05

- Expanded the `news.qq.com` Ad Marshal policy to hide its right content rail, embedded video modules, video wrappers, and Tencent Video frames without adding DOM observers or polling. Turning the policy off stops its running code and request rules immediately; refreshing restores any areas already hidden in the current page.

## 8.3.3 — 2026-09-05

- Removed the visible “Recommended” badge and labels from Image Download. The best available source remains selected by default, with alternate sizes and formats still available.
- The Image Download stop control now clears scanning feedback immediately, then closes the Side Panel with Chrome's native transition when available. Earlier Chrome versions use a short visual transition instead of an abrupt disappearance.
- Reset cleanup now stops every active Image Download session instead of potentially leaving later tabs active.

## 8.3.2 — 2026-09-05

- Changed the Image Download and Video Download stop-scanning icons to red while keeping their buttons free of background fills.

## 8.3.1 — 2026-09-05

- Fixed website rules rejecting domains that begin with a digit, such as `*.163.com`, and added consistent handling of internationalized hostnames across rule editors.
- Prevented delayed settings responses from replacing newer choices. Confirmed saves remain visible when a follow-up refresh fails, and pending actions cannot be submitted twice from the same control.
- Kept unchanged website-rule controls in place during refreshes so dropdowns are not unexpectedly dismissed. Failed changes restore the saved choice, and dependent controls remain disabled when their parent setting is off.
- Added clear failure messages for settings changes, language changes, and resets. Popup state no longer replaces saved preferences in the settings preview, and Incognito choices cannot populate the ordinary-window preview.
- Reset now replaces saved preferences directly instead of deleting them first, so a failed replacement leaves the original preferences intact. Turning off Any Copy Enhanced now remains successful even if activity bookkeeping fails.
- Prevented late popup and image-scan responses from restoring stale page controls. Stopping Image Download takes effect in its list immediately, even if the following state refresh fails.
- Prevented delayed reconnections from marking a closed Video Download list or hidden Image Download list as visible and extending scanning unexpectedly. Also kept superseded language reads and Incognito resets from changing the ordinary Settings preview cache.

## 8.2.3 — 2026-09-05

- Fixed shared-whitelist additions and removals being rejected after switching from All Settings or another settings page to Native Scroll or No Autoplay. Valid wildcard rules such as `*.douyin.com` now save regardless of which settings page was opened first.
- Website-rule forms now distinguish invalid input from a failed save and retain the entered rule when saving fails.

## 8.2.2 — 2026-09-05

- Marked XHS Image Dark Mode as beta in Settings and added a separate experimental-feature notice. Its popup name remains unchanged.
- Removed Douyin and Gmail from Ad Marshal. Its selectable managed-site groups now cover only Tencent News and Zhihu, and superseded stored selections cannot reactivate the removed behavior.
- Retired the old toolbar activity artwork from the current extension source. The browser toolbar now keeps the standard Cosmic Gemini mark while existing state titles and popup controls continue to show activity.

## 8.2.1 — 2026-09-04

- Limited Image Download and Video Download response observation to the exact tabs where media discovery is collecting. A tab that has never started either product now registers no media `webRequest` listener; observation is added on demand, retained through the two-minute grace period, and removed when collection pauses or ends.
- Coalesced concurrent Customs Province session restoration and removed the former all-tab fallback after an uncertain restoration, preventing resource-heavy unrelated pages from entering the download response path.
- Replaced Ad Marshal's unified switch with a compact set of ordinary website checkboxes. Each managed group starts off and independently authorizes only its corresponding site policies; deprecated unified settings are not restored.
- Tightened the Page Display layout below Greyscale to remove unnecessary empty space.

## 8.1.1 — 2026-09-04

- Introduced Page Display as the second tool in Satellites. The new Operations Province product absorbs Reduce White Point and adds an independent Greyscale feature; both begin disabled.
- Combined both display features in one passive, pointer-transparent rendering layer that covers page content, images, Canvas, animations, embedded frames, and video without scanning those elements or changing layout and input behavior.
- Made each visual effect independently reversible. Turning off one feature removes only that effect, while turning off both restores the page's prior appearance and disposes the layer, fullscreen listener, bridge, and runtime.
- Added complete English and Simplified Chinese settings, synchronous first-frame controls, documentation, privacy copy, and lifecycle coverage for the new product architecture.

## 7.7.1 — 2026-09-04

- Added Reduce White Point as the second tool in Satellites. It is disabled by default and offers an adjustable 10–80 percent reduction, starting at 25 percent, to make bright webpage colors more comfortable to view.
- Implemented Reduce White Point as an independent Operations Province product. Central loads one pointer-transparent visual layer only after the user enables it; the layer covers the rendered page without changing layout or input, follows fullscreen changes, and is removed completely when the feature is turned off. It reads no page content and uses no observer, polling, page API wrapper, or network request.
- Added synchronized English and Simplified Chinese settings, first-frame preference rendering, documentation, privacy details, and lifecycle coverage for the new product.

## 7.6.1 — 2026-09-04

- Removed Ad Marshal's redundant main-world request shims from Douyin. Its confirmed telemetry loaders and hosts remain handled by Chrome's native, tab-scoped DNR rules, while Fetch, XHR, Beacon, image loading, video playback, and preloading keep their native page behavior. This removes per-request JavaScript work from Douyin's high-frequency feed and player paths without expanding or weakening the existing telemetry matches.

## 7.5.2 — 2026-09-04

- Fixed XHS Image Dark Mode gradually stopping as the Xiaohongshu feed scrolled deeper. Unloaded lazy images now wait for their load event without occupying either analysis worker, and an image entering the visible range can move ahead in the pending queue. Ahead-of-viewport preparation remains enabled without allowing dormant resources to block later images. Expanded galleries also track `src` and `srcset` changes before `currentSrc` updates, so a reused viewer element reliably schedules the newly selected slide instead of retaining the previous slide's light state.

## 7.5.1 — 2026-09-04

- Made expanded Xiaohongshu galleries classify every slide independently. A feed cover that is left unchanged can no longer suppress analysis of the full first image or later slides; only a confirmed dark treatment is shared across related page elements, while unchanged results remain scoped to the exact image resource.
- Added recognition for text layouts composed of broad, stable light and dark panels, including light body sections around a dark title panel. The classifier measures contiguous panel structure rather than matching fixed colors or mistaking ordinary text lines for panels. Uniform gray cards now also enter their black-background treatment automatically when recognized.

## 7.3.3 — 2026-09-04

- Prevented the expanded viewer's bright placeholder background from flashing before its image appears. Feed covers and first slides now share classification through the post identity, and the viewer applies one transform to the complete slide surface so its placeholder and image stay visually consistent. The default dark-image brightness is no longer reduced, while an internal brightness variable remains available for later adjustment.

## 7.3.2 — 2026-09-04

- Added a separate high-contrast treatment for uniform mid-gray cards with light text. Their gray backgrounds are deepened to black while light text and small color accents remain visible.

## 7.3.1 — 2026-09-04

- Fixed Xiaohongshu images being silently skipped when the page loaded them without CORS mode. The classifier now retries through a CORS-enabled copy of the same CDN resource, reuses browser caching where available, and leaves the displayed image element untouched.
- Expanded whole-image classification to recognize text cards built from a flat light reading surface and a stable frame. Frame detection is color-independent, so pink, blue, green, yellow, dark, and other borders can be treated as card structure without weakening the safeguards for photographs and mixed images.
- Made light and dark presentation a per-image choice in expanded posts. Controls are created only inside the open post viewer, the active image's control sits immediately left of the page count when one is present, and feed covers no longer load or display controls.
- Normalized Xiaohongshu CDN variants to one image identity. When an expanded post creates a higher-resolution element for an image already classified in the feed, the cached result is applied during the same DOM update so the image does not flash back to white while waiting for another analysis.

## 7.2.1 — 2026-09-04

- Renamed XHS Image Dark Reader to XHS Image Dark Mode throughout the extension, source, settings, and documentation. Its introduction now leads with the action it performs and identifies Dark Reader on Xiaohongshu as the primary use case.
- Replaced regional image masks and face detection with a smaller whole-image classifier. It preserves the source aspect ratio while sampling at most 1,024 pixels, identifies nearly uniform light backgrounds with bounded text-like foregrounds, and leaves photographs and mixed photo-and-text images unchanged.
- Each adjusted image can now switch independently between light and dark. The image control changes its action and label to match the current presentation.
- Made page-wide dark-mode detection use the page's actual dark viewport surfaces as its first signal. It now recognizes whole-page inversion filters and Dark Reader's dynamic, filter, and static engines, observes theme styles and metadata, and briefly rechecks during initial page setup.
- Enabling Always on now starts image processing immediately and displays the active solid-blue contextual control without waiting for page-status synchronization.
- Reworked the Mailto Capture and Ad Marshal introductions so their opening sentences state the action each product performs, with independently localized English and Simplified Chinese wording across Settings and the README files.
- Removed deprecated settings-key and schema migration paths. Current products now read only their current configuration fields.

## 7.1.1 — 2026-09-04

- Added XHS Image Dark Reader as a default-off Operations Province product and the second item in Satellites. On `www.xiaohongshu.com`, a contextual bulb control appears below the fixed popup rows, with separate disabled, waiting-for-dark-mode, and active-processing states.
- Added local, reduced-resolution classification that adapts high-confidence text cards and document regions while preserving portraits, scenery, ordinary photographs, avatars, and uncertain areas. Multi-image posts are handled one slide at a time, and mixed images use a regional mask instead of transforming the full image.
- Added optional per-image restore controls, adjustable opacity, automatic dark-page detection, and a manual detection override. Image observers, styles, overlays, and controls run only while the product is authorized and processing, and are removed when it stops.
- Increased the spacing between Satellites descriptions and their switches, and aligned Privacy text to the same wrapping boundary. XHS Image Dark Reader now uses a fully neutral, legible disabled style for subordinate controls while its main switch is off, and hides Control opacity when image controls are hidden. Privacy descriptions omit redundant switch-state wording while retaining relevant data-handling details.
- Rewrote the complete Satellites interface independently in English and Simplified Chinese, including its overview, help, product descriptions, privacy details, XHS preferences, contextual status labels, and All Settings entry.
- Fixed XHS Image Dark Reader configuration delivery so an in-flight page sync cannot discard a newer switch change. The page runtime now confirms that it applied the latest configuration, and the manual override takes effect before the setting action completes.
- Improved dark-mode detection with direct Dark Reader signals, additional theme roots, and rendered page-surface sampling, so supported dark interfaces no longer depend on a single root background color.

## 6.12.2 — 2026-09-04

- Replaced the monitoring bundle used by Tencent News timeline pages with a local API-compatible implementation, preventing its Fetch, XHR, Console, and performance instrumentation from starting without causing a missing-API error in the page. The timeline policy also now handles its confirmed `n.ssp.qq.com` advertising endpoint locally while leaving content, image, and audio resources unchanged.

## 6.12.1 — 2026-09-04

- Extended the existing Tencent News Ad Marshal policy to its exact internal timeline host, `view.inews.qq.com`. The timeline page now receives the same local handling for its confirmed reporting loader and Tencent telemetry requests as `news.qq.com`, while Settings keeps a single Tencent News entry and other `qq.com` subdomains remain outside the policy.

## 6.11.1 — 2026-09-03

- Reworked Bili Daily Login into two independent daily checks so an earlier confirmed result no longer suppresses the later reliability check. Missed dates and earlier windows are never replayed, browser restarts do not repeat a completed window, and failed requests wait for the next window instead of starting a retry loop.
- Bilibili account checks now use the signed-in Chrome session with temporary Bilibili-compatible request headers, a bounded request timeout, and explicit reward verification. No Bilibili page or tab is opened, and Settings now describes the outcome without exposing schedule details.

## 6.10.7 — 2026-09-03

- Reduced the Mailto Capture popover title to 14px, keeping it distinct from field content without making the compact heading visually heavy.

## 6.10.6 — 2026-09-03

- Aligned the Mailto Capture close control with the title's text baseline and adjusted the × glyph independently so both remain on one visual line.

## 6.10.5 — 2026-09-03

- Reduced the height of the Mailto Capture heading area by tightening its line height, top padding, spacing, and close control while preserving the existing title font size.

## 6.10.3 — 2026-09-03

- Removed the empty status row below Mailto Capture actions. Copy feedback now occupies space only after a success or failure message appears.

## 6.10.2 — 2026-09-03

- Reduced the Mailto Capture popover's width, maximum height, padding, spacing, and shadow so it occupies less of the page. Field labels and values are now slightly larger for easier reading, while the title and button text remain unchanged.

## 6.10.1 — 2026-09-03

- Added Mailto Capture as the first tool in Satellites settings. It is enabled by default in ordinary windows, begins disabled in incognito, and can be turned off independently without adding a popup control or activity icon.
- Mailto Capture intercepts mailto links before a system mail app opens and presents their recipients, CC and BCC addresses, subject, message, and additional fields in a compact popover built with a closed Shadow DOM. A single plain address offers Copy address, while richer links offer only Copy message. The popover closes when you click outside it or press Escape, and it retains no address or message data.

## 6.9.1 — 2026-09-03

- Added a narrowly scoped Gmail policy to Ad Marshal. In an enabled `mail.google.com` tab, repeated submissions to the exact `play.google.com/log` telemetry endpoint now receive a local successful response before another blocker can reject them, preventing the logging queue from repeatedly retrying.
- The policy also covers the embedded Chat and Google top-bar frames that use the same logger. It leaves their scripts and all Gmail mail data, synchronization, attachments, authentication, Chat, Meet, and notification connections unchanged.

## 6.8.5 — 2026-09-02

- Deepened the dark-mode settings switch color toward the Cosmic Gemini logo blue while retaining enough contrast against dark surfaces.

## 6.8.3 — 2026-09-02

- Settings switches now use a balanced medium blue in dark mode, positioned between the Cosmic Gemini logo blue and the brighter dark-theme blue.

## 6.8.2 — 2026-09-02

- Settings switches now use Cosmic Gemini's deeper logo blue when enabled across both light and dark themes.

## 6.8.1 — 2026-09-02

- Settings now receives a dedicated read-only preference snapshot separately from derived product state. Persistent controls can no longer be affected by page matching, runtime activity, browser capabilities, schedules, scans, or DNR reconciliation.
- Audited the saved controls for Native Scroll, No Autoplay, audio autoplay, Bili Daily Login, Ad Marshal, Image Download, and Video Download, with new regression coverage separating user preferences from effective execution state.

## 6.7.6 — 2026-09-02

- Refined the Chinese introduction to the independent tools and data-use explanations in Satellites settings.

## 6.7.5 — 2026-09-02

- Simplified the Chinese managed-sites label in Ad Marshal settings.

## 6.7.3 — 2026-09-02

- Separated the saved Ad Marshal switch from all per-page and Chrome DNR state. Settings now reflects only the user's unified choice. Managed-site matching determines `active` page state, while DNR reconciliation remains an independent product operation.

## 6.7.2 — 2026-09-02

- Fixed the unified Ad Marshal switch appearing unresponsive while Chrome reconciled native network rules. The saved setting now completes independently, and rule reconciliation continues inside the product without holding the control.
- Settings switches now use their complete visual track as the native input target for more reliable pointer interaction.

## 6.7.1 — 2026-09-02

- Ad Marshal now uses one default-off switch for all managed sites. Settings lists the managed sites in one paragraph, while each site retains a separate internal policy. Former per-site settings do not enable or migrate into the new switch.
- Added an internal Zhihu policy for the root domain and all of its subdomains. It neutralizes the analytics loaders and confirmed analytics, performance, experiment, crash-reporting, and Baidu Analytics endpoints observed on the current page without matching Zhihu's separate image and static-resource domains.
- The Douyin policy now also covers its live site without exposing another site in Settings.

## 6.6.1 — 2026-09-02

- The single Tencent News setting now routes `news.qq.com` and `www.qq.com` to separate internal policies. The `www.qq.com` policy handles its own monitoring loader, confirmed advertising-image source, and advertising container without extending to other `qq.com` subdomains.
- Reworded the Tencent News setting description to refer naturally to both domains.

## 6.5.6 — 2026-09-02

- Localized the alternate Tencent News home-domain label and adjusted the Managed sites heading to sit visually between the product title and website labels.

## 6.5.5 — 2026-09-02

- Reduced the Managed sites heading size in Ad Marshal settings to preserve its visual hierarchy within the card.

## 6.5.3 — 2026-09-02

- The Tencent News Ad Marshal policy now applies to both `news.qq.com` and its alternate home domain `www.qq.com`. Matching remains exact and does not extend to other `qq.com` subdomains.

## 6.5.2 — 2026-09-02

- Chrome's extension options command now opens All Settings instead of the Native Scroll settings page.

## 6.5.1 — 2026-09-02

- Ad Marshal now includes an independent, default-off `douyin.com` policy. It neutralizes the confirmed AppLog collection loader, Slardar browser-monitoring loader, and narrowly identified ByteDance telemetry hosts without matching video playback, content feeds, sign-in, or account security.
- Managed tabs now retain their exact site policy so navigating between supported sites replaces the complete tab-scoped DNR rule set. The Douyin policy uses no DOM scan, observer, timer, or polling loop, and all temporary rules and page API patches are released when it is inactive.
- Existing Ad Marshal site choices now remain intact across extension updates and reloads. Satellites lists Tencent News and Douyin separately and stores only those switch settings.

## 6.3.1 — 2026-09-01

- Ad Marshal now resolves Tencent News advertising endpoints and its `127.0.0.1:11601/check` local-client probe inside the extension, preventing the page from contacting a loopback server or reporting the resulting connection failure.
- Known advertising and reporting loaders now receive a local empty script instead of a blocked response. Tracking images are replaced before they reach the network, reducing the follow-up reports created after an expected resource fails to load.
- Added the Tencent advertising and reporting endpoints observed on article pages while retaining the observer-free runtime and the default-off managed-site switches.

## 6.2.1 — 2026-09-01

- Ad Marshal is disabled by default in ordinary and incognito windows. It runs on a managed website only after the user enables that site's switch.
- Fixed Tencent News rendering as a black page when Ad Marshal removed nodes that React still managed. Ad Marshal no longer deletes page nodes or changes Beacon metadata, so the application can complete its own rendering and updates.
- Confirmed advertising and reporting loaders are blocked before execution, matching telemetry requests receive local type-compatible responses, and known advertising containers are hidden with a narrow local style. The runtime no longer needs a DOM observer or polling loop.

## 6.1.1 — 2026-09-01

- Added Ad Marshal to Satellites and gave each managed website its own switch.
- Ad Marshal prevents confirmed Tencent News advertising and reporting loaders from executing even when an external Tencent CDN serves them. Matching telemetry calls receive local success responses, known advertising elements are removed, and Beacon reporting markers are stripped from otherwise functional content so the page cannot sustain a failure-and-retry loop.
- Standing Province coordinates Ad Marshal through Central while the product owns its lightweight, tab-scoped network rules, filtered page runtime, and complete cleanup when a tab leaves the site or the switch is disabled.

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
