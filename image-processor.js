// image-processor.js
// Browser-first screenshot board extractor using OpenCV.js + Tesseract.js
//
// Public API (compatible with your old version):
//   async processScreenshot(imageSrc, statusCallback) -> string
//
// Expectations:
// - window.cv is available (opencv.js loaded)
// - window.Tesseract is available (tesseract.js loaded)
// - screenshot-only; board is always 9 cells wide

"use strict";

const DEBUG =
  (typeof window !== "undefined" && window.location && window.location.search.includes("debug=1")) ||
  (typeof window === "undefined");

function dbg(...args) {
  if (DEBUG && typeof console !== "undefined") console.log("[ImageProcessor]", ...args);
}

function noop() {}

const DEFAULTS = {
  cols: 9,
  marginPx: 3,          // ROI inset margin inside each cell
  usedMeanThreshold: 140,
  hasDigitInkThreshold: 20,
  maxTrailingEmptyRowsAfterSeen: 3,
  ocr: {
    lang: "eng",
    whitelist: "123456789",
    psm: "13",          // critical
    // If OCR returns null, try psm10 once as fallback:
    fallbackPSM: "10",
    // Optional confidence threshold to trigger fallback; set null to always fallback only on null
    fallbackConfBelow: null, // e.g. 70
    // Freeze canvas to PNG before recognize (prevents mutation/timing issues)
    freezeToDataURL: true,
  },
};

// -------------------- Public entry point --------------------

async function processScreenshot(imageSrc, statusCallback) {
  const update = statusCallback || noop;

  if (typeof window === "undefined") {
    // You can keep this as a hard error so failures are obvious.
    throw new Error(
      "This image-processor.js uses OpenCV.js and Tesseract.js (browser). " +
      "Node execution requires an OpenCV build for Node."
    );
  }
  if (!window.cv || !cv.Mat) throw new Error("OpenCV.js not loaded (window.cv missing).");
  if (!window.Tesseract) throw new Error("Tesseract.js not loaded (window.Tesseract missing).");

  update("Loading image...");
  const img = await loadImageBrowser(imageSrc);

  const srcCanvas = document.createElement("canvas");
  srcCanvas.width = img.naturalWidth || img.width;
  srcCanvas.height = img.naturalHeight || img.height;
  const sctx = srcCanvas.getContext("2d", { willReadFrequently: true });
  sctx.drawImage(img, 0, 0);

  update("Reading image into OpenCV...");
  const src = cv.imread(srcCanvas); // RGBA
  const bgr = new cv.Mat();
  cv.cvtColor(src, bgr, cv.COLOR_RGBA2BGR);

  try {
    update("Detecting grid lines...");
    const { xLines, yLines } = detectGridLines(bgr);

    const bestX = pickBestXLines(xLines, bgr.cols);
    if (!bestX) throw new Error("Could not find 10 vertical grid lines (9 columns).");

    const xSeq = bestX.win; // 10 lines
    const cellSize = bestX.meanCell;

    const ySeq = pickBestYSequence(yLines, cellSize, bgr.rows);
    if (!ySeq) throw new Error("Could not find consistent horizontal grid lines.");

    // Crop to board rect bounded by detected lines
    const x0 = clampInt(Math.floor(xSeq[0]), 0, bgr.cols - 2);
    const x1 = clampInt(Math.floor(xSeq[9]), 1, bgr.cols - 1);
    const y0 = clampInt(Math.floor(ySeq[0]), 0, bgr.rows - 2);
    const y1 = clampInt(Math.floor(ySeq[ySeq.length - 1]), 1, bgr.rows - 1);

    const cropW = Math.max(2, x1 - x0);
    const cropH = Math.max(2, y1 - y0);

    update("Cropping board...");
    const board = bgr.roi(new cv.Rect(x0, y0, cropW, cropH));
    const xLocal = xSeq.map((x) => x - x0);
    const yLocal = ySeq.map((y) => y - y0);

    update("Initializing OCR...");
    const worker = await getTesseractWorker(DEFAULTS.ocr.lang);

    update("Extracting cells + OCR...");
    const outRows = await extractAndOcr(board, xLocal, yLocal, worker, update);

    return outRows.join("\n");
  } finally {
    bgr.delete();
    src.delete();
  }
}

