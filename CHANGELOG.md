# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Pre-1.0 means breaking changes can ship in minor versions.

## [0.1.0] — 2026-04-26

First public release.

### Output

- LLM-friendly Markdown with YAML frontmatter (`videoId`, `url`, `title`, `channel`, `channelId`, `publishDate`, `durationSec`, `language`, `languageCode`, `captionKind`, `chapters`).
- Chapter-aware structure: each YouTube chapter becomes a `### Heading` with grouped paragraphs.
- Speaker turn detection: cue-start `- ` (and en/em-dash variants) plus mid-cue `[.?!] - ` boundaries become paragraph breaks for podcast-style transcripts.
- Description boilerplate trimming: `*SPONSORS:*` / `*OUTLINE:*` / `*PODCAST LINKS:*` / `*SOCIAL LINKS:*` / `TIMESTAMPS` / `CHAPTERS` sections are stripped.
- Description / Transcript section split with a `## Description` and `## Transcript` heading.
- Sensible filenames: `YYYYMMDD-title-slug-videoId.md`.
- Noise filter for `[Music]` / `[Applause]` / `[音乐]` / `[掌声]` / `[음악]` / etc. across English, Chinese, Japanese, Korean.

### Robustness

- Supports YouTube's new "modern transcript view" renderer (`transcript-segment-view-model`) alongside the legacy `ytd-transcript-segment-renderer`.
- Three-strategy parser for the modern renderer: class-based query → ARIA-based query → line-split fallback.
- Auto-retry on first-click panel load (YouTube lazy-loads the transcript module on the first click).
- Three-fallback strategy for opening the transcript panel: dedicated description section → expand collapsed description → ⋯ menu.
- Chapter detection: structured `playerResponse` markers first, falls back to parsing `M:SS - title` lines from the description.

### UX

- Caption language picker (defaults to English when available; falls back to YouTube panel current / audio-track default / browser UI language).
- Staged progress feedback in popup status line: opening → switching language → parsing → rendering → saving.
- English and 简体中文 UI; popup follows browser locale.

### Privacy

- Zero network requests. Pure DOM scraping.
- Permissions: `scripting`, `activeTab`. Host: `https://www.youtube.com/*`. No `content_scripts`, no remote code, no telemetry.

[0.1.0]: https://github.com/searchpcc/tube2md/releases/tag/v0.1.0
