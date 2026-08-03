// ============================================================
// Note <-> fingering glyph tables (C-key 12-hole ocarina, A4-F6)
// Keep in sync with app.py's NOTE_TO_GLYPH / abc_note_to_glyph.
// ============================================================

const NOTE_TO_GLYPH = {
  "A4":"A","A#4":"B","B4":"C","C5":"D","C#5":"E","D5":"F","D#5":"G",
  "E5":"H","F5":"I","F#5":"J","G5":"K","G#5":"L","A5":"M","A#5":"N",
  "B5":"O","C6":"P","C#6":"Q","D6":"R","D#6":"S","E6":"T","F6":"U"
};

// Ascending order for the virtual keyboard, with the ABC token to insert.
const KEYBOARD_NOTES = [
  ["A4","A,"], ["A#4","^A,"], ["B4","B,"],
  ["C5","C"], ["C#5","^C"], ["D5","D"], ["D#5","^D"],
  ["E5","E"], ["F5","F"], ["F#5","^F"], ["G5","G"], ["G#5","^G"],
  ["A5","A"], ["A#5","^A"], ["B5","B"],
  ["C6","c"], ["C#6","^c"], ["D6","d"], ["D#6","^d"],
  ["E6","e"], ["F6","f"]
];

const SEMITONES = {C:0,D:2,E:4,F:5,G:7,A:9,B:11};
const NAMES = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];

