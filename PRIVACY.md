# Privacy Policy

_Last updated: 2026-04-27_

## Summary

The YouTube Transcript to Markdown extension ("the extension") does not collect, store, or transmit any user data. All processing happens locally inside your browser.

## What the extension reads

When you click the extension icon on a YouTube watch page and press **Extract**, the extension reads, only at that moment, only from the tab you are currently viewing:

- Page video metadata via `getPlayerResponse()` — video ID, title, channel name and ID, publish date, duration, chapter list, caption track list.
- The video description (from the same response).
- The transcript panel DOM, after auto-opening it if it is not already open.

## What the extension does with that data

Assembles a Markdown file and either:

- saves it to your computer's downloads folder (Download .md mode), or
- writes it to your system clipboard (Copy to clipboard mode).

That is the entire data flow. No copy is kept anywhere else.

## What the extension does NOT do

- No network requests of any kind. No remote API calls, no telemetry, no analytics, no error reporting.
- No persistent storage. No use of `chrome.storage`, cookies, `localStorage`, or `IndexedDB`.
- No background scripts or service workers.
- No content scripts. The extractor is injected only when you explicitly click the extension icon and press Extract (this is what the `activeTab` permission enforces).
- No execution on any site other than `https://www.youtube.com/*` (enforced by `host_permissions` in `manifest.json`).
- No data shared with third parties. There are no third parties involved.

## Permissions

| Permission | Why it is needed |
|---|---|
| `scripting` | To inject the extractor function into the active YouTube tab when you click Extract. |
| `activeTab` | Limits script injection to the tab you currently have open, only at the moment you click. |
| `host_permissions: https://www.youtube.com/*` | Restricts where the extension may run to YouTube only. |

## Open source

Full source is at <https://github.com/searchpcc/tube2md>. The privacy claims above can be verified by reading `extractor.js`, `popup.js`, and `manifest.json` directly.

## Contact

Questions or concerns: munafik.setan@gmail.com
