# Contributing

Thanks for your interest. The project is small and the maintainer doesn't have huge bandwidth, so a few notes will keep things efficient.

## Reporting a bug

The most common bug is "YouTube changed a DOM tag name". To report effectively:

1. **Use the bug template** (it asks for the right things automatically).
2. **Include the video URL.** Reproducibility is everything for DOM-scraping bugs — without a specific video, hard to act on.
3. **Include Chrome version + OS.** Different builds occasionally have different DOM.
4. **Include `[tube2md]` console logs.** Open DevTools → Console (filter by `tube2md`) → reproduce → paste output.
5. **If a selector failed, share what you found.** The bug template includes a one-liner JS snippet to dump transcript-related custom element tag names — running it and pasting the output makes any fix a 1-line change.

## Suggesting a feature

Open an issue describing the use case ("when I'm trying to X, I want Y because Z") before any PR. Out-of-scope as a heuristic: anything that would require remote API calls, third-party services, or `content_scripts` injection — the privacy minimalism is intentional.

## Code style

- **No build step**, no transpilation, no framework. Plain ES2020+, plain CSS, plain HTML.
- **`extractor.js` runs in the YouTube tab's MAIN world.** It must be **fully self-contained** — `chrome.scripting.executeScript({func})` serializes via `.toString()`, so closures over popup symbols won't work. Define helpers inside the main `extractAndDeliver` function body.
- **`extractor.js` has no `chrome.i18n` access.** Return semantic error keys (`{errorKey, errorArgs}`) and let `popup.js` translate via `chrome.i18n.getMessage`.
- **New i18n strings go in BOTH** `_locales/en/messages.json` and `_locales/zh_CN/messages.json`.
- **For DOM selectors that target YouTube elements, prefer comma-OR'd lists** to support multiple coexisting layouts (e.g. `'old-tag, new-tag'`). YouTube ships variants for weeks during rollouts.
- **Don't add `console.log`** for ephemeral debugging — leave only `[tube2md]`-tagged informational logs that help users self-diagnose.

## Local development

```bash
git clone https://github.com/searchpcc/tube2md.git
cd tube2md
# Open chrome://extensions, enable Developer mode, Load unpacked → this directory
```

After editing, click the reload icon on the extension card. If you change `manifest.json` or files in `_locales/`, the popup also needs to be closed and reopened.

The extension itself has no Node dependencies, but lint + tests do. Install once:

```bash
npm install
```

Then before opening a PR:

```bash
npm run lint   # ESLint flat config (eslint.config.js)
npm test       # jsdom black-box parser tests against synthetic DOM fixtures
```

CI (`.github/workflows/ci.yml`) runs both on every PR — local pass means CI pass.

To produce a release-shaped zip locally:

```bash
npm run package   # writes tube2md.zip with the same files .github/workflows/release.yml ships
```

## Pull requests

- One concern per PR. Easier to review, easier to revert.
- Update `CHANGELOG.md` under an `[Unreleased]` heading (create one at the top if it doesn't exist).
- If you add a new i18n string, add it to **both** `_locales/en/messages.json` and `_locales/zh_CN/messages.json`. Missing keys fall through to the key name as fallback, which is ugly.
- If you change selector logic, mention which YouTube layout / video URL you tested against.

## Releases (maintainer-only)

1. Bump `version` in `manifest.json`.
2. Move `[Unreleased]` notes in `CHANGELOG.md` under a new `## [x.y.z] — YYYY-MM-DD` heading, add release-link footnote at bottom.
3. Commit, then `git tag vx.y.z && git push origin main --tags`.
4. `.github/workflows/release.yml` verifies the tag matches `manifest.json` version, packages a zip, and publishes a GitHub Release.
