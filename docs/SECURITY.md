# Security policy and boundaries

Cosmic Gemini protects browsing and local previews through isolated rendering, authenticated extension commands, and deliberate external actions. Website content, document bytes, metadata, filenames, saved domain input, and links are handled as data through fixed interfaces.

## Privileged extension surfaces

Central validates Chrome-supplied message senders before dispatch. UI commands and long-lived UI ports are restricted to the packaged popup, Settings pages, and supported workspace hosts. Opaque renderers, public assets, offscreen processors, unknown paths, foreign origins, child frames, and inactive documents do not receive UI authority. Products retain their own checks for the current tab, frame, document, context, and session; passing the entry check does not authorize every product action. Website tools accept changes only from the packaged popup, validate the live tab and expected site, and keep temporary choices in context-isolated browser-session storage. Current-page updates bind to document IDs to prevent navigation races.

Page events use a separate fixed message allowlist and require an HTTP/HTTPS tab sender. A page-visible marker or event name is not an authentication secret. MAIN-world and DOM-derived values remain untrusted even when a content script forwards them. Code injection uses packaged scripts or fixed functions with data arguments, never source text constructed from website input.

The extension-page CSP loads only packaged scripts and forbids objects, base-URL overrides, and form navigation. Rendered titles, errors, and source metadata use text nodes or escaped templates. New UI entry points must be reviewed before joining the sender allowlist.

## Document and media isolation

Image Download and Video Download use a shared read-only source check before activation. PDF readers, extension pages, browser-owned pages, non-media documents, and inaccessible documents are excluded; the popup hides their controls, and the background rejects unapproved launches. Source decisions remain in memory and are invalidated on navigation.

Document and PDF display run in opaque manifest sandboxes without extension APIs or same-origin access to the host. A sandbox accepts its private MessagePort only from its immediate parent with the exact owning extension origin, derived from its packaged module URL. Initialization is single-use and disabled after disposal. PDF parser startup follows this authenticated handshake.

Sandbox CSP blocks remote resources, nested frames, embedded objects, form navigation, and evaluated scripts. Only packaged controllers execute. Office/mail markup is reconstructed using tag, attribute, style, image, and namespace allowlists before insertion. Source scripts, event handlers, arbitrary CSS, active objects, and remote images are excluded. Embedded raster images are inspected before browser decoding, including byte size, dimensions, animated-frame budgets, and cumulative pixel cost; repeated identical sources share the same budget entry. PDF scripting, XFA, editing, and active annotation layers are not enabled.

ZIP directories, actual decompressed sizes, XML declarations, document sizes, nesting, output, images, and parser time have explicit limits. Traversal paths, duplicate ZIP names, external XML entities, and unsupported active content are rejected or omitted. Worker disposal and stale-response checks prevent retired work from replacing a current view. Offscreen processing accepts only the owning Central worker after product authorization.

Processors execute packaged code and accept metadata and suggested URLs only as data. Preview protections apply to the reading environment; downloads preserve the original file bytes.

## External actions and storage

External Links Capture validates bounded targets and rejects executable, local-file, and browser-internal schemes. Document links require a separate user action to open; application protocols require explicit confirmation. Mailto/tel/sms offer copying only. A link is never followed to populate document metadata.

Domain lists are normalized as host data. Navigation controls apply to website-initiated actions, while browser-owned user actions retain their normal behavior. Chrome provides the underlying browser isolation.

Ordinary/private sessions remain separated. Document content and local file references stay in memory; settings and bounded session metadata are stored only for their documented purpose. Never write private document contents, full browsing captures, credentials, or access tokens into logs, tests, screenshots, or repository notes.

## Crash Page Warden rescue authority

Crash Page Warden operates only on documents authorized by its own saved or browser-session policy. The owning isolated bridge validates through Central before activating packaged MAIN-world guards. Authorization is tied to Chrome's tab, frame, document ID, and ordinary/private context; page-visible markers cannot grant debugger authority.

The declared `debugger` permission prepares a rescue connection for an authorized root document, and `webNavigation` verifies document identity before intervention. The connection performs a `Runtime.disable` handshake and can issue `Runtime.terminateExecution` after sustained missing heartbeats. It does not enable Runtime content-event subscriptions, retrieve scripts, evaluate page expressions, profile execution, or record page content. `Page.enable` supplies browser-dialog open/closed event names so a user-facing prompt suspends the rescue deadline; event payloads are not inspected or retained. Navigation and tab closure release owned connections; browser-level cancellation remains available. Attempts and metadata are bounded and remain in browser-session storage.

Switching off changes future activation. The already-authorized document retains its controls until reload, including after list deletion or reset. Old-document messages, replacement navigation, hidden-page transitions, and large clock delays are checked separately from a sustained execution stall.

## Maintenance and reporting

Keep third-party code pinned with its provenance, licenses, and integrity data. Review dependency updates before shipping them. Use regression tests for changed boundaries, including rejection paths and cleanup, with synthetic data that contains no private user content.

Report suspected vulnerabilities through [GitHub private vulnerability reporting](https://github.com/sd800/cosmic-gemini/security/advisories/new). Include the affected version and a minimal synthetic reproduction, without private files, credentials, or session URLs.

### Navigation tracking cleanup

URL Tracking Cleaner applies selected UTM query removal through Chrome's native navigation rules, a narrowly scoped link-activation handler, and a reversible scripted-window navigation wrapper. Native rules use explicit context-owned tab IDs and operate on GET page navigation. UTM removal preserves unrelated fields; the separately selected Bilibili policy clears the entire query on bilibili.com and its subdomains. The page handlers accept HTTP(S) destinations, handle URL data as text, and perform no network access, HTML insertion, address monitoring, or browsing-history storage. Scripted-window cleanup does not bypass the browser's popup policy or alter protocol handling, and deactivation preserves wrappers installed later by the page. Rule changes are verified before saved settings are acknowledged, and rollback/reset affect only this product's owned rules.
