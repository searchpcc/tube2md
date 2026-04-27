const statusEl = document.getElementById('status');
const runBtn = document.getElementById('run');
const gapInput = document.getElementById('gap');
const chipEls = document.querySelectorAll('#chips button');
const langField = document.getElementById('lang-field');
const langSelect = document.getElementById('lang');

const YT_WATCH_RE = /^https:\/\/(www\.)?youtube\.com\/watch\?/;

const t = (key, args) => {
  const msg = chrome.i18n.getMessage(key, args);
  return msg || key;
};

document.querySelectorAll('[data-i18n]').forEach((el) => {
  const msg = chrome.i18n.getMessage(el.dataset.i18n);
  if (!msg) return;
  if (el.tagName === 'TITLE') document.title = msg;
  else el.textContent = msg;
});

const setStatus = (text, kind) => {
  statusEl.textContent = text;
  statusEl.className = kind || '';
};

const syncChipsToValue = (v) => {
  chipEls.forEach((c) => c.classList.toggle('on', c.dataset.gap === v));
};

chipEls.forEach((b) => {
  b.addEventListener('click', () => {
    gapInput.value = b.dataset.gap;
    syncChipsToValue(b.dataset.gap);
  });
});

gapInput.addEventListener('input', () => syncChipsToValue(gapInput.value));

// Injected into the YouTube tab to enumerate caption tracks and detect what
// the panel is currently showing (so we default the dropdown to that).
function probeCaptions() {
  const onWatch = /^\/watch$/.test(location.pathname);
  const mp = document.querySelector('#movie_player');
  let tracks = [];
  let panelLabel = '';
  let audioDefaultIdx = -1;
  try {
    const pr = mp?.getPlayerResponse?.();
    const raw = pr?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
    tracks = raw.map((tr, idx) => ({
      idx,
      languageCode: tr.languageCode || '',
      label: tr.name?.simpleText || tr.name?.runs?.[0]?.text || tr.languageCode || '',
      kind: tr.kind === 'asr' ? 'asr' : 'standard',
    }));
    const audioTracks = pr?.captions?.playerCaptionsTracklistRenderer?.audioTracks || [];
    if (audioTracks.length > 0 && typeof audioTracks[0].defaultCaptionTrackIndex === 'number') {
      audioDefaultIdx = audioTracks[0].defaultCaptionTrackIndex;
    }
  } catch (_) {}
  const transcriptOpen =
    document.querySelectorAll(
      'ytd-transcript-segment-renderer, transcript-segment-view-model'
    ).length > 0;
  if (transcriptOpen) {
    const labelEl =
      document.querySelector('ytd-transcript-search-panel-renderer ytd-transcript-footer-renderer tp-yt-paper-button') ||
      document.querySelector('ytd-transcript-footer-renderer tp-yt-paper-button') ||
      document.querySelector('ytd-transcript-search-panel-renderer tp-yt-paper-button');
    if (labelEl) {
      panelLabel = (labelEl.innerText || labelEl.textContent || '').replace(/\s+/g, ' ').trim();
    }
  }
  return {
    onWatch,
    hasPlayer: !!mp,
    trackCount: tracks.length,
    transcriptOpen,
    tracks,
    panelLabel,
    audioDefaultIdx,
  };
}

function pickDefaultTrack(tracks, panelLabel, audioDefaultIdx) {
  if (tracks.length === 0) return -1;
  // 1. Prefer English (any "en" / "en-US" / "en-GB" variant). Within English,
  //    prefer human-uploaded over auto-generated.
  const englishHuman = tracks.findIndex(
    (tr) => (tr.languageCode || '').toLowerCase().startsWith('en') && tr.kind !== 'asr'
  );
  if (englishHuman >= 0) return englishHuman;
  const englishAny = tracks.findIndex(
    (tr) => (tr.languageCode || '').toLowerCase().startsWith('en')
  );
  if (englishAny >= 0) return englishAny;
  // 2. No English: fall back to the language YouTube panel currently shows.
  if (panelLabel) {
    const norm = panelLabel.replace(/\s+/g, ' ').trim().toLowerCase();
    const i = tracks.findIndex((tr) => (tr.label || '').replace(/\s+/g, ' ').trim().toLowerCase() === norm);
    if (i >= 0) return i;
  }
  // 3. Then YouTube's audio-track default.
  if (audioDefaultIdx >= 0 && audioDefaultIdx < tracks.length) return audioDefaultIdx;
  // 4. Then browser UI language non-ASR.
  const ui = (chrome.i18n.getUILanguage() || 'en').slice(0, 2).toLowerCase();
  const score = (tr) =>
    (tr.kind === 'asr' ? 0 : 2) + (tr.languageCode?.toLowerCase().startsWith(ui) ? 1 : 0);
  let best = 0;
  for (let i = 1; i < tracks.length; i++) {
    if (score(tracks[i]) > score(tracks[best])) best = i;
  }
  return best;
}

// Tracks the currently-selected caption track across single-track (dropdown
// hidden) and multi-track (dropdown visible) cases. Updated in renderLangSelect
// and on dropdown change. Passed verbatim into extractAndDeliver so that
// frontmatter language fields don't depend on DOM panel sniffing.
let selectedTrack = null;

