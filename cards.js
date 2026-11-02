// Builds the printable card PDF. Pure layout: no network, no DOM.
// Each sheet of cards becomes two A4 pages: QR codes on the front, song details on the back,
// with the back mirrored so every answer lands behind its own QR code when printed double-sided.

const CARD = 65; // mm, square cards
const COLS = 3;
const ROWS = 4;
const PAGE_W = 210;
const PAGE_H = 297;
const MARGIN_X = (PAGE_W - COLS * CARD) / 2;
const MARGIN_Y = (PAGE_H - ROWS * CARD) / 2;
const QR_SIZE = 46;
const TEXT_WIDTH = CARD - 10;

// The built-in PDF fonts only cover Latin-1 plus these WinAnsi extras.
const WINANSI_EXTRA = "€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ";

function pdfSafe(text) {
  return [...text]
    .map((ch) => {
      if (ch.codePointAt(0) < 256 || WINANSI_EXTRA.includes(ch)) return ch;
      const stripped = ch.normalize("NFKD").replace(/[̀-ͯ]/g, "");
      return [...stripped].every((c) => c.codePointAt(0) < 256) ? stripped : "?";
    })
    .join("");
}

function clampLines(doc, text, maxLines) {
  let lines = doc.splitTextToSize(pdfSafe(text), TEXT_WIDTH);
  if (lines.length > maxLines) {
    lines = lines.slice(0, maxLines);
    let last = lines[maxLines - 1];
    while (last && doc.getTextWidth(last + "...") > TEXT_WIDTH) last = last.slice(0, -1);
    lines[maxLines - 1] = last.trimEnd() + "...";
  }
  return lines;
}

function cellOrigin(col, row) {
  return { x: MARGIN_X + col * CARD, y: MARGIN_Y + row * CARD };
}

function drawCutLine(doc, x, y) {
  doc.setDrawColor(190);
  doc.setLineWidth(0.2);
  doc.rect(x, y, CARD, CARD);
}

function drawFront(doc, track, x, y, cutLines) {
  if (cutLines) drawCutLine(doc, x, y);
  const qr = qrcode(0, "M");
  qr.addData(track.url);
  qr.make();
  const n = qr.getModuleCount();
  const m = QR_SIZE / n;
  const ox = x + (CARD - QR_SIZE) / 2;
  const oy = y + (CARD - QR_SIZE) / 2;
  doc.setFillColor(0);
  // One rectangle per horizontal run of dark modules keeps the PDF small; the tiny overlap hides seams.
  for (let r = 0; r < n; r++) {
    let runStart = -1;
    for (let c = 0; c <= n; c++) {
      const dark = c < n && qr.isDark(r, c);
      if (dark && runStart < 0) runStart = c;
      if (!dark && runStart >= 0) {
        doc.rect(ox + runStart * m, oy + r * m, (c - runStart) * m + 0.02, m + 0.02, "F");
        runStart = -1;
      }
    }
  }
}

function drawBack(doc, track, x, y, cutLines) {
  if (cutLines) drawCutLine(doc, x, y);
  const cx = x + CARD / 2;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(12);
  clampLines(doc, track.artist, 2).forEach((line, i) => doc.text(line, cx, y + 13 + i * 5.5, { align: "center" }));

  doc.setFont("helvetica", "bold");
  doc.setFontSize(36);
  doc.text(pdfSafe(track.year || "?"), cx, y + 38, { align: "center" });

  doc.setFont("helvetica", "italic");
  doc.setFontSize(12);
  clampLines(doc, track.title, 3).forEach((line, i) => doc.text(line, cx, y + 49 + i * 5.5, { align: "center" }));
}

/**
 * tracks: [{ url, title, artist, year }]
 * flip: "long" (most printers' default duplex) or "short" — how the sheet turns over.
 */
function buildCardsPdf(tracks, { flip = "long", cutLines = true } = {}) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const perPage = COLS * ROWS;
  for (let start = 0; start < tracks.length; start += perPage) {
    const sheet = tracks.slice(start, start + perPage);
    if (start > 0) doc.addPage();
    sheet.forEach((track, i) => {
      const { x, y } = cellOrigin(i % COLS, Math.floor(i / COLS));
      drawFront(doc, track, x, y, cutLines);
    });
    doc.addPage();
    sheet.forEach((track, i) => {
      const col = i % COLS;
      const row = Math.floor(i / COLS);
      const { x, y } = flip === "long" ? cellOrigin(COLS - 1 - col, row) : cellOrigin(col, ROWS - 1 - row);
      drawBack(doc, track, x, y, cutLines);
    });
  }
  return doc;
}
