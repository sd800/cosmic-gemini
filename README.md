# Cosmic Gemini

[简体中文](README_zh.md)

Cosmic Gemini is a Chrome extension with two independent protections for everyday browsing. Native Scroll keeps wheel and trackpad scrolling close to the browser and operating system defaults, while No Autoplay stops video and sound that begins without your action.

## Products

### Native Scroll

Native Scroll intercepts page code that takes over wheel or trackpad gestures while preserving ordinary controls and scrollable areas. Standard protection is designed for everyday use. Strong protection can be enabled only for selected websites that repeatedly restore custom scrolling or simulate page movement.

### No Autoplay

No Autoplay stops videos and audio that begin without a direct action. Media you intentionally play remains available. When a website attempts to autoplay sound, the page prompt can keep blocking it, allow audio temporarily, or always allow audio for that website. Sound allowances apply to audio elements and Web Audio; autoplaying videos remain blocked.

Strong protection can be enabled for selected websites when media elements should be removed entirely, including elements added after the page loads.

## Features

- Independent controls, whitelists, and Strong-site rules for both products
- Exact-host and wildcard rules such as `example.com` and `*.example.com`
- A compact popup with current-page controls for each product
- Separate Native Scroll and No Autoplay settings with direct switching between them
- A toolbar icon that changes only after either product intervenes on the current page
- Natural en-US and zh-CN interfaces with system-aware light and dark themes
- Event-driven runtimes without polling or a persistent background page
- Fully local operation with no analytics or network requests

## Install

1. Clone or download this repository.
2. Open `chrome://extensions` in Chrome.
3. Enable **Developer mode**.
4. Select **Load unpacked** and choose the [`extension`](extension) folder.

Chrome requests access to HTTP and HTTPS pages because both protections must start before ordinary website scripts.

## Use

The popup contains one row for Native Scroll and one for No Autoplay. Each row provides:

- **Power** to turn that product on or off globally
- **Lightning** to enable or disable Strong protection for the current hostname
- **Website** to add or remove the current hostname from that product's whitelist
- **Settings** to open the corresponding settings page

The product icon turns green when that protection applies to the current page. The main Cosmic Gemini mark remains unchanged in the popup. The small toolbar icon changes after either product actually suppresses page behavior.

### Website rules

`example.com` matches that hostname only. `*.example.com` matches the root domain and all of its subdomains. The popup adds exact hostname rules; Settings also accepts wildcard rules. A whitelist rule takes priority over a Strong-site rule.

### Temporary sound permission

**Allow this time** applies to the current hostname until all of its pages are closed or two days have passed, whichever happens first. Temporary permission is then deleted automatically. **Always allow** creates a rule that remains available in No Autoplay settings until you remove it.

## Privacy

Cosmic Gemini runs entirely on your device. It stores only product settings and website rules you choose, plus temporary sound permission while it remains valid. It does not keep browsing history or an activity log, use analytics, or make network requests. Stored rules contain hostnames rather than complete URLs.

## Compatibility

Cosmic Gemini targets Chrome 120 or later on macOS, Windows, and Linux. Native Scroll is designed around trackpad and wheel behavior; No Autoplay works with HTML media and Web Audio used by ordinary websites.

Chrome prevents extensions from running on internal pages such as `chrome://`, the Chrome Web Store, and some built-in viewers.

## Development

Cosmic Gemini uses Manifest V3 and has no runtime dependencies. See [Technical design](docs/TECHNICAL.md) for the architecture and [Verification](docs/QA.md) for focused checks.

```sh
npm test
npm run check
```

© 2026 Songming.org