function abcNoteToName(token) {
  const m = /^(\^{1,2}|_{1,2}|=)?([A-Ga-g])([,']*)(\d*(?:\/\d*)?)$/.exec(token);
  if (!m) return null;
  const [, acc, letter, oct] = m;
  let semitone = SEMITONES[letter.toUpperCase()];
  if (acc === "^") semitone += 1;
  else if (acc === "^^") semitone += 2;
  else if (acc === "_") semitone -= 1;
  else if (acc === "__") semitone -= 2;

  let octave = letter === letter.toUpperCase() ? 5 : 6;
  for (const c of oct) octave += c === "," ? -1 : 1;

  semitone = ((semitone % 12) + 12) % 12;
  return NAMES[semitone] + octave;
}

function ensureHeaders(abcNotes) {
  return `X:1\n%%stretchlast 1\nK:C\nL:1/4\n${abcNotes}\n`;
}

// ============================================================
// Toast
// ============================================================

let toastTimer = null;
function toast(msg) {
  const el = document.getElementById("toast");
  if (!el) return;
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2200);
}

// ============================================================
// Score rendering: a full token stream -> a wrapped, multi-line
// staff (abcjs only auto-wraps at bar lines, so we insert "|" at
// each phrase boundary) with fingering glyphs aligned under every
// note, grouped per engraved row via abcjs's .abcjs-top-line marker.
// ============================================================

let scoreCounter = 0;

function buildBarredAbc(tokens, barAfterSet) {
  const out = [];
  tokens.forEach((tok, i) => {
    out.push(tok);
    if (barAfterSet.has(i)) out.push("|");
  });
  return out.join(" ");
}

/**
 * Renders `tokens` into `container`, wrapped to `staffwidth`, with a bar
 * line after every index in `barAfterSet`. Returns the natural content
 * height and, for each engraved row, the index of its last token and its
 * bottom y - both needed to decide where to split across pages.
 */
function renderScore(container, tokens, barAfterSet, staffwidth) {
  container.innerHTML = "";
  if (tokens.length === 0) return { contentHeight: 0, rows: [] };

  const wrap = document.createElement("div");
  wrap.className = "score-wrap";
  container.appendChild(wrap);

  const staffId = `score-${scoreCounter++}`;
  const staffDiv = document.createElement("div");
  staffDiv.id = staffId;
  wrap.appendChild(staffDiv);

  const abcBody = buildBarredAbc(tokens, barAfterSet);
  ABCJS.renderAbc(staffId, `X:1\nK:C\nL:1/4\n${abcBody}\n`, {
    staffwidth,
    wrap: { minSpacing: 1.8, maxSpacing: 2.7, preferredMeasuresPerLine: 99 }
  });

  const wrapRect = wrap.getBoundingClientRect();
  const topLines = [...wrap.querySelectorAll(".abcjs-top-line")]
    .map(el => el.getBoundingClientRect().top - wrapRect.top)
    .sort((a, b) => a - b);

  if (topLines.length === 0) return { contentHeight: 0, rows: [] };

  // Build a mapping from notehead position to actual token index,
  // skipping rests (z) and any other tokens that don't produce a notehead.
  const noteTokenMap = [];
  tokens.forEach((tok, i) => {
    if (abcNoteToName(tok)) noteTokenMap.push(i);
  });

  const noteheads = [...wrap.querySelectorAll(".abcjs-notehead")];
  const rows = topLines.map(() => []);
  noteheads.forEach((el, noteheadIdx) => {
    if (noteheadIdx >= noteTokenMap.length) return;
    const tokenIndex = noteTokenMap[noteheadIdx];
    const y = el.getBoundingClientRect().top - wrapRect.top;
    let rowIdx = 0;
    for (let r = 0; r < topLines.length; r++) {
      if (y >= topLines[r] - 5) rowIdx = r;
    }
    rows[rowIdx].push({ el, tokenIndex });
  });

  const glyphLayer = document.createElement("div");
  glyphLayer.className = "glyph-layer";
  wrap.appendChild(glyphLayer);

  const rowInfo = [];
  rows.forEach((rowNotes, r) => {
    if (rowNotes.length === 0) return;
    const rowGlyphTop = topLines[r] - 28; // above the staff
    rowNotes.forEach(({ el, tokenIndex }) => {
      const name = abcNoteToName(tokens[tokenIndex]);
      const glyph = name && NOTE_TO_GLYPH[name];
      if (!glyph) return;
      const x = el.getBoundingClientRect().left + el.getBoundingClientRect().width / 2 - wrapRect.left;
      const box = document.createElement("div");
      box.className = "glyph-box";
      box.style.left = x + "px";
      box.style.top = rowGlyphTop + "px";
      box.textContent = glyph;
      glyphLayer.appendChild(box);
    });
    rowInfo.push({
      endTokenIndex: rowNotes[rowNotes.length - 1].tokenIndex,
      bottom: topLines[r] + 50
    });
  });

  const contentHeight = wrap.getBoundingClientRect().height + 40;
  return { contentHeight, rows: rowInfo };
}

/** Flattens ABC lines into a token stream + the token indices that mark
 *  a phrase (original line) boundary, for use as renderScore's barAfterSet. */
function tokensFromLines(rawAbc) {
  const tokens = [];
  const barAfterSet = new Set();
  rawAbc.split("\n").map(l => l.trim()).filter(Boolean).forEach(line => {
    const lineTokens = line.split(/\s+/).filter(t => /^(?:z|[\^_=]{0,2}[A-Ga-g][,']*(?:\d*(?:\/\d*)?)?)$/.test(t));
    tokens.push(...lineTokens);
    if (tokens.length > 0) barAfterSet.add(tokens.length - 1);
  });
  return { tokens, barAfterSet };
}

// ============================================================
// Creator mode toggle (shared across library + sheet pages)
// ============================================================

function wireCreatorModeButton() {
  const btn = document.getElementById("creatorModeBtn");
  if (!btn) return;
  const isOn = document.body.classList.contains("creator-mode");
  const passwordRequired = document.body.dataset.passwordRequired === "true";

  btn.addEventListener("click", async () => {
    if (isOn) {
      await fetch("/api/creator-mode", { method: "DELETE" });
      location.reload();
      return;
    }
    let password = "";
    if (passwordRequired) {
      password = prompt("Creator mode password:");
      if (password === null) return;
    }
    const res = await fetch("/api/creator-mode", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password })
    });
    const data = await res.json();
    if (!res.ok) {
      toast(data.error || "Could not enable creator mode");
      return;
    }
    location.reload();
  });
}

// ============================================================
// Library mode
// ============================================================

function initLibrary() {
  const grid = document.getElementById("card-grid");
  const empty = document.getElementById("empty-state");
  const search = document.getElementById("search-bar");
  if (!grid) return;

  const songs = window.__SONGS__ || [];

  function draw(list) {
    grid.innerHTML = "";
    empty.style.display = list.length ? "none" : "block";
    list.forEach(song => {
      const card = document.createElement("a");
      card.className = "song-card";
      card.href = `/sheet/${encodeURIComponent(song.title)}`;
      card.innerHTML = `
        <div class="card-preview" id="preview-${song.id}"></div>
        <div class="card-title">${song.title}</div>
        <div class="card-meta">${new Date(song.updated_at).toLocaleDateString()}</div>
      `;
      grid.appendChild(card);

      try {
        ABCJS.renderAbc(`preview-${song.id}`, ensureHeaders(song.raw_abc.split("\n")[0] || ""), { staffwidth: 200 });
      } catch (e) {
        document.getElementById(`preview-${song.id}`).textContent = "Preview unavailable";
      }
    });
  }

  draw(songs);

  search.addEventListener("input", () => {
    const q = search.value.trim().toLowerCase();
    draw(songs.filter(s => s.title.toLowerCase().includes(q)));
  });
}

// ============================================================
// Sheet mode: reader view
// ============================================================

const ROWS_PER_PAGE = 10;

/** Lets the plain mouse wheel scroll a horizontal container, without
 *  requiring shift. Falls back to native vertical scroll if the
 *  container has no horizontal overflow to consume. */
function wireHorizontalWheelScroll(el) {
  el.addEventListener("wheel", (e) => {
    if (e.deltaY === 0) return;
    if (el.scrollWidth <= el.clientWidth) return; // nothing to scroll
    e.preventDefault();
    el.scrollLeft += e.deltaY;
  }, { passive: false });
}

/** Renders `tokens` into `container` as one or more .reader-page elements
 *  (splitting every ROWS_PER_PAGE staff rows), and returns the page
 *  elements in order. Used by both the on-screen reader and PDF export
 *  so both produce pixel-identical output. */
function buildReaderPages(container, tokens, barAfterSet, pageWidth) {
  container.innerHTML = '<div class="reader-page"></div>';
  const firstPage = container.querySelector(".reader-page");
  const { rows } = renderScore(firstPage, tokens, barAfterSet, pageWidth);
  if (rows.length === 0) return [];
  if (rows.length <= ROWS_PER_PAGE) return [firstPage];

  const breaks = [];
  for (let i = ROWS_PER_PAGE - 1; i < rows.length; i += ROWS_PER_PAGE) {
    breaks.push(rows[i].endTokenIndex);
  }

  const p1End = breaks[0];
  renderScore(firstPage, tokens.slice(0, p1End + 1),
    new Set([...barAfterSet].filter(i => i <= p1End)), pageWidth);

  const pages = [firstPage];
  let start = p1End + 1;
  for (let b = 1; b < breaks.length; b++) {
    const endIdx = breaks[b];
    const pTokens = tokens.slice(start, endIdx + 1);
    const pBars = new Set([...barAfterSet].filter(i => i >= start && i <= endIdx).map(i => i - start));
    const page = document.createElement("div");
    page.className = "reader-page";
    container.appendChild(page);
    renderScore(page, pTokens, pBars, pageWidth);
    pages.push(page);
    start = endIdx + 1;
  }
  if (start < tokens.length) {
    const pTokens = tokens.slice(start);
    const pBars = new Set([...barAfterSet].filter(i => i >= start).map(i => i - start));
    const page = document.createElement("div");
    page.className = "reader-page";
    container.appendChild(page);
    renderScore(page, pTokens, pBars, pageWidth);
    pages.push(page);
  }
  return pages;
}

function initReaderView(song) {
  const readerView = document.getElementById("readerView");
  if (!readerView) return;
  const { tokens, barAfterSet } = tokensFromLines(song.raw_abc);
  if (tokens.length === 0) {
    readerView.innerHTML = "<p class='empty-note'>No notes yet.</p>";
    return;
  }

  // Large songs take a moment to lay out (abcjs has to compute wrapping
  // across many notes). Paint a loading state first, then let the browser
  // actually render it before the heavy synchronous work blocks the
  // main thread - otherwise the page just looks frozen the whole time.
  readerView.innerHTML = "<p class='empty-note'>Loading sheet...</p>";
  requestAnimationFrame(() => requestAnimationFrame(() => renderReaderView(readerView, tokens, barAfterSet)));
}

function renderReaderView(readerView, tokens, barAfterSet) {
  const isDesktop = window.innerWidth > 768;
  if (!isDesktop) {
    readerView.innerHTML = '<div class="reader-column"></div>';
    const col = readerView.querySelector(".reader-column");
    renderScore(col, tokens, barAfterSet, col.getBoundingClientRect().width || 400);
    return;
  }
  // Desktop: horizontal page scrolling, 10 staff rows per page
  readerView.innerHTML = '<div class="reader-scroll"></div>';
  const scroll = readerView.querySelector(".reader-scroll");
  wireHorizontalWheelScroll(scroll);
  const probe = document.createElement("div");
  probe.className = "reader-page";
  scroll.appendChild(probe);
  const pageWidth = probe.clientWidth || 500;
  buildReaderPages(scroll, tokens, barAfterSet, pageWidth);
}

// ============================================================
// Sheet mode: creator view
// ============================================================

function initCreatorView(song) {
  const keyboard = document.getElementById("virtualKeyboard");
  const editor = document.getElementById("abc-editor");
  const preview = document.getElementById("livePreview");
  if (!keyboard || !editor) return;

  // --- shared token insertion helper ---
  let durationModifier = "";
  let longBtn, shortBtn;

  function insertToken(token) {
    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    const before = editor.value.slice(0, start);
    const after = editor.value.slice(end);
    const currentLine = before.split("\n").pop() || "";
    const notesOnLine = currentLine.trim().split(/\s+/).filter(Boolean).length;
    let insert;
    if (notesOnLine > 0 && notesOnLine % 9 === 0) {
      insert = (before.endsWith(" ") ? "" : " ") + token + "\n";
    } else {
      insert = (before && !before.endsWith("\n") && !before.endsWith(" ") ? " " : "") + token + " ";
    }
    editor.value = before + insert + after;
    const pos = (before + insert).length;
    editor.setSelectionRange(pos, pos);
    editor.focus();
    renderPreview();
    scheduleSave();
  }

  // --- note buttons ---
  KEYBOARD_NOTES.forEach(([name, abcToken]) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "key-btn";
    btn.textContent = NOTE_TO_GLYPH[name];
    btn.title = name;
    btn.addEventListener("click", () => {
      const token = abcToken + durationModifier;
      durationModifier = "";
      if (longBtn) longBtn.classList.remove("active");
      if (shortBtn) shortBtn.classList.remove("active");
      insertToken(token);
    });
    keyboard.appendChild(btn);
  });

  // --- duration modifier row ---
  const modifierRow = document.createElement("div");
  modifierRow.className = "keyboard-modifiers";

  // Rest button
  const restBtn = document.createElement("button");
  restBtn.type = "button";
  restBtn.className = "key-btn key-btn-action";
  restBtn.textContent = "\u{1D13E}";
  restBtn.title = "Rest (silence)";
  restBtn.addEventListener("click", () => {
    insertToken("z");
  });
  modifierRow.appendChild(restBtn);

  // Long note toggle
  longBtn = document.createElement("button");
  longBtn.type = "button";
  longBtn.className = "key-btn key-btn-action";
  longBtn.textContent = "Long";
  longBtn.title = "Long note (double duration)";
  longBtn.addEventListener("click", () => {
    if (durationModifier === "2") {
      durationModifier = "";
      longBtn.classList.remove("active");
    } else {
      durationModifier = "2";
      longBtn.classList.add("active");
      if (shortBtn) shortBtn.classList.remove("active");
    }
  });
  modifierRow.appendChild(longBtn);

  // Short note toggle
  shortBtn = document.createElement("button");
  shortBtn.type = "button";
  shortBtn.className = "key-btn key-btn-action";
  shortBtn.textContent = "Short";
  shortBtn.title = "Short note (half duration)";
  shortBtn.addEventListener("click", () => {
    if (durationModifier === "/") {
      durationModifier = "";
      shortBtn.classList.remove("active");
    } else {
      durationModifier = "/";
      shortBtn.classList.add("active");
      if (longBtn) longBtn.classList.remove("active");
    }
  });
  modifierRow.appendChild(shortBtn);

  keyboard.appendChild(modifierRow);

  function renderPreview() {
    if (!preview) return;
    const { tokens, barAfterSet } = tokensFromLines(editor.value);
    const width = preview.getBoundingClientRect().width || 400;
    renderScore(preview, tokens, barAfterSet, width);
  }

  let saveTimer = null;
  function scheduleSave() {
    if (!document.body.classList.contains("creator-mode")) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveSong, 700);
  }

  editor.addEventListener("input", () => {
    renderPreview();
    scheduleSave();
  });

  renderPreview();
}