function renderLangSelect(tracks, defaultIdx) {
  langSelect.innerHTML = '';
  selectedTrack = (defaultIdx >= 0 && tracks[defaultIdx]) || tracks[0] || null;
  if (tracks.length <= 1) {
    langField.hidden = true;
    return;
  }
  const asrSuffix = ` (${t('captionKindAsr')})`;
  for (const tr of tracks) {
    const opt = document.createElement('option');
    opt.value = String(tr.idx);
    // tr.label often already says "(auto-generated)" — only append our localized
    // suffix if it doesn't.
    const hasAsrInLabel = /auto-generated|自动生成|自動生成|asr/i.test(tr.label);
    opt.textContent = (tr.kind === 'asr' && !hasAsrInLabel) ? `${tr.label}${asrSuffix}` : tr.label;
    langSelect.appendChild(opt);
  }
  langSelect.value = String(defaultIdx);
  langField.hidden = false;
}

langSelect.addEventListener('change', () => {
  const idx = parseInt(langSelect.value, 10);
  selectedTrack = (probeCache.tracks || []).find((tr) => tr.idx === idx) || selectedTrack;
});

let probeCache = { tracks: [], panelLabel: '' };

async function detectBoundary() {
  runBtn.disabled = true;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.url || !YT_WATCH_RE.test(tab.url)) {
    setStatus(t('statusNotYoutube'), 'err');
    return;
  }

  let probe = null;
  for (let i = 0; i < 6; i++) {
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        world: 'MAIN',
        func: probeCaptions,
      });
      probe = results?.[0]?.result;
    } catch (e) {
      setStatus(t('statusInjectFailed', [String(e.message || e)]), 'err');
      return;
    }
    if (probe?.hasPlayer) break;
    await new Promise((r) => setTimeout(r, 250));
  }

  if (!probe) {
    setStatus(t('statusProbeFailed'), 'err');
    return;
  }
  if (!probe.onWatch) {
    setStatus(t('statusNotYoutube'), 'err');
    return;
  }
  if (!probe.hasPlayer) {
    setStatus(t('statusPlayerLoading'), 'err');
    return;
  }
  if (probe.trackCount === 0 && !probe.transcriptOpen) {
    setStatus(t('statusNoCaptions'), 'err');
    return;
  }

  probeCache = { tracks: probe.tracks || [], panelLabel: probe.panelLabel || '' };
  const defaultIdx = pickDefaultTrack(probe.tracks || [], probe.panelLabel, probe.audioDefaultIdx);
  renderLangSelect(probe.tracks || [], defaultIdx);

  runBtn.disabled = false;
  setStatus(
    probe.trackCount > 0
      ? t('statusReadyTracks', [String(probe.trackCount)])
      : t('statusReadyTranscriptOpen'),
    'ok'
  );
}

const translateError = (r) => {
  if (r.errorKey) return t(r.errorKey, r.errorArgs || []);
  return r.error || t('statusNoResult');
};

const phaseToText = (phase, data) => {
  switch (phase) {
    case 'starting':           return t('progressStarting');
    case 'opening':            return t('progressOpening');
    case 'switchingLanguage':  return t('progressSwitchingLang', [String(data?.target || '')]);
    case 'parsing':            return t('progressParsing', [String(data?.count || '?')]);
    case 'rendering':          return t('progressRendering', [String(data?.count || '?')]);
    case 'saving':             return t('progressSaving');
    default:                   return null;
  }
};

let pollTimer = null;
function startProgressPoll(tabId) {
  stopProgressPoll();
  pollTimer = setInterval(async () => {
    try {
      const r = await chrome.scripting.executeScript({
        target: { tabId },
        world: 'MAIN',
        func: () => window.__TUBE2MD_PROGRESS__ || null,
      });
      const p = r?.[0]?.result;
      if (!p) return;
      const text = phaseToText(p.phase, p.data);
      if (text) setStatus(text, '');
    } catch (_) {}
  }, 250);
}
function stopProgressPoll() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}

runBtn.addEventListener('click', async () => {
  const action = document.querySelector('input[name="action"]:checked').value;
  const gap = parseFloat(gapInput.value);
  const targetLabel        = selectedTrack?.label || '';
  const targetLanguageCode = selectedTrack?.languageCode || '';
  const targetKind         = selectedTrack?.kind || 'standard';

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.url || !YT_WATCH_RE.test(tab.url)) {
    setStatus(t('statusNotYoutube'), 'err');
    return;
  }

  runBtn.disabled = true;
  setStatus(t('progressStarting'), '');
  startProgressPoll(tab.id);

  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: 'MAIN',
      func: extractAndDeliver,
      args: [{ action, gap: isNaN(gap) ? 3 : gap, targetLabel, targetLanguageCode, targetKind }],
    });
    stopProgressPoll();
    const r = results?.[0]?.result;
    if (!r) {
      setStatus(t('statusNoResult'), 'err');
    } else if (!r.ok) {
      setStatus(translateError(r), 'err');
    } else if (r.action === 'copy') {
      setStatus(t('statusCopied', [String(r.chars), String(r.paragraphCount)]), 'ok');
    } else {
      setStatus(t('statusSaved', [r.filename, String(r.paragraphCount)]), 'ok');
    }
  } catch (e) {
    stopProgressPoll();
    setStatus(t('statusInjectFailed', [String(e.message || e)]), 'err');
  } finally {
    runBtn.disabled = false;
  }
});

detectBoundary();
