# Native Scroll

Native Scroll is a Chrome extension that keeps website scrolling close to the browser and operating system defaults. It suppresses page code that takes over wheel or trackpad gestures, while preserving ordinary controls and scrollable areas.

## Features

- Global protection with a single on/off control
- Standard mode for quiet, compatibility-focused protection
- Strong mode for persistent scripted or transform-based scrolling
- Exact-host and wildcard whitelist rules
- A toolbar indicator shown only after scrolling code is actually suppressed on the current page
- Compact popup and a system-aware light or dark theme
- Natural en-US and zh-CN interfaces
- Fully local operation with no analytics or network requests
- Lightweight runtime with no polling, full-document scanning, or persistent background page

## Install

1. Clone or download this repository.
2. Open `chrome://extensions` in Chrome.
3. Enable **Developer mode**.
4. Select **Load unpacked** and choose the [`extension`](extension) folder.

Chrome may ask for access to websites. Native Scroll needs access to HTTP and HTTPS pages so protection can start before a site's scrolling code runs.

## Use

Open the toolbar popup to control Native Scroll:

- **Power** turns protection on or off across websites.
- **Lightning** switches between Standard and Strong mode.
- **Shield** adds or removes the current hostname from the whitelist.
- **Settings** opens language, protection, and whitelist management.

When Native Scroll suppresses scrolling code on the current page, a blue dot appears on its toolbar icon. The dot clears when you navigate away, turn protection off, or whitelist the page.

### Protection modes

**Standard** is the default. It blocks page-level handling of vertical wheel and trackpad gestures while preserving pinch zoom, horizontal-dominant gestures, interactive controls, and ordinary nested scroll areas.

**Strong** applies broader protection to sites that simulate page movement or repeatedly restore their own scrolling behavior. It may change the behavior of complex interactive pages, so Standard remains the recommended everyday mode.

### Whitelist

Use `example.com` to match one hostname. Use `*.example.com` to cover the root domain and all of its subdomains. The popup adds exact hostname rules; wildcard rules are managed in Settings.

## Privacy

Native Scroll runs entirely on your device. It stores only its enabled state, selected mode, interface language, and whitelist. It does not collect browsing activity, use analytics, or make network requests.

## Compatibility

The extension targets Chrome 120 or later. It is designed around macOS trackpad behavior and also supports wheel and touch scrolling on Chrome for Windows and Linux.

Chrome prevents extensions from running on internal pages such as `chrome://`, the Chrome Web Store, and some built-in viewers.

## Development

The extension uses Manifest V3 and has no runtime dependencies. See [Technical design](docs/TECHNICAL.md) for the architecture and [Verification](docs/QA.md) for focused checks.

```sh
npm test
npm run check
```

© 2026 Songming.org