// ============================================================
// Sheet mode: save / new / delete / export
// ============================================================

let currentSong = null;

async function saveSong() {
  if (!document.body.classList.contains("creator-mode")) return;
  const titleInput = document.getElementById("song-title-input");
  const editor = document.getElementById("abc-editor");
  if (!titleInput || !currentSong) return;

  const res = await fetch("/api/sheet/save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id: currentSong.id,
      title: titleInput.value.trim(),
      raw_abc: editor ? editor.value : currentSong.raw_abc
    })
  });
  const data = await res.json();
  if (!res.ok) {
    toast(data.error || "Save failed");
    return;
  }
  currentSong.id = data.id;
  currentSong.title = data.title;
  toast("Saved");
}

/** Draws one rendered .reader-page onto a canvas natively: the abcjs
 *  staff SVG via a single drawImage() call (browsers rasterize SVG
 *  directly - no need to walk its internal <path> elements one by one),
 *  and the fingering glyphs via Canvas2D text. This is what makes export
 *  fast even for long songs - html2canvas has to manually reimplement
 *  CSS rendering by inspecting every element, which is slow especially
 *  for SVGs with a path per note/stem/beam. */
const EXPORT_SCALE = 3; // fixed print-quality multiplier, independent of the viewing screen

async function pageToCanvas(page) {
  const rect = page.getBoundingClientRect();

  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(rect.width * EXPORT_SCALE);
  canvas.height = Math.ceil(rect.height * EXPORT_SCALE);
  const ctx = canvas.getContext("2d");
  ctx.scale(EXPORT_SCALE, EXPORT_SCALE);

  const bg = getComputedStyle(page).backgroundColor;
  ctx.fillStyle = (!bg || bg === "rgba(0, 0, 0, 0)" || bg === "transparent") ? "#181818" : bg;
  ctx.fillRect(0, 0, rect.width, rect.height);

  const svg = page.querySelector("svg");
  if (svg) {
    const svgRect = svg.getBoundingClientRect();
    // abcjs bakes width/height attributes onto the <svg> that may not match
    // how it's actually laid out on screen via CSS. Force the clone's size
    // to the live measured size before serializing, so the standalone image
    // rasterizes at exactly the box we're about to draw it into - otherwise
    // any mismatch shows up as cropping or blank space.
    const svgClone = svg.cloneNode(true);
    svgClone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    svgClone.setAttribute("width", svgRect.width);
    svgClone.setAttribute("height", svgRect.height);
    const xml = new XMLSerializer().serializeToString(svgClone);
    const url = URL.createObjectURL(new Blob([xml], { type: "image/svg+xml;charset=utf-8" }));
    try {
      const img = await new Promise((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = reject;
        el.src = url;
      });
      ctx.drawImage(img, svgRect.left - rect.left, svgRect.top - rect.top, svgRect.width, svgRect.height);
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  const glyphBoxes = [...page.querySelectorAll(".glyph-box")];
  if (glyphBoxes.length) {
    await document.fonts.load("22px Ocarina");
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillStyle = getComputedStyle(glyphBoxes[0]).color;
    glyphBoxes.forEach(box => {
      const boxRect = box.getBoundingClientRect();
      ctx.font = `${getComputedStyle(box).fontSize} Ocarina`;
      const x = boxRect.left + boxRect.width / 2 - rect.left;
      const y = boxRect.top - rect.top;
      ctx.fillText(box.textContent, x, y);
    });
  }

  return canvas;
}

/** Renders the song as reader pages off-screen (so export always produces
 *  the desktop paged layout, regardless of the current viewport) and
 *  captures each one into a PDF - pixel-identical to the on-screen view,
 *  since it's the exact same DOM/SVG being rendered, just photographed. */
async function exportPdf(song) {
  const titleInput = document.getElementById("song-title-input");
  const editor = document.getElementById("abc-editor");
  const title = titleInput ? titleInput.value.trim() : song.title;
  const rawAbc = editor ? editor.value : song.raw_abc;
  const { tokens, barAfterSet } = tokensFromLines(rawAbc);

  if (tokens.length === 0) {
    toast("Nothing to export");
    return;
  }
  if (!window.jspdf) {
    toast("PDF export library failed to load");
    return;
  }

  toast("Preparing PDF...");

  const offscreen = document.createElement("div");
  offscreen.className = "reader-scroll";
  offscreen.style.position = "fixed";
  offscreen.style.top = "0";
  offscreen.style.left = "-99999px";
  document.body.appendChild(offscreen);

  const pages = buildReaderPages(offscreen, tokens, barAfterSet, 700);

  const { jsPDF } = window.jspdf;
  let doc = null;

  for (let i = 0; i < pages.length; i++) {
    if (pages.length > 1) toast(`Preparing PDF... page ${i + 1}/${pages.length}`);
    const canvas = await pageToCanvas(pages[i]);
    const imgData = canvas.toDataURL("image/png");
    const widthMm = 280;
    const heightMm = widthMm * (canvas.height / canvas.width);
    if (!doc) {
      doc = new jsPDF({ orientation: "landscape", unit: "mm", format: [widthMm, heightMm] });
    } else {
      doc.addPage([widthMm, heightMm], "landscape");
    }
    doc.addImage(imgData, "PNG", 0, 0, widthMm, heightMm);
  }

  document.body.removeChild(offscreen);

  if (!doc) {
    toast("Export failed");
    return;
  }
  doc.save(`${title || "song"}.pdf`);
  toast("PDF downloaded");
}

function initSheetControls(song) {
  currentSong = song;

  document.getElementById("saveBtn")?.addEventListener("click", saveSong);

  document.getElementById("newBtn")?.addEventListener("click", () => {
    const title = prompt("New song title:", "Untitled Song");
    if (!title) return;
    location.href = `/sheet/${encodeURIComponent(title)}?action=new`;
  });

  document.getElementById("deleteBtn")?.addEventListener("click", async () => {
    if (!confirm(`Delete "${song.title}"?`)) return;
    const res = await fetch(`/api/sheet/${encodeURIComponent(song.title)}`, { method: "DELETE" });
    if (res.ok) {
      location.href = "/";
    } else {
      toast("Delete failed");
    }
  });

  document.getElementById("exportBtn")?.addEventListener("click", () => exportPdf(song));
}

// ============================================================
// Header auto-hide on scroll down
// ============================================================

function initScrollHeader() {
  const header = document.querySelector("header");
  if (!header) return;
  let lastY = 0;
  window.addEventListener("scroll", () => {
    const y = window.scrollY;
    if (y > lastY && y > 50) header.classList.add("hidden");
    else header.classList.remove("hidden");
    lastY = y;
  }, { passive: true });
}

// ============================================================
// Boot
// ============================================================

document.addEventListener("DOMContentLoaded", () => {
  initScrollHeader();
  wireCreatorModeButton();

  if (window.__SONGS__) {
    initLibrary();
  }

  if (window.__SONG__) {
    const song = window.__SONG__;
    initSheetControls(song);
    initReaderView(song);
    initCreatorView(song);
  }
});
