# Security Policy

This is a Chrome extension that runs scripts inside YouTube tabs. The attack surface is intentionally small (no network requests, no `content_scripts`, minimal permissions: `scripting` + `activeTab` + a single host of `https://www.youtube.com/*`), but please report security issues responsibly.

## Reporting a vulnerability

**Do not open a public GitHub issue for security issues.** Instead, email **munafik.setan@gmail.com** with:

- A clear description of the issue.
- Steps to reproduce.
- Affected Chrome version(s) if relevant.
- Your assessment of impact.

You'll get an acknowledgment within 7 days. Coordinated disclosure is appreciated — please give a reasonable window before going public.

## Scope

In scope:

- The extension's own code (`extractor.js`, `popup.js`, `popup.html`, `manifest.json`, `_locales/*`).
- Permission misuse, escalation, or scope creep.
- Data leakage from the extension to remote endpoints (the extension should make zero network requests; if it ever does, that's a bug).
- XSS via downloaded Markdown content (e.g., crafted captions / descriptions injecting executable script into the popup or anywhere else).

Out of scope:

- YouTube's own bugs or DOM changes that break extraction — those are functional issues, file a public bug.
- Browser-level vulnerabilities — report to Chromium / Mozilla directly.
- Issues requiring local code execution / a compromised browser / a malicious extension already installed.

## Disclosure timeline

Once a fix is ready, a release will go out and the security advisory will be published on GitHub. Reporters who request credit will be acknowledged in the CHANGELOG.
