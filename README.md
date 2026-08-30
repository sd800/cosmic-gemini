# Cosmic Gemini

[简体中文](README_zh.md)

Cosmic Gemini is a personal Chrome toolkit for a calmer, more controllable web. It combines three independent products: Native Scroll, No Autoplay, and Any Copy.

## Products

### Native Scroll

Native Scroll intercepts page code that takes over wheel or trackpad gestures while preserving ordinary controls and scrollable areas. Enhanced mode handles selected websites that repeatedly restore custom scrolling or simulate page movement.

### No Autoplay

No Autoplay stops video and sound that starts without your action. Media you intentionally play remains available. When a website attempts to autoplay sound, you can keep blocking it, allow it temporarily, or always allow sound for that website. Enhanced mode removes media elements on selected websites.

### Any Copy

Any Copy restores text selection and copy shortcuts on websites that disable them. It also prevents pages from replacing copied text or adding unwanted promotional content. Enhanced mode rebuilds a page as a clean, static reading view with selectable text and unobstructed images. The original page remains available underneath and returns immediately when Enhanced mode ends.

## Features

- Independent controls and website rules for all three products
- Exact-host and wildcard rules such as `example.com` and `*.example.com`
- A compact popup with current-page controls
- Separate settings pages with direct product switching
- Natural en-US and zh-CN interfaces with system-aware light and dark themes
- Event-driven runtimes without polling or a persistent background page
- Fully local operation with no analytics, browsing history, or network requests

## Install

1. Clone or download this repository.
2. Open `chrome://extensions` in Chrome.
3. Enable **Developer mode**.
4. Select **Load unpacked** and choose the [`extension`](extension) folder.

Chrome requests access to HTTP and HTTPS pages so the tools can begin before ordinary website scripts.

## Use

The popup contains one row for each product.

- Native Scroll and No Autoplay provide **Power**, **Enhanced**, **Whitelist**, and **Settings** controls.
- Any Copy is enabled for the current website by clicking its product icon. Its **Enhanced** control may be used directly from the off state, and **Settings** manages Enforced and Enhanced sites.
- When Any Copy enters Enhanced mode directly from off, leaving Enhanced mode turns Any Copy off. If standard Any Copy was already enabled, leaving Enhanced mode returns to standard behavior.

Native Scroll and No Autoplay icons are neutral when unavailable or off, blue while enabled, and green after the feature intervenes on the current page. Any Copy has no blue state: it turns green while enabled for the current website. The main Cosmic Gemini mark in the popup remains unchanged.

### Website rules

`example.com` matches that hostname only. `*.example.com` matches the root domain and all of its subdomains. Popup actions save the exact current hostname; Settings also accepts wildcard rules. A whitelist rule takes priority over an Enhanced-site rule for Native Scroll and No Autoplay.

### Temporary sound permission

**Allow this time** applies to the current hostname until all matching pages are closed or two days have passed, whichever happens first. The permission is then deleted automatically. **Always allow** creates a rule that remains in No Autoplay settings until removed.

## Privacy

Cosmic Gemini runs entirely on your device. It stores only product settings, website rules you choose, and valid temporary sound permission. It does not keep browsing history or an activity log, use analytics, or make network requests. Stored rules contain hostnames rather than complete URLs.

## Compatibility

Cosmic Gemini targets Chrome 120 or later on macOS, Windows, and Linux. Chrome prevents extensions from running on internal pages such as `chrome://`, the Chrome Web Store, and some built-in viewers.

## Development

Cosmic Gemini uses Manifest V3 and has no runtime dependencies. See [Technical design](docs/TECHNICAL.md) for the architecture and [Verification](docs/QA.md) for focused checks.

```sh
npm test
npm run check
```

© 2026 Songming.org
