# X Profile Extractor

<p align="center">
  <img src="icons/icon128.png" width="96" alt="X Profile Extractor" />
</p>

<p align="center">
  <b>A clean Chrome extension to pull posts and engagement metrics from any X (Twitter) profile, list, community, or search page — and export them to CSV.</b>
</p>

<p align="center">
  <a href="#install"><img src="https://img.shields.io/badge/Chrome-extension-4c8dff?style=flat-square" /></a>
  <img src="https://img.shields.io/badge/manifest-v3-3fd28a?style=flat-square" />
  <img src="https://img.shields.io/badge/license-MIT-9bb0d6?style=flat-square" />
</p>

---

## What it does

- **Pick any open X tab** from the popup — profile, list, community, search, or feed.
- **Scroll-and-scrape** the visible timeline. Captures text, author, permalink, post time, images, and metrics (views, likes, reposts, replies, bookmarks).
- **Live results dashboard** with totals, sortable cards, and engagement rate per post.
- **Export to CSV** or **copy the JSON** for spreadsheets, dashboards, or LLM workflows.

No backend. No API keys. No analytics. All data stays in your browser.

## Install

1. Download or clone this folder.
2. Open `chrome://extensions` and turn on **Developer mode** (top right).
3. Click **Load unpacked** and select the `X-profile-analyzer/` folder.
4. Pin the **X Profile Extractor** icon to your toolbar.

## Use

1. Open the profile / list / community / search you want to capture in any X.com tab.
2. Click the extension icon, pick that tab from the dropdown, hit **Extract from this tab**.
3. A results dashboard opens in a new tab. It polls the X tab as the timeline scrolls and auto-stops when no new posts appear.
4. Sort, copy text, or **Export CSV**.

> Tip: the extension scrolls the page to pull more posts — keep the X tab visible (or just leave it focused) for best results.

## Permissions

| Permission | Reason |
|---|---|
| `tabs` | List open X tabs in the popup so you can pick one. |
| `scripting` | Inject the content script into the chosen X tab. |
| `storage` | Save extracted posts locally between sessions. |
| `host: x.com / twitter.com` | Read post DOM on those domains only. |

## Files

```
X-profile-analyzer/
├── manifest.json     # MV3 manifest
├── popup.html/css/js # Tab picker UI
├── content.js        # DOM scraper (runs on X tabs)
├── results.html/css/js # Dashboard for extracted posts
├── icons/            # 16/32/48/128 PNGs + source SVG
└── README.md
```

## Roadmap

- [ ] Date range filter on the dashboard
- [ ] Per-author breakdown for community / list pages
- [ ] Optional image thumbnails inline

## License

MIT. Use freely. PRs welcome.