// -------------------- Image loading (browser) --------------------

function loadImageBrowser(src) {
  // Supports: File/Blob, URL string, dataURL string
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;

    if (src instanceof Blob) {
      const url = URL.createObjectURL(src);
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = (e) => {
        URL.revokeObjectURL(url);
        reject(e);
      };
      img.src = url;
    } else {
      img.src = String(src);
    }
  });
}

// -------------------- Grid detection (OpenCV morphology) --------------------

function detectGridLines(bgrMat) {
  const gray = new cv.Mat();
  cv.cvtColor(bgrMat, gray, cv.COLOR_BGR2GRAY);

  const bin = new cv.Mat();
  cv.adaptiveThreshold(
    gray,
    bin,
    255,
    cv.ADAPTIVE_THRESH_MEAN_C,
    cv.THRESH_BINARY_INV,
    31,
    8
  );

  const vertical = new cv.Mat();
  const horizontal = new cv.Mat();
  bin.copyTo(vertical);
  bin.copyTo(horizontal);

  const h = bin.rows, w = bin.cols;
  const vertKernelLen = Math.max(18, Math.floor(h / 25));
  const horzKernelLen = Math.max(18, Math.floor(w / 25));
  const vertKernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(1, vertKernelLen));
  const horzKernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(horzKernelLen, 1));

  cv.erode(vertical, vertical, vertKernel);
  cv.dilate(vertical, vertical, vertKernel);

  cv.erode(horizontal, horizontal, horzKernel);
  cv.dilate(horizontal, horizontal, horzKernel);

  const vContours = new cv.MatVector();
  const hContours = new cv.MatVector();
  const hierarchy = new cv.Mat();

  const xs = [];
  cv.findContours(vertical, vContours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
  for (let i = 0; i < vContours.size(); i++) {
    const r = cv.boundingRect(vContours.get(i));
    if (r.height > h * 0.45 && r.width < w * 0.15) xs.push(r.x + r.width / 2);
  }

  const ys = [];
  cv.findContours(horizontal, hContours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
  for (let i = 0; i < hContours.size(); i++) {
    const r = cv.boundingRect(hContours.get(i));
    if (r.width > w * 0.45 && r.height < h * 0.15) ys.push(r.y + r.height / 2);
  }

  xs.sort((a, b) => a - b);
  ys.sort((a, b) => a - b);

  const xLines = clusterPositions(xs, 6);
  const yLines = clusterPositions(ys, 6);

  gray.delete(); bin.delete();
  vertical.delete(); horizontal.delete();
  vContours.delete(); hContours.delete(); hierarchy.delete();
  vertKernel.delete(); horzKernel.delete();

  dbg("Grid lines:", { xLines: xLines.length, yLines: yLines.length });
  return { xLines, yLines };
}

function clusterPositions(sortedVals, tol) {
  const clusters = [];
  for (const v of sortedVals) {
    if (!clusters.length) { clusters.push([v]); continue; }
    const last = clusters[clusters.length - 1];
    const lastMean = last.reduce((a, b) => a + b, 0) / last.length;
    if (Math.abs(v - lastMean) <= tol) last.push(v);
    else clusters.push([v]);
  }
  return clusters.map((c) => Math.round(c.reduce((a, b) => a + b, 0) / c.length));
}

function pickBestXLines(xLines, imgW) {
  if (xLines.length < 10) return null;
  const xs = [...xLines].sort((a, b) => a - b);
  let best = null;

  for (let i = 0; i <= xs.length - 10; i++) {
    const win = xs.slice(i, i + 10);
    const gaps = [];
    for (let k = 0; k < 9; k++) gaps.push(win[k + 1] - win[k]);

    const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    const var_ = gaps.reduce((a, b) => a + (b - mean) * (b - mean), 0) / gaps.length;
    const std = Math.sqrt(var_);
    const rel = std / Math.max(1, mean);

    const penalty =
      (mean < imgW * 0.02 ? 2.0 : 0.0) +
      (mean > imgW * 0.25 ? 2.0 : 0.0);

    const score = rel + penalty;
    if (!best || score < best.score) best = { win, score, meanCell: mean };
  }
  return best;
}

function pickBestYSequence(yLines, cellSize, imgH) {
  if (yLines.length < 3) return null;
  const ys = [...yLines].sort((a, b) => a - b);
  const tol = Math.max(6, cellSize * 0.35);

  let bestSeq = null;

  for (let start = 0; start < ys.length; start++) {
    const seq = [ys[start]];
    let cur = ys[start];

    while (true) {
      const target = cur + cellSize;

      let bestIdx = -1;
      let bestDist = Infinity;

      for (let j = start + 1; j < ys.length; j++) {
        if (ys[j] <= cur) continue;
        const d = Math.abs(ys[j] - target);
        if (d < bestDist) { bestDist = d; bestIdx = j; }
        if (ys[j] - target > tol) break;
      }

      if (bestIdx === -1 || bestDist > tol) break;

      const next = ys[bestIdx];
      if (next >= imgH - 2) break;

      seq.push(next);
      cur = next;
    }

    if (!bestSeq || seq.length > bestSeq.length) bestSeq = seq;
  }

  if (!bestSeq || bestSeq.length < 3) return null;
  return bestSeq;
}

// -------------------- Per-cell classification + OCR --------------------

async function extractAndOcr(boardBgr, xLocal, yLocal, worker, update) {
  const cols = DEFAULTS.cols;
  const rows = yLocal.length - 1;

  const outRows = [];
  let seenContent = false;
  let emptyStreak = 0;

  for (let r = 0; r < rows; r++) {
    let rowStr = "";
    let rowHasAny = false;

    for (let c = 0; c < cols; c++) {
      const margin = DEFAULTS.marginPx;

      const cx0 = clampInt(Math.floor(xLocal[c] + margin), 0, boardBgr.cols - 1);
      const cx1 = clampInt(Math.floor(xLocal[c + 1] - margin), 1, boardBgr.cols);
      const cy0 = clampInt(Math.floor(yLocal[r] + margin), 0, boardBgr.rows - 1);
      const cy1 = clampInt(Math.floor(yLocal[r + 1] - margin), 1, boardBgr.rows);

      const cw = Math.max(1, cx1 - cx0);
      const ch = Math.max(1, cy1 - cy0);

      const roi = boardBgr.roi(new cv.Rect(cx0, cy0, cw, ch));
      const cellGray = new cv.Mat();
      cv.cvtColor(roi, cellGray, cv.COLOR_BGR2GRAY);

      const usedInfo = classifyUsed(cellGray);

      let chOut = " ";
      if (!usedInfo.hasDigit) {
        chOut = " ";
      } else if (usedInfo.used) {
        chOut = ".";
        rowHasAny = true;
      } else {
        // active digit -> OCR
        const { digit } = await ocrDigitFromGray64(worker, cellGray);
        if (digit) {
          chOut = digit;
          rowHasAny = true;
        } else {
          // If it looks like a digit but OCR failed, still mark as space (so you can see failures)
          chOut = " ";
        }
      }

      rowStr += chOut;

      roi.delete();
      cellGray.delete();
    }

    // stopping heuristic: after we've seen content, stop after N empty rows
    if (rowHasAny) {
      seenContent = true;
      emptyStreak = 0;
    } else if (seenContent) {
      emptyStreak++;
      if (emptyStreak >= DEFAULTS.maxTrailingEmptyRowsAfterSeen) break;
    }

    const trimmedRight = rowStr.replace(/ +$/, "");
    if (trimmedRight.length > 0) outRows.push(trimmedRight);
    else if (seenContent) outRows.push("");
  }

  update("Done.");
  return outRows;
}

function classifyUsed(cellGray) {
  const bin = new cv.Mat();
  cv.adaptiveThreshold(
    cellGray,
    bin,
    255,
    cv.ADAPTIVE_THRESH_MEAN_C,
    cv.THRESH_BINARY_INV,
    15,
    6
  );

  const nonZero = cv.countNonZero(bin);
  if (nonZero < DEFAULTS.hasDigitInkThreshold) {
    bin.delete();
    return { hasDigit: false, used: false, ink: nonZero, meanInk: null };
  }

  const mean = cv.mean(cellGray, bin)[0];
  const used = mean > DEFAULTS.usedMeanThreshold;

  bin.delete();
  return { hasDigit: true, used, ink: nonZero, meanInk: mean };
}

function matGrayToCanvas(grayMat) {
  const rgba = new cv.Mat();
  cv.cvtColor(grayMat, rgba, cv.COLOR_GRAY2RGBA);
  const canvas = document.createElement("canvas");
  canvas.width = rgba.cols;
  canvas.height = rgba.rows;
  cv.imshow(canvas, rgba);
  rgba.delete();
  return canvas;
}

function prepareCandidate64(cellGray) {
  // A1_gray_norm_64
  const resized = new cv.Mat();
  cv.resize(cellGray, resized, new cv.Size(64, 64), 0, 0, cv.INTER_AREA);

  const norm = new cv.Mat();
  cv.normalize(resized, norm, 0, 255, cv.NORM_MINMAX);

  resized.delete();
  const canvas = matGrayToCanvas(norm);
  norm.delete();
  return canvas;
}

async function ocrDigitFromGray64(worker, cellGray) {
  const canvas = prepareCandidate64(cellGray);
  try {
    const r1 = await ocrWithParams(worker, canvas, DEFAULTS.ocr.psm);
    if (r1.digit && (DEFAULTS.ocr.fallbackConfBelow == null || (r1.conf != null && r1.conf >= DEFAULTS.ocr.fallbackConfBelow))) {
      return r1;
    }

    // Fallback: only if null or low confidence
    if (!r1.digit || (DEFAULTS.ocr.fallbackConfBelow != null && (r1.conf == null || r1.conf < DEFAULTS.ocr.fallbackConfBelow))) {
      const r2 = await ocrWithParams(worker, canvas, DEFAULTS.ocr.fallbackPSM);
      // pick best (prefer non-null; then higher conf)
      return pickBetterOCR(r1, r2);
    }

    return r1;
  } finally {
    // canvas is DOM object; GC handles
  }
}

function pickBetterOCR(a, b) {
  if (a.digit && !b.digit) return a;
  if (!a.digit && b.digit) return b;
  if (!a.digit && !b.digit) return a;
  const ac = a.conf == null ? -1 : a.conf;
  const bc = b.conf == null ? -1 : b.conf;
  return (bc > ac) ? b : a;
}

// -------------------- Tesseract worker --------------------

let _worker = null;

async function getTesseractWorker(lang) {
  if (_worker) return _worker;

  const Tesseract = window.Tesseract;
  dbg("Creating Tesseract worker...");
  const w = await Tesseract.createWorker(lang);

  // Set static params once (whitelist is re-set per call anyway, but harmless)
  await w.setParameters({
    tessedit_char_whitelist: DEFAULTS.ocr.whitelist,
  });

  _worker = w;
  return _worker;
}

async function ocrWithParams(worker, canvas, psm) {
  await worker.setParameters({
    tessedit_char_whitelist: DEFAULTS.ocr.whitelist,
    tessedit_pageseg_mode: String(psm),
  });

  const input = DEFAULTS.ocr.freezeToDataURL ? canvas.toDataURL("image/png") : canvas;
  const { data } = await worker.recognize(input);

  const txt = (data.text || "").trim().replace(/[^1-9]/g, "");
  const digit = txt.length ? txt[0] : null;

  // Best symbol confidence
  let conf = null;
  if (Array.isArray(data.symbols)) {
    for (const s of data.symbols) {
      const t = (s.text || "").replace(/[^1-9]/g, "");
      if (!t) continue;
      const c = typeof s.confidence === "number" ? s.confidence : null;
      if (c != null && (conf == null || c > conf)) conf = c;
    }
  }

  return { digit, conf };
}

// -------------------- Helpers --------------------

function clampInt(v, lo, hi) {
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}

// -------------------- Exports --------------------

const api = {
  processScreenshot,
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = api;
} else {
  window.ImageProcessor = api;
}
