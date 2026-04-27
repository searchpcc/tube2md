import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  legacyMonologue,
  modernMonologue,
  dialogueWithTurns,
  withDescriptionChapters,
  withSponsorBlock,
} from './fixtures.js';

const run = async (dom, opts = {}) => {
  const args = { action: 'copy', gap: 3.0, ...opts };
  const result = await dom.window.extractAndDeliver(args);
  return { result, md: dom.window.__TUBE2MD__?.markdown || '' };
};

test('legacy renderer parses cues and produces frontmatter', async () => {
  const dom = legacyMonologue();
  const { result, md } = await run(dom);

  assert.equal(result.ok, true, `expected ok, got ${JSON.stringify(result)}`);
  assert.ok(md.startsWith('---\n'), 'output should start with YAML frontmatter');
  assert.match(md, /videoId: "TEST123"/);
  assert.match(md, /title: "A Test Video"/);
  assert.match(md, /channel: "Test Channel"/);
  assert.match(md, /durationSec: 600/);
  assert.match(md, /## Transcript/);
  assert.match(md, /Hello and welcome/);
  assert.match(md, /parser tests/);
});

test('modern renderer parses cues via Strategy A (class-based)', async () => {
  const dom = modernMonologue();
  const { result, md } = await run(dom);

  assert.equal(result.ok, true, `expected ok, got ${JSON.stringify(result)}`);
  assert.match(md, /Modern renderer test cue one/);
  assert.match(md, /Modern renderer test cue two/);
});

test('dialogue with mid-cue "- " starts a new paragraph per turn', async () => {
  const dom = dialogueWithTurns();
  const { result, md } = await run(dom);

  assert.equal(result.ok, true);
  // Body of the transcript is everything after "## Transcript\n\n".
  const body = md.split('## Transcript\n\n')[1] || '';
  const paragraphs = body.trim().split(/\n\n+/).filter(Boolean);
  // Expected turns: "Welcome..." / "Today..." / "Thanks..." / "My pleasure." / "So tell me..."
  assert.ok(
    paragraphs.length >= 4,
    `expected >=4 paragraphs from 4 turns, got ${paragraphs.length}: ${JSON.stringify(paragraphs)}`,
  );
  assert.ok(paragraphs.some((p) => p.includes('Thanks for having me')));
  assert.ok(paragraphs.some((p) => p.startsWith('- My pleasure') || p.includes('My pleasure')));
});

test('chapters parsed from description split transcript into ### sections', async () => {
  const dom = withDescriptionChapters();
  const { result, md } = await run(dom);

  assert.equal(result.ok, true);
  // Frontmatter chapters list.
  assert.match(md, /chapters:/);
  assert.match(md, /Introduction/);
  assert.match(md, /Origin story/);
  // Transcript body has the 3 chapter headings.
  assert.match(md, /### Introduction/);
  assert.match(md, /### Origin story/);
  assert.match(md, /### Closing thoughts/);
});

test('description boilerplate (*SPONSORS:* ...) is trimmed', async () => {
  const dom = withSponsorBlock();
  const { result, md } = await run(dom);

  assert.equal(result.ok, true);
  const descSection = md.split('## Description\n\n')[1].split('## Transcript')[0];
  assert.match(descSection, /Real description content that should survive/);
  assert.doesNotMatch(descSection, /SPONSORS/);
  assert.doesNotMatch(descSection, /SOCIAL LINKS/);
  assert.doesNotMatch(descSection, /Brand A/);
});

test('returns errNoCues when transcript panel has no segments', async () => {
  const { createDom, attachPlayerResponse } = await import('./fixtures.js');
  const dom = createDom();
  dom.window.document.body.innerHTML = '<div id="movie_player"></div>';
  attachPlayerResponse(dom, {
    videoDetails: {
      videoId: 'EMPTY1', title: 'Empty', author: '', channelId: '', lengthSeconds: '0', shortDescription: '',
    },
    microformat: { playerMicroformatRenderer: { publishDate: '' } },
  });
  // The opener will give up (no buttons to find) and we'll get errPanelNotOpen.
  const result = await dom.window.extractAndDeliver({ action: 'copy', gap: 3.0 });
  assert.equal(result.ok, false);
  assert.ok(
    result.errorKey === 'errPanelNotOpen' || result.errorKey === 'errNoCues',
    `expected errPanelNotOpen or errNoCues, got ${result.errorKey}`,
  );
});
