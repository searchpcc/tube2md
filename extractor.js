/**
 * Injected into the YouTube tab's MAIN world by popup.js.
 *
 * Must be fully self-contained — `chrome.scripting.executeScript({func})`
 * serializes via `.toString()`, so closures over popup-scope symbols would
 * break. All helpers therefore live inside the function body.
 *
 * MAIN world has no access to `chrome.i18n`, so errors and progress are
 * returned as semantic keys (`{errorKey, errorArgs}` / `{phase, data}`) and
 * popup.js translates them via `chrome.i18n.getMessage`.
 *
 * Progress ticks: `window.__TUBE2MD_PROGRESS__ = {phase, data, ts}`. Cleared
 * to `null` at the end of a successful run. Popup polls this every ~250ms
 * during the executeScript call.
 *
 * Strategy: scrape the rendered transcript panel DOM. Pure DOM, no network
 * requests. Output is LLM-friendly Markdown with YAML frontmatter, a
 * Description section (verbatim from videoDetails), and a Transcript section
 * split into `### Chapter` subsections when YouTube exposes chapter markers.
 */
// eslint-disable-next-line no-unused-vars -- read by popup.js via chrome.scripting.executeScript({func:extractAndDeliver})
async function extractAndDeliver({ action, gap, targetLabel, targetLanguageCode, targetKind }) {
  const TAG = '[tube2md]';
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const result = (extra) => ({ ok: true, action, ...extra });
  const err = (errorKey, errorArgs) => {
    window.__TUBE2MD_PROGRESS__ = null;
    return { ok: false, action, errorKey, errorArgs };
  };
  const setProgress = (phase, data) => {
    window.__TUBE2MD_PROGRESS__ = { phase, data: data || {}, ts: Date.now() };
  };

  setProgress('starting');

  const urlVideoId = new URL(location.href).searchParams.get('v');
  const mp = document.querySelector('#movie_player');
  let pr = null;
  try { pr = mp?.getPlayerResponse?.() || null; } catch (_) {}
  const vd = pr?.videoDetails || {};
  const videoId = vd.videoId || urlVideoId;
  const title = (vd.title || document.title.replace(/\s*[-–—]\s*YouTube\s*$/, '') || 'untitled').trim();
  if (!videoId) return err('errNoVideoId');

  const rawPublish =
    pr?.microformat?.playerMicroformatRenderer?.publishDate ||
    pr?.microformat?.playerMicroformatRenderer?.uploadDate ||
    '';
  const ymd = (rawPublish.match(/\d{4}-\d{2}-\d{2}/)?.[0] || '').replace(/-/g, '');

  const slugifyTitle = (s) => {
    let t = (s || '').trim().toLowerCase().replace(/\s+/g, ' ');
    t = t.replace(/[^\p{Letter}\p{Number}\-_]+/gu, '-');
    t = t.replace(/-+/g, '-').replace(/^-+|-+$/g, '');
    const chars = [...t];
    if (chars.length > 60) t = chars.slice(0, 60).join('').replace(/-+$/g, '');
    return t;
  };
  const titleSlug = slugifyTitle(title);
  const filename = `${[ymd, titleSlug, videoId].filter(Boolean).join('-')}.md`;

  // Strip boilerplate sections from description: SPONSORS / OUTLINE / PODCAST
  // LINKS / SOCIAL LINKS / TIMESTAMPS / CHAPTERS — these dilute LLM context
  // budget without informational value (and OUTLINE duplicates our chapter
  // headings). Conservative: only known section markers, otherwise leave the
  // description intact.
  const trimDescription = (desc) => {
    if (!desc) return desc;
    const markers = [
      /^\*?SPONSORS:\*?\s*$/m,
      /^\*?OUTLINE:\*?\s*$/m,
      /^\*?PODCAST LINKS:\*?\s*$/m,
      /^\*?SOCIAL LINKS:\*?\s*$/m,
      /^\*?TIMESTAMPS?:\*?\s*$/m,
      /^\*?CHAPTERS?:\*?\s*$/m,
    ];
    let cutAt = desc.length;
    for (const re of markers) {
      const m = desc.match(re);
      if (m && typeof m.index === 'number' && m.index < cutAt) cutAt = m.index;
    }
    return desc.slice(0, cutAt).trim();
  };

  // Format seconds → "M:SS" (or "H:MM:SS" for >=1h). For chapter labels in
  // frontmatter — same shape YouTube's own outline uses.
  const formatTs = (sec) => {
    const total = Math.max(0, Math.floor(Number(sec) || 0));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return h > 0
      ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
      : `${m}:${String(s).padStart(2, '0')}`;
  };

  // YouTube has two coexisting renderer names (rolled out gradually): the
  // legacy `ytd-transcript-segment-renderer` and the newer "modern view"
  // `transcript-segment-view-model`. Comma in querySelectorAll = OR, so we
  // catch either; old & new videos both work.
  const getSegments = () => document.querySelectorAll(
    'ytd-transcript-segment-renderer, transcript-segment-view-model'
  );

  // Modern view runs in a different panel that has no language dropdown in
  // DOM. We detect by presence of any modern-view segment and adapt: skip
  // switchPanelLanguage entirely (panel-driven switch impossible) and trust
  // popup-passed targetLanguageCode for frontmatter.
  const isModernRenderer = () =>
    document.querySelectorAll('transcript-segment-view-model').length > 0;

  const TRANSCRIPT_LABELS = [
    'show transcript', 'open transcript', 'transcript',
    '显示文字稿', '显示字幕', '显示转写', '文字稿',
    '顯示文字記錄', '文字記錄', '文字記錄を表示', '文字起こしを表示',
    'transkript anzeigen', 'afficher la transcription', 'mostrar transcripción',
  ];
  const matchTranscriptText = (raw) => {
    const txt = (raw || '').trim().toLowerCase();
    if (!txt || txt.length > 40) return false;
    return TRANSCRIPT_LABELS.some((l) => txt === l || txt.startsWith(l));
  };
  const innerButton = (el) => {
    if (!el) return null;
    if (el.tagName === 'BUTTON') return el;
    return el.querySelector('button') || el;
  };
  const findTranscriptButton = () => {
    const section = document.querySelector('ytd-video-description-transcript-section-renderer');
    if (section) {
      const b = section.querySelector('button');
      if (b) return b;
      const wrap = section.querySelector('yt-button-shape, ytd-button-renderer, tp-yt-paper-button');
      if (wrap) return innerButton(wrap);
    }
    const nodes = document.querySelectorAll(
      'button, ytd-button-renderer, tp-yt-paper-button, yt-button-shape, a[role="button"], tp-yt-paper-item, ytd-menu-service-item-renderer'
    );
    const match = [...nodes].find((b) => {
      const label = b.getAttribute?.('aria-label');
      return matchTranscriptText(label) || matchTranscriptText(b.innerText || b.textContent);
    });
    return innerButton(match);
  };

  const waitFor = async (pred, { tries = 50, interval = 100 } = {}) => {
    for (let i = 0; i < tries; i++) {
      if (pred()) return true;
      await sleep(interval);
    }
    return pred();
  };

  const isVisible = (el) =>
    !!el && (el.offsetParent !== null || el.getBoundingClientRect().height > 0);

  const expandDescription = async () => {
    const desc =
      document.querySelector('#description-inline-expander') ||
      document.querySelector('#description');
    if (desc) {
      desc.scrollIntoView({ block: 'center' });
      await sleep(200);
    }
    const selectors = [
      '#description-inline-expander tp-yt-paper-button#expand',
      'ytd-text-inline-expander#description-inline-expander #expand',
      '#description tp-yt-paper-button#expand',
      'ytd-text-inline-expander #expand',
      'tp-yt-paper-button#expand',
    ];
    for (const sel of selectors) {
      for (const el of document.querySelectorAll(sel)) {
        if (isVisible(el)) {
          el.click();
          await sleep(250);
          return true;
        }
      }
    }
    return false;
  };

  const openTranscriptViaMenu = async () => {
    const menuTriggers = document.querySelectorAll(
      'ytd-watch-metadata #actions ytd-menu-renderer yt-button-shape button, ' +
      'ytd-watch-metadata ytd-menu-renderer button[aria-label], ' +
      '#top-level-buttons-computed + ytd-menu-renderer button, ' +
      'ytd-menu-renderer > yt-icon-button button'
    );
    let opened = false;
    for (const trig of menuTriggers) {
      const aria = (trig.getAttribute('aria-label') || '').toLowerCase();
      if (!aria.includes('more') && !aria.includes('其他') && !aria.includes('更多') && !aria.includes('操作')) continue;
      if (!isVisible(trig)) continue;
      trig.click();
      const gotPopup = await waitFor(
        () => !!document.querySelector('tp-yt-iron-dropdown tp-yt-paper-listbox, ytd-menu-popup-renderer'),
        { tries: 20, interval: 100 }
      );
      if (!gotPopup) continue;
      const item = [...document.querySelectorAll(
        'tp-yt-paper-listbox ytd-menu-service-item-renderer, tp-yt-paper-listbox tp-yt-paper-item, ytd-menu-popup-renderer ytd-menu-service-item-renderer'
      )].find((el) => matchTranscriptText(el.innerText || el.textContent));
      if (item) {
        item.click();
        opened = await waitFor(() => getSegments().length > 0, { tries: 60, interval: 100 });
        if (opened) return true;
      }
      document.body.click();
      await sleep(100);
    }
    return false;
  };

  if (getSegments().length === 0) {
    setProgress('opening');
    console.log(`${TAG} transcript panel not loaded; attempting to open it...`);
    let btn = findTranscriptButton();
    let expanded = false;
    if (!btn) {
      expanded = await expandDescription();
      await waitFor(() => !!findTranscriptButton(), { tries: 30, interval: 100 });
      btn = findTranscriptButton();
    }
    // YouTube lazy-loads the transcript module on first click; sometimes the
    // first click only triggers module load and segments never render. Retry
    // once with a re-found button (the original ref may be stale by now).
    for (let attempt = 0; attempt < 2 && btn; attempt++) {
      btn.scrollIntoView({ block: 'center' });
      await sleep(120);
      btn.click();
      const got = await waitFor(() => getSegments().length > 0, { tries: 80, interval: 100 });
      if (got) break;
      if (attempt === 0) {
        console.log(`${TAG} first click didn't render segments; re-finding button and retrying...`);
        await sleep(300);
        btn = findTranscriptButton();
      }
    }

    if (getSegments().length === 0) {
      console.log(`${TAG} description path failed, trying More-actions menu...`);
      await openTranscriptViaMenu();
    }

    if (getSegments().length === 0) {
      const section = document.querySelector('ytd-video-description-transcript-section-renderer');
      const diag = [
        `btn=${btn ? 'found' : 'missing'}`,
        `section=${section ? 'yes' : 'no'}`,
        `desc-expanded=${expanded}`,
      ].join(' ');
      console.warn(`${TAG} transcript open failed`, { btn, section });
      return err('errPanelNotOpen', [diag]);
    }
  }

  const findLanguageDropdownButton = () => {
    return document.querySelector(
      'ytd-transcript-search-panel-renderer ytd-transcript-footer-renderer tp-yt-paper-button'
    ) || document.querySelector(
      'ytd-transcript-footer-renderer tp-yt-paper-button'
    ) || document.querySelector(
      'ytd-transcript-search-panel-renderer tp-yt-paper-button'
    );
  };

  const readPanelLabel = () => {
    const el = findLanguageDropdownButton();
    if (!el) return '';
    const txt = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
    return txt;
  };

  const normalizeLabel = (s) => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();

  const switchPanelLanguage = async (target) => {
    const want = normalizeLabel(target);
    if (!want) return true;
    if (normalizeLabel(readPanelLabel()) === want) return true;

    const dropdown = findLanguageDropdownButton();
    if (!dropdown) {
      console.warn(`${TAG} language dropdown not found; skipping switch`);
      return false;
    }
    dropdown.scrollIntoView({ block: 'center' });
    await sleep(120);
    dropdown.click();
    const gotMenu = await waitFor(
      () => !!document.querySelector(
        'tp-yt-iron-dropdown tp-yt-paper-listbox tp-yt-paper-item, ' +
        'tp-yt-paper-menu-button tp-yt-paper-listbox tp-yt-paper-item'
      ),
      { tries: 25, interval: 100 }
    );
    if (!gotMenu) {
      console.warn(`${TAG} language menu did not appear`);
      return false;
    }
    const items = [...document.querySelectorAll(
      'tp-yt-iron-dropdown tp-yt-paper-listbox tp-yt-paper-item, ' +
      'tp-yt-paper-menu-button tp-yt-paper-listbox tp-yt-paper-item'
    )];
    const target2 = items.find((it) => normalizeLabel(it.innerText || it.textContent) === want);
    if (!target2) {
      console.warn(`${TAG} language item "${target}" not in menu`, items.map((it) => (it.innerText || '').trim()));
      document.body.click();
      return false;
    }
    const segCountBefore = getSegments().length;
    target2.click();
    await sleep(200);
    await waitFor(() => {
      const after = getSegments().length;
      return after > 0 && (after !== segCountBefore || normalizeLabel(readPanelLabel()) === want);
    }, { tries: 40, interval: 200 });
    return normalizeLabel(readPanelLabel()) === want;
  };

  if (targetLabel && normalizeLabel(readPanelLabel()) !== normalizeLabel(targetLabel)) {
    if (isModernRenderer()) {
      // Modern view's panel has no language dropdown in DOM (verified via
      // diagnostic on Jeff Kaplan video). Switching has to happen via the
      // player's CC settings (gear icon → Subtitles → choose language)
      // BEFORE clicking Extract. We can't drive that from MAIN world without
      // touching player state, so we just log and proceed with whatever YouTube
      // is currently rendering.
      console.warn(
        `${TAG} modern transcript view detected — cannot auto-switch to "${targetLabel}". ` +
        `If the wrong language is in the output, switch it via the player gear icon → Subtitles, then re-extract.`
      );
    } else {
      setProgress('switchingLanguage', { target: targetLabel });
      const ok = await switchPanelLanguage(targetLabel);
      if (!ok) console.warn(`${TAG} continuing with whatever the panel currently shows`);
    }
  }

  const segments = getSegments();
  setProgress('parsing', { count: segments.length });

  const parseTs = (ts) => {
    const parts = ts.split(':').map((n) => parseInt(n, 10));
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    return 0;
  };

  const TS_RE = /^\d{1,2}(?::\d{2}){1,2}$/;

  // Three-strategy parser for the new "modern view" renderer. innerText
  // concatenates 3 child boxes ("0:07\n7秒钟\n- text..."). Strategies layered
  // defensively so that future class renames don't break us all at once:
  //   A. Class-based query (most precise today)
  //   B. ARIA-based query (semantic — `[aria-hidden="true"]` for visible
  //      timestamp + `[role="text"]` for cue text are platform contracts)
  //   C. Line-split heuristic on innerText (last resort)
  const parseModernSegment = (seg) => {
    // Strategy A
    let timeEl = seg.querySelector('.ytwTranscriptSegmentViewModelTimestamp');
    let textEl = seg.querySelector('.ytAttributedStringHost[role="text"], [role="text"]');
    if (timeEl && textEl) {
      const ts = (timeEl.innerText || timeEl.textContent || '').trim();
      const text = (textEl.innerText || textEl.textContent || '').replace(/\s+/g, ' ').trim();
      if (TS_RE.test(ts) && text) return { ts, text };
    }
    // Strategy B
    timeEl = seg.querySelector('[aria-hidden="true"]');
    textEl = seg.querySelector('[role="text"]');
    if (timeEl && textEl) {
      const ts = (timeEl.innerText || timeEl.textContent || '').trim();
      const text = (textEl.innerText || textEl.textContent || '').replace(/\s+/g, ' ').trim();
      if (TS_RE.test(ts) && text) return { ts, text };
    }
    // Strategy C: split innerText by line, find timestamp line + last
    // non-timestamp line as text. Skips the localized A11y label in the middle.
    const lines = (seg.innerText || seg.textContent || '')
      .split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    const tsLine = lines.find((l) => TS_RE.test(l));
    if (!tsLine) return null;
    const remaining = lines.filter((l) => l !== tsLine);
    if (remaining.length === 0) return null;
    const text = remaining[remaining.length - 1].replace(/\s+/g, ' ').trim();
    return text ? { ts: tsLine, text } : null;
  };

  const cues = [];
  let parseFailures = 0;
  for (const seg of segments) {
    let parsed = null;
    if (seg.tagName.toLowerCase() === 'transcript-segment-view-model') {
      parsed = parseModernSegment(seg);
    } else {
      // Legacy ytd-transcript-segment-renderer: timestamp + text concatenated
      // in a single innerText, parsed by regex.
      const txt = (seg.innerText || seg.textContent || '').replace(/ /g, ' ').trim();
      const m = txt.match(/^(\d{1,2}(?::\d{2}){1,2})\s+([\s\S]+)$/);
      if (m) parsed = { ts: m[1], text: m[2].replace(/\s+/g, ' ').trim() };
    }
    if (!parsed || !TS_RE.test(parsed.ts) || !parsed.text) { parseFailures++; continue; }
    cues.push({ timestamp: parsed.ts, start: parseTs(parsed.ts), text: parsed.text });
  }

  if (cues.length === 0) return err('errNoCues', [String(segments.length)]);
  if (parseFailures > 0) console.warn(`${TAG} ${parseFailures} segment(s) did not match the expected format and were skipped`);

  // Noise filter — union of common ASR noise markers across English/Chinese/Japanese/Korean.
  // Caption marker language matches the caption track, not the user UI locale, so we union them all.
  const NOISE_RE = /\[(?:Music|Applause|Laughter|Cheering|Silence|Background\s*noise|Inaudible|sighs|chuckles|coughs|音乐|掌声|笑声|鼓掌|拍手|音效|歓声|拍手喝采|喝采|음악|박수)\]/gi;
  for (const c of cues) {
    c.text = c.text.replace(NOISE_RE, '').replace(/\s+/g, ' ').trim();
  }
  const cleaned = cues.filter((c) => c.text.length > 0);
  if (cleaned.length === 0) return err('errEmptyAfterCleanup');

  // Speaker turn boundary: YouTube's caption convention prefixes a fresh
  // speaker turn with "- " at the start of a cue, but rapid back-and-forth
  // (Lex Fridman-style podcasts) packs multiple turns into a single cue
  // ("Yeah. - You sure?"). We detect both:
  //  (1) cue text starting with "- " / "— " / "– " (en/em-dash variants),
  //  (2) mid-cue "<sentence-ender> + space + dash + space" — split into
  //      sub-turns at those boundaries.
  // Mid-WORD dashes (stutter "th- how", "sh- shit") don't match: we require
  // both a sentence-ender BEFORE and whitespace AFTER the dash.
  const isTurnStart = (s) => /^[-—–]\s/.test(s);
  const splitOnTurns = (text) => text.split(/(?<=[.?!])\s+(?=[-—–]\s)/);

  const GAP = typeof gap === 'number' && gap > 0 ? gap : 3.0;
  const paragraphs = [];
  const paragraphStarts = [];
  let buf = [];
  let bufStart = 0;
  let lastStart = -Infinity;
  for (const c of cleaned) {
    const subTurns = splitOnTurns(c.text).map((s) => s.trim()).filter(Boolean);
    for (let i = 0; i < subTurns.length; i++) {
      const subText = subTurns[i];
      const isFirst = i === 0;
      // Non-first sub-turn = guaranteed turn boundary (we just split on it).
      const turnBoundary = !isFirst || isTurnStart(subText);
      if ((c.start - lastStart > GAP || turnBoundary) && buf.length > 0) {
        paragraphs.push(buf.join(' '));
        paragraphStarts.push(bufStart);
        buf = [];
      }
      if (buf.length === 0) bufStart = c.start;
      buf.push(subText);
      if (isFirst) lastStart = c.start;
    }
  }
  if (buf.length > 0) {
    paragraphs.push(buf.join(' '));
    paragraphStarts.push(bufStart);
  }

  setProgress('rendering', { count: paragraphs.length });

  const captionInfo = (() => {
    // Prefer values popup passed in. Popup ALWAYS knows the selected track
    // (even on the modern panel where DOM language reading fails).
    if (targetLanguageCode || targetLabel) {
      return {
        label: targetLabel || '',
        kind: targetKind === 'asr' ? 'asr' : 'standard',
        languageCode: targetLanguageCode || '',
      };
    }
    // Legacy fallback: DOM-sniff the panel label (only fires when popup
    // didn't pass anything, e.g. user cleared probe state).
    const label = readPanelLabel();
    const isAsr = /auto-generated|自动生成|自動生成|automatique|automatisch|자동\s*생성/i.test(label);
    const tracks = pr?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
    const norm = (s) => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
    const matched = tracks.find((tr) =>
      norm(tr.name?.simpleText || tr.name?.runs?.[0]?.text) === norm(label)
    );
    return {
      label,
      kind: isAsr ? 'asr' : 'standard',
      languageCode: matched?.languageCode || '',
    };
  })();

  // Path A: structured chapter markers from playerResponse. Most videos with
  // either DESCRIPTION_CHAPTERS or AUTO_CHAPTERS expose them here.
  const readChaptersFromPlayerResponse = () => {
    try {
      const markers =
        pr?.playerOverlays?.playerOverlayRenderer?.decoratedPlayerBarRenderer
          ?.decoratedPlayerBarRenderer?.playerBar?.multiMarkersPlayerBarRenderer
          ?.markersMap || [];
      const m = markers.find((x) => x?.key === 'DESCRIPTION_CHAPTERS' || x?.key === 'AUTO_CHAPTERS');
      const list = m?.value?.chapters || [];
      const out = [];
      for (const c of list) {
        const r = c?.chapterRenderer;
        if (!r) continue;
        const t = r.title?.simpleText || r.title?.runs?.[0]?.text || '';
        const startMs = Number(r.timeRangeStartMillis) || 0;
        if (!t) continue;
        out.push({ title: t, startSec: startMs / 1000 });
      }
      return out;
    } catch (_) { return []; }
  };

  // Path B: parse "M:SS - Title" / "H:MM:SS - Title" lines from the raw
  // description. Most podcasts (Lex Fridman / Tim Ferriss / Andrew Huberman)
  // ship a creator-authored OUTLINE in this format. Fires only when Path A
  // returned nothing.
  const readChaptersFromDescription = (desc) => {
    if (!desc) return [];
    const out = [];
    const re = /^(\d{1,2}(?::\d{2}){1,2})\s+[-—–]\s+(.+?)\s*$/gm;
    let m;
    while ((m = re.exec(desc)) !== null) {
      const ts = m[1];
      const title = m[2].trim();
      if (!title) continue;
      const parts = ts.split(':').map((n) => parseInt(n, 10));
      let startSec = 0;
      if (parts.length === 2) startSec = parts[0] * 60 + parts[1];
      else if (parts.length === 3) startSec = parts[0] * 3600 + parts[1] * 60 + parts[2];
      out.push({ title, startSec });
    }
    // Sort + dedupe by startSec (defensive against accidental repeats).
    out.sort((a, b) => a.startSec - b.startSec);
    const seen = new Set();
    return out.filter((c) => {
      if (seen.has(c.startSec)) return false;
      seen.add(c.startSec);
      return true;
    });
  };

  const readChapters = () => {
    const fromPR = readChaptersFromPlayerResponse();
    if (fromPR.length > 0) return fromPR.sort((a, b) => a.startSec - b.startSec);
    return readChaptersFromDescription(vd.shortDescription || '');
  };

  const splitByChapters = (paras, starts, chapters) => {
    if (!chapters.length) return [{ title: null, paragraphs: paras }];
    const groups = chapters.map((c) => ({ title: c.title, startSec: c.startSec, paragraphs: [] }));
    for (let i = 0; i < paras.length; i++) {
      const s = starts[i] || 0;
      let idx = 0;
      for (let j = 0; j < groups.length; j++) {
        if (groups[j].startSec <= s) idx = j; else break;
      }
      groups[idx].paragraphs.push(paras[i]);
    }
    return groups
      .filter((g) => g.paragraphs.length > 0)
      .map((g) => ({ title: g.title, paragraphs: g.paragraphs }));
  };

  const yamlValue = (v) => {
    if (v === null || v === undefined) return 'null';
    if (typeof v === 'number') return String(v);
    return JSON.stringify(String(v));
  };

  const buildFrontmatter = (m) => {
    const lines = [
      '---',
      `videoId: ${yamlValue(m.videoId)}`,
      `url: ${yamlValue(m.url)}`,
      `title: ${yamlValue(m.title)}`,
      `channel: ${yamlValue(m.channel)}`,
      `channelId: ${yamlValue(m.channelId)}`,
      `publishDate: ${yamlValue(m.publishDate)}`,
      `durationSec: ${yamlValue(m.durationSec)}`,
      `language: ${yamlValue(m.caption?.label || '')}`,
      `languageCode: ${yamlValue(m.caption?.languageCode || '')}`,
      `captionKind: ${yamlValue(m.caption?.kind || 'standard')}`,
    ];
    if (m.chapters && m.chapters.length > 0) {
      lines.push('chapters:');
      for (const c of m.chapters) {
        lines.push(`  - ${yamlValue(`${formatTs(c.startSec)} — ${c.title}`)}`);
      }
    }
    lines.push('---', '');
    return lines.join('\n');
  };

  const canonicalUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const chapters = readChapters();
  const chaptered = splitByChapters(paragraphs, paragraphStarts, chapters);

  const meta = {
    videoId,
    url: canonicalUrl,
    title,
    channel:     vd.author || '',
    channelId:   vd.channelId || '',
    publishDate: rawPublish,
    durationSec: Number(vd.lengthSeconds) || null,
    description: trimDescription(vd.shortDescription || ''),
    caption:     captionInfo,
    chapters,
  };

  const transcriptBody = chaptered.map(({ title: chTitle, paragraphs: chParas }) =>
    (chTitle ? `### ${chTitle}\n\n` : '') + chParas.join('\n\n')
  ).join('\n\n');

  const md =
    buildFrontmatter(meta) +
    `# ${title}\n\n` +
    `## Description\n\n${meta.description || '_(no description)_'}\n\n` +
    `## Transcript\n\n${transcriptBody}\n`;

  window.__TUBE2MD__ = {
    meta, chapters, paragraphs, paragraphStarts, cues: cleaned, markdown: md,
  };

  console.log(`${TAG} extracted`, {
    videoId,
    paragraphs: paragraphs.length,
    chapters: chapters.length,
    captionKind: captionInfo.kind,
    captionLabel: captionInfo.label,
  });

  setProgress('saving');

  if (action === 'copy') {
    let copied = false;
    try {
      await navigator.clipboard.writeText(md);
      copied = true;
    } catch (_) {
      const ta = document.createElement('textarea');
      ta.value = md;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      try { copied = document.execCommand('copy'); } catch (_) {}
      ta.remove();
    }
    if (!copied) return err('errClipboardBlocked');
  } else {
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { a.remove(); URL.revokeObjectURL(blobUrl); }, 1000);
  }

  window.__TUBE2MD_PROGRESS__ = null;
  return result({
    videoId,
    title,
    filename,
    cueCount: cleaned.length,
    paragraphCount: paragraphs.length,
    chapterCount: chapters.length,
    chars: md.length,
  });
}
