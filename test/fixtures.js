// Synthetic minimum-viable DOM fixtures for the extractor.
//
// These are NOT scraped from real YouTube pages — they're the minimum DOM that
// the parser needs to walk. Goal: catch DOM-drift regressions early (selector
// renames, structural changes) without committing to maintaining real-page
// snapshots that would themselves go stale.

import { JSDOM } from 'jsdom';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXTRACTOR_SRC = fs.readFileSync(
  path.join(__dirname, '..', 'extractor.js'),
  'utf8',
);

export function createDom() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'https://www.youtube.com/watch?v=TEST123',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  });

  // Stub navigator.clipboard so action='copy' succeeds (jsdom has no clipboard
  // implementation; without this the extractor falls through to the
  // execCommand path which also no-ops, then returns errClipboardBlocked).
  Object.defineProperty(dom.window.navigator, 'clipboard', {
    value: { writeText: async () => {} },
    configurable: true,
  });

  // Define extractAndDeliver in the jsdom realm. The function is a top-level
  // declaration in extractor.js so window.eval is enough to expose it.
  dom.window.eval(EXTRACTOR_SRC);

  return dom;
}

export function attachPlayerResponse(dom, pr) {
  const mp = dom.window.document.querySelector('#movie_player');
  if (!mp) throw new Error('fixture must include <div id="movie_player"> first');
  mp.getPlayerResponse = () => pr;
}

const DEFAULT_PR = {
  videoDetails: {
    videoId: 'TEST123',
    title: 'A Test Video',
    author: 'Test Channel',
    channelId: 'UCTESTCHANNEL',
    lengthSeconds: '600',
    shortDescription: 'A short description for testing.',
  },
  microformat: {
    playerMicroformatRenderer: { publishDate: '2026-04-27' },
  },
};

// Fixture A: legacy ytd-transcript-segment-renderer, single speaker, no chapters.
export function legacyMonologue() {
  const dom = createDom();
  const segs = [
    { ts: '0:00', text: 'Hello and welcome to the test video.' },
    { ts: '0:02', text: "Today we're talking about parser tests." },
    { ts: '0:10', text: 'Specifically, why DOM scraping is fragile.' },
  ];
  dom.window.document.body.innerHTML =
    '<div id="movie_player"></div>' +
    segs.map((s) => `<ytd-transcript-segment-renderer>${s.ts} ${s.text}</ytd-transcript-segment-renderer>`).join('');
  attachPlayerResponse(dom, DEFAULT_PR);
  return dom;
}

// Fixture B: modern transcript-segment-view-model renderer.
export function modernMonologue() {
  const dom = createDom();
  const segs = [
    { ts: '0:00', text: 'Modern renderer test cue one.' },
    { ts: '0:03', text: 'Modern renderer test cue two.' },
  ];
  dom.window.document.body.innerHTML =
    '<div id="movie_player"></div>' +
    segs.map(
      (s) => `
      <transcript-segment-view-model>
        <span class="ytwTranscriptSegmentViewModelTimestamp" aria-hidden="true">${s.ts}</span>
        <span class="ytAttributedStringHost" role="text">${s.text}</span>
      </transcript-segment-view-model>`,
    ).join('');
  attachPlayerResponse(dom, DEFAULT_PR);
  return dom;
}

// Fixture C: dialogue with mid-cue speaker turns ("Yeah. - Right.").
export function dialogueWithTurns() {
  const dom = createDom();
  const segs = [
    { ts: '0:00', text: '- Welcome to the show.' },
    { ts: '0:02', text: 'Today my guest is Alice.' },
    { ts: '0:05', text: '- Thanks for having me. - My pleasure.' },
    { ts: '0:08', text: '- So tell me about your work.' },
  ];
  dom.window.document.body.innerHTML =
    '<div id="movie_player"></div>' +
    segs.map((s) => `<ytd-transcript-segment-renderer>${s.ts} ${s.text}</ytd-transcript-segment-renderer>`).join('');
  attachPlayerResponse(dom, DEFAULT_PR);
  return dom;
}

// Fixture D: legacy renderer with chapters in description (Lex Fridman-style OUTLINE).
export function withDescriptionChapters() {
  const dom = createDom();
  const segs = [
    { ts: '0:00', text: 'Intro segment.' },
    { ts: '1:00', text: 'First chapter content.' },
    { ts: '2:00', text: 'Second chapter content.' },
  ];
  dom.window.document.body.innerHTML =
    '<div id="movie_player"></div>' +
    segs.map((s) => `<ytd-transcript-segment-renderer>${s.ts} ${s.text}</ytd-transcript-segment-renderer>`).join('');
  const pr = JSON.parse(JSON.stringify(DEFAULT_PR));
  pr.videoDetails.shortDescription =
    'Some intro text.\n\n' +
    '0:00 - Introduction\n' +
    '1:00 - Origin story\n' +
    '2:00 - Closing thoughts\n';
  attachPlayerResponse(dom, pr);
  return dom;
}

// Fixture E: description with SPONSORS boilerplate that should be trimmed.
export function withSponsorBlock() {
  const dom = createDom();
  dom.window.document.body.innerHTML =
    '<div id="movie_player"></div>' +
    '<ytd-transcript-segment-renderer>0:00 Just one cue here.</ytd-transcript-segment-renderer>';
  const pr = JSON.parse(JSON.stringify(DEFAULT_PR));
  pr.videoDetails.shortDescription =
    'Real description content that should survive.\n\n' +
    '*SPONSORS:*\n- Brand A (https://example.com)\n- Brand B (https://example.com)\n\n' +
    '*SOCIAL LINKS:*\n- Twitter: @x\n';
  attachPlayerResponse(dom, pr);
  return dom;
}
