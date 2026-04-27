# YouTube Transcript to Markdown

[简体中文](README.md) | **English**

[![Release](https://img.shields.io/github/v/release/searchpcc/tube2md?sort=semver)](https://github.com/searchpcc/tube2md/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Build](https://github.com/searchpcc/tube2md/actions/workflows/release.yml/badge.svg)](https://github.com/searchpcc/tube2md/actions/workflows/release.yml)

A Chrome extension that exports a YouTube video's transcript as a clean, structured Markdown file — designed to be fed straight into an LLM (Claude, GPT, …) for summarization, article generation, or analysis.

Available in English and 简体中文 — the popup follows your browser's locale.

<p align="center">
  <img src="docs/screenshots/demo.gif" alt="Extracting a YouTube transcript: open popup, pick options, download as Markdown" width="720" />
</p>

## What makes it different

Most "YouTube transcript" extensions hand you a wall of cue text and call it done. This one tries to give you something an LLM can actually work with:

- **YAML frontmatter with metadata.** Channel, channel ID, publish date, duration, language, caption type (ASR vs human), and chapter list — all up top so LLMs can ground their output.
- **Chapter-aware structure.** When YouTube exposes chapters (or the creator put an OUTLINE in the description), each chapter becomes a `### Heading` and paragraphs are grouped accordingly.
- **Speaker turn detection.** Podcast-style `- ` speaker turn markers (including rapid mid-cue back-and-forth) become paragraph breaks, so dialogue reads naturally.
- **Description trimming.** Sponsor blocks, social links, and outline duplicates are stripped so they don't pollute LLM context budget.
- **Functional-boundary detection.** Popup probes the page first; if there's no caption track, the Extract button is disabled with a clear message — no wasted clicks.
- **Auto-opens the transcript panel.** Three fallback strategies cover every YouTube layout variant; supports both the legacy and the new "modern transcript view" renderer.
- **Sensible filenames.** Downloads as `YYYYMMDD-title-slug-videoId.md` — sortable by date, scannable by title, unique by ID.

Pure DOM scraping. No external API calls. No telemetry. Works offline once the page is loaded.

## Install (unpacked, for now)

1. Clone or download this repo.
2. Visit `chrome://extensions`, enable **Developer mode** (top right).
3. Click **Load unpacked** and select the repo's root directory.

Tagged release zips are on the [Releases](../../releases) page.

> Chrome Web Store listing is planned — gathering some real-world usage feedback first before going through review.

## Use

### Quick start

1. Open a YouTube video (`youtube.com/watch?v=…`).
2. Click the extension icon. The popup probes the page; the **Extract transcript** button enables only when the video actually has caption tracks.
3. (Optional) Pick a caption language from the **Language** dropdown — only shown when the video has more than one track.
4. Pick **Download .md** or **Copy to clipboard**, choose a paragraph gap, hit **Extract transcript**.

<p align="center">
  <img src="docs/screenshots/popup.png" alt="Extension popup" width="320" />
</p>

The status line at the bottom (`Detected N caption track(s). Ready to extract.`) is the green light — if it shows an error in red, the button stays disabled and the message tells you what to do (refresh the tab, open transcript manually, etc.). Popup language follows your browser locale (English / 简体中文); the screenshot above is from a `zh_CN` browser.

### What each control does

- **Output** — `Download .md` saves a file named `YYYYMMDD-title-slug-videoId.md` to your default download folder. `Copy to clipboard` writes the same Markdown straight to the clipboard, which is handy for pasting into a chat with Claude / ChatGPT.
- **Language** — appears only when the video has multiple caption tracks. Defaults to English (preferring human-uploaded over auto-generated), then falls back to whatever language the YouTube transcript panel is currently showing. Auto-generated tracks are tagged `(auto-generated)` in the dropdown.
- **Paragraph gap** — controls how aggressively cues are merged into paragraphs. Cues separated by a silence gap **smaller than this value** stay in the same paragraph; gaps larger than this value start a new paragraph.
  - **Dialogue** (2.5s) — default; good for podcasts and interviews where speakers swap turns.
  - **Solo** (3.5s) — single-speaker talks, lectures, monologues.
  - **Fast** (1.8s) — fast-talking creators, news, rapid-fire vlogs.
  - **Slow** (5.0s) — slow-paced explainer videos, meditation, ASMR, etc.
  - You can also type any value (0.5–60s) into the **Now** field directly.
- **Extract transcript** — runs the extraction. While it's working, the status line walks through `Opening transcript panel… → Parsing N segments… → Rendering N paragraphs… → Saving…` so you know it's not stuck.

### What happens behind the scenes

When you hit Extract, the extractor injected into the YouTube tab will:

1. Auto-open the transcript panel if it's not already open. It tries the description-area "Show transcript" button first, falls back to expanding the description, and finally to the video's ⋯ "More actions" menu.
2. (If you picked a non-default language) Switch the caption track via the panel's language picker.
3. Read every cue from the panel, strip noise markers (`[Music]`, `[Applause]`, …), detect speaker-turn dashes, and merge cues into paragraphs by timestamp gap.
4. Pull video metadata (channel, publish date, duration, chapters) from `getPlayerResponse()` and assemble the final Markdown.

The panel it reaches into looks like this — you don't have to open it yourself, but it's useful to recognize when debugging:

<p align="center">
  <img src="docs/screenshots/transcript-panel.png" alt="YouTube transcript panel" width="420" />
</p>

### Output preview

A finished `.md` file (here, a Lex Fridman podcast episode) opens with YAML frontmatter, the chapter outline, then the trimmed Description and chapter-grouped Transcript:

<p align="center">
  <img src="docs/screenshots/output-md.png" alt="Generated Markdown preview" width="420" />
</p>

Full structure:

```markdown
---
videoId: "VIDEO_ID"
url: "https://www.youtube.com/watch?v=VIDEO_ID"
title: "..."
channel: "..."
channelId: "UC..."
publishDate: "2026-04-15T..."
durationSec: 5400
language: "English"
languageCode: "en"
captionKind: "standard"
chapters:
  - "0:00 — Introduction"
  - "5:36 — Origin story"
  - ...
---

# Video title

## Description

[video description, with sponsor / social blocks trimmed]

## Transcript

### Introduction

- First speaker turn...

- Second speaker turn...

### Origin story

...
```

Then pipe it into your LLM of choice:

```bash
cat 20260415-video-title-VIDEO_ID.md | claude -p "Write a 3-paragraph summary"
```

## Privacy

This extension does not make any network requests. It reads YouTube's already-loaded page state (player response, transcript panel DOM) entirely client-side. Nothing is sent to any third-party server. There is no telemetry.

The only permissions requested are `scripting` + `activeTab` — needed so the extractor can run on the current YouTube tab when you click the extension icon. The host permission is restricted to `https://www.youtube.com/*`.

Full policy: [PRIVACY.md](PRIVACY.md).

## Project layout

```
manifest.json         # MV3 manifest (i18n'd via __MSG_*__)
popup.html / .js      # Popup UI: caption-boundary probe, language picker,
                      #   staged progress feedback
extractor.js          # Injected into the YouTube tab's MAIN world
icons/                # 16/32/48/64/128/256/512 PNGs
_locales/
  en/messages.json    # default
  zh_CN/messages.json
.github/workflows/
  release.yml         # Builds & publishes a GitHub Release on `v*` tag push
docs/screenshots/     # README assets — not bundled into the published zip
```

The extractor runs in the page's MAIN world so it can read `document.querySelector('#movie_player').getPlayerResponse()` directly. It has no access to `chrome.i18n`, so it returns error **keys** (not strings) and the popup translates them.

## Development

No build step. Edit the source, then click the reload icon on the extension card in `chrome://extensions`.

Gotchas:

- `chrome.scripting.executeScript({func})` serializes the function via `.toString()`, so the extractor must be self-contained — no closures over popup-scope symbols. All helpers are defined inside the main `extractAndDeliver` function body.
- The `ytd-video-description-transcript-section-renderer` has a `ytd-button-renderer` that wraps the real `<button>`. Always drill to the innermost `<button>` before `.click()` — clicking the wrapper is a no-op.
- YouTube has TWO coexisting segment renderers as of 2026: the legacy `ytd-transcript-segment-renderer` and the newer `transcript-segment-view-model`. Selectors are unioned (`'old, new'`) to support both.
- The new "modern transcript view" panel has no language dropdown in DOM — to switch caption language for those videos, use the player's gear icon → Subtitles, then re-extract.

## Releasing

Tag-driven via `.github/workflows/release.yml`:

1. Bump `version` in `manifest.json`.
2. Add an entry to [CHANGELOG.md](CHANGELOG.md).
3. `git tag v<version> && git push --tags`.

The workflow verifies the tag matches `manifest.json` and publishes a zip to the GitHub Release.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Bug reports work best when they include the failing video URL + DevTools `[tube2md]` console logs — the bug template enforces this.

## Security

See [SECURITY.md](SECURITY.md) for responsible disclosure.

## License

MIT. See [LICENSE](LICENSE).
