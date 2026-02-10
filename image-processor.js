// Image processing for screenshot board extraction
// Works in both browser and Node.js (with canvas library)

"use strict";

const DEBUG = typeof window === "undefined" || window.location.search.includes("debug=1");

function log(...args) {
  if (DEBUG) console.log("[ImageProcessor]", ...args);
}

async function processScreenshot(imageSrc, statusCallback) {
  const updateStatus = statusCallback || (() => {});
  
  // Load image to canvas
  updateStatus("Loading image...");
  const img = await loadImage(imageSrc);
  const canvas = createCanvas(img.width, img.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0);

  log("Image loaded:", img.width, "x", img.height);

  // Detect board boundaries
  updateStatus("Detecting board boundaries...");
  const boardBounds = detectBoardBoundaries(canvas, ctx);
  if (!boardBounds) {
    log("Board detection failed");
    throw new Error("Could not detect board boundaries");
  }
  log("Board bounds:", boardBounds);

  // Detect grid
  updateStatus("Detecting grid...");
  const grid = detectGrid(canvas, ctx, boardBounds);
  if (!grid) {
    log("Grid detection failed");
    log("  hLines found:", boardBounds.hLines?.length || 0);
    log("  vLines found:", boardBounds.vLines?.length || 0);
    throw new Error("Could not detect grid");
  }
  log("Grid detected:", grid);

  // Extract cells and classify
  updateStatus("Extracting cells...");
  const cells = extractCells(canvas, ctx, boardBounds, grid);
  log("Extracted", cells.length, "cells");

  // Run OCR on cells with digits
  updateStatus("Reading digits (this may take a moment)...");
  const board = await processCellsWithOCR(cells);

  // Generate board string
  return generateBoardString(board);
}

function loadImage(src) {
  if (typeof window !== "undefined") {
    // Browser
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  } else {
    // Node.js
    const { loadImage } = require("canvas");
    return loadImage(src);
  }
}

function createCanvas(width, height) {
  if (typeof window !== "undefined") {
    // Browser
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return canvas;
  } else {
    // Node.js
    const { createCanvas } = require("canvas");
    return createCanvas(width, height);
  }
}

// Convert hex color to RGB
function hexToRgb(hex) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : null;
}

// Check if a color matches (within tolerance)
function colorMatches(r, g, b, targetR, targetG, targetB, tolerance = 10) {
  return Math.abs(r - targetR) <= tolerance &&
         Math.abs(g - targetG) <= tolerance &&
         Math.abs(b - targetB) <= tolerance;
}

function detectBoardBoundaries(canvas, ctx) {
  const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imgData.data;
  const width = canvas.width;
  const height = canvas.height;

  log("Image size:", width, "x", height);

  // Outer border color: #a6afc2
  const outerBorderColor = hexToRgb("#a6afc2");
  log("Looking for outer border color:", outerBorderColor);

  // Find the outer border to locate the grid
  // The border is 6px thick, so we look for lines of this color
  let gridTop = null;
  let gridLeft = null;
  let gridRight = null;

  // Find top border (horizontal line of outer border color)
  // Start from ~464px down (after header area)
  const headerHeight = 464;
  for (let y = headerHeight; y < Math.min(headerHeight + 100, height); y++) {
    let matchingPixels = 0;
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      if (colorMatches(r, g, b, outerBorderColor.r, outerBorderColor.g, outerBorderColor.b, 15)) {
        matchingPixels++;
      }
    }
    // If we find a significant line of the border color, that's the top
    if (matchingPixels > width * 0.3) {
      gridTop = y;
      log("Found top border at y =", gridTop);
      break;
    }
  }

  if (gridTop === null) {
    log("Could not find top border, using header height estimate");
    // Fallback: use header height estimate
    gridTop = headerHeight;
  }

  // Find left and right borders (vertical lines)
  // Account for ~33px white border on sides
  const sideBorder = 33;
  for (let x = sideBorder; x < width - sideBorder; x++) {
    let leftMatching = 0;
    let rightMatching = 0;
    for (let y = gridTop; y < Math.min(gridTop + 50, height); y++) {
      const idx = (y * width + x) * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      if (colorMatches(r, g, b, outerBorderColor.r, outerBorderColor.g, outerBorderColor.b, 15)) {
        leftMatching++;
        rightMatching++;
      }
    }
    if (gridLeft === null && leftMatching > 20) {
      gridLeft = x;
      log("Found left border at x =", gridLeft);
    }
    if (gridRight === null && rightMatching > 20 && x > width / 2) {
      gridRight = x;
      log("Found right border at x =", gridRight);
      break;
    }
  }

  // If we couldn't find borders, use estimates
  if (gridLeft === null) gridLeft = sideBorder;
  if (gridRight === null) gridRight = width - sideBorder;

  // The grid area starts after the outer border (6px thick)
  const borderThickness = 6;
  const gridX = gridLeft + borderThickness;
  const gridY = gridTop + borderThickness;
  const gridWidth = (gridRight - gridLeft) - (2 * borderThickness);
  const gridHeight = height - gridY; // No bottom border, extends to end

  log("Grid area:", gridX, gridY, gridWidth, "x", gridHeight);

  if (gridWidth < 100 || gridHeight < 100) {
    log("Grid area too small");
    return null;
  }

  return {
    x: gridX,
    y: gridY,
    width: gridWidth,
    height: gridHeight,
  };
}

function detectGrid(canvas, ctx, bounds) {
  const imgData = ctx.getImageData(bounds.x, bounds.y, bounds.width, bounds.height);
  const data = imgData.data;
  const width = bounds.width;
  const height = bounds.height;

  log("Analyzing grid in region:", width, "x", height);

  // Inner grid line color: #e2e7ed, 3px thick
  const innerLineColor = hexToRgb("#e2e7ed");
  log("Looking for inner grid lines color:", innerLineColor);

  // Find horizontal grid lines
  const hLines = [];
  for (let y = 0; y < height; y++) {
    let matchingPixels = 0;
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      if (colorMatches(r, g, b, innerLineColor.r, innerLineColor.g, innerLineColor.b, 20)) {
        matchingPixels++;
      }
    }
    // If enough of the row matches the inner line color, it's a grid line
    // Account for 3px thickness - check if line or nearby pixels match
    if (matchingPixels > width * 0.4) {
      hLines.push(y);
    }
  }

  // Find vertical grid lines
  const vLines = [];
  for (let x = 0; x < width; x++) {
    let matchingPixels = 0;
    for (let y = 0; y < height; y++) {
      const idx = (y * width + x) * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      if (colorMatches(r, g, b, innerLineColor.r, innerLineColor.g, innerLineColor.b, 20)) {
        matchingPixels++;
      }
    }
    if (matchingPixels > height * 0.4) {
      vLines.push(x);
    }
  }

  log(`Found ${hLines.length} horizontal, ${vLines.length} vertical lines`);

  // Store for debugging
  bounds.hLines = hLines;
  bounds.vLines = vLines;

  if (hLines.length < 2 || vLines.length < 2) {
    log("Not enough grid lines found");
    return null;
  }

  // Filter lines (remove duplicates that are very close)
  const filteredH = [hLines[0]];
  for (let i = 1; i < hLines.length; i++) {
    if (hLines[i] - filteredH[filteredH.length - 1] > 3) {
      filteredH.push(hLines[i]);
    }
  }
  const filteredV = [vLines[0]];
  for (let i = 1; i < vLines.length; i++) {
    if (vLines[i] - filteredV[filteredV.length - 1] > 3) {
      filteredV.push(vLines[i]);
    }
  }

  log("Filtered lines:", filteredH.length, "horizontal,", filteredV.length, "vertical");

  if (filteredH.length < 2 || filteredV.length < 2) {
    log("Not enough filtered grid lines");
    return null;
  }

  // Calculate cell size from spacing between lines
  const hSpacings = [];
  for (let i = 1; i < filteredH.length; i++) {
    hSpacings.push(filteredH[i] - filteredH[i - 1]);
  }
  const vSpacings = [];
  for (let i = 1; i < filteredV.length; i++) {
    vSpacings.push(filteredV[i] - filteredV[i - 1]);
  }

  log("Horizontal spacings:", hSpacings.slice(0, 10));
  log("Vertical spacings:", vSpacings.slice(0, 10));

  // Find most common spacing (cell size)
  const cellHeight = findMostCommon(hSpacings);
  const cellWidth = findMostCommon(vSpacings);

  log("Cell size:", cellWidth, "x", cellHeight);

  if (!cellHeight || !cellWidth || cellHeight < 10 || cellWidth < 10) {
    log("Invalid cell size");
    return null;
  }

  // Find first cell start (after first grid line)
  const startY = filteredH[0] + 1;
  const startX = filteredV[0] + 1;

  // Estimate number of rows/cols
  const rows = Math.floor((height - startY) / cellHeight);
  const cols = Math.min(9, Math.floor((width - startX) / cellWidth));

  log("Grid dimensions:", rows, "rows x", cols, "cols");

  return {
    cellWidth,
    cellHeight,
    startX,
    startY,
    rows,
    cols,
  };
}

function findMostCommon(arr) {
  const counts = {};
  for (const val of arr) {
    const rounded = Math.round(val);
    counts[rounded] = (counts[rounded] || 0) + 1;
  }
  let max = 0;
  let result = null;
  for (const [val, count] of Object.entries(counts)) {
    if (count > max) {
      max = count;
      result = parseInt(val);
    }
  }
  return result;
}

function extractCells(canvas, ctx, bounds, grid) {
  const cells = [];
  const cellCanvas = createCanvas(grid.cellWidth, grid.cellHeight);
  const cellCtx = cellCanvas.getContext("2d");

  for (let row = 0; row < grid.rows; row++) {
    for (let col = 0; col < grid.cols; col++) {
      const x = bounds.x + grid.startX + col * grid.cellWidth;
      const y = bounds.y + grid.startY + row * grid.cellHeight;

      // Extract cell image
      cellCtx.clearRect(0, 0, cellCanvas.width, cellCanvas.height);
      cellCtx.drawImage(
        canvas,
        x, y, grid.cellWidth, grid.cellHeight,
        0, 0, grid.cellWidth, grid.cellHeight
      );

      const imgData = cellCtx.getImageData(0, 0, grid.cellWidth, grid.cellHeight);
      const state = classifyCell(imgData);

      cells.push({
        row,
        col,
        imageData: cellCanvas.toDataURL ? cellCanvas.toDataURL() : null,
        state,
        canvas: cellCanvas,
      });
    }
  }

  return cells;
}

function classifyCell(imgData) {
  const data = imgData.data;
  const pixelCount = imgData.width * imgData.height;
  let darkPixels = 0;
  let greyPixels = 0;
  let whitePixels = 0;

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const brightness = (r + g + b) / 3;

    if (brightness < 100) {
      darkPixels++; // Black digit
    } else if (brightness >= 100 && brightness < 180) {
      greyPixels++; // Grey digit
    } else if (brightness >= 240) {
      whitePixels++; // White background
    }
  }

  const darkRatio = darkPixels / pixelCount;
  const greyRatio = greyPixels / pixelCount;
  const whiteRatio = whitePixels / pixelCount;

  if (darkRatio > 0.05) {
    return "active"; // Black digit (active cell)
  } else if (greyRatio > 0.05) {
    return "cleared"; // Grey digit (cleared cell)
  } else {
    return "empty"; // Empty cell
  }
}

async function processCellsWithOCR(cells) {
  const board = [];
  const activeCells = cells.filter(c => c.state === "active" || c.state === "cleared");

  log("Processing", activeCells.length, "cells with OCR");

  // Initialize Tesseract worker
  let Tesseract;
  if (typeof window !== "undefined") {
    Tesseract = window.Tesseract;
  } else {
    Tesseract = require("tesseract.js");
  }

  const worker = await Tesseract.createWorker("eng");
  await worker.setParameters({
    tessedit_char_whitelist: "0123456789",
    tessedit_pageseg_mode: Tesseract.PSM.SINGLE_CHAR,
  });

  try {
    for (let i = 0; i < activeCells.length; i++) {
      const cell = activeCells[i];
      // Preprocess cell image for better OCR
      const processedCanvas = preprocessCellImage(cell.canvas);
      const { data: { text } } = await worker.recognize(processedCanvas);
      const digit = text.trim();
      if (digit >= "1" && digit <= "9") {
        cell.digit = digit;
      } else {
        cell.digit = null;
      }
    }
  } finally {
    await worker.terminate();
  }

  // Build board array
  const maxRow = Math.max(...cells.map(c => c.row));
  for (let row = 0; row <= maxRow; row++) {
    const rowCells = cells.filter(c => c.row === row).sort((a, b) => a.col - b.col);
    for (const cell of rowCells) {
      if (cell.state === "active" && cell.digit) {
        board.push({ row, col: cell.col, value: cell.digit });
      } else if (cell.state === "cleared") {
        board.push({ row, col: cell.col, value: "." });
      }
      // Empty cells are skipped (no entry)
    }
  }

  return board;
}

function preprocessCellImage(canvas) {
  // Create a larger canvas for better OCR accuracy
  const scale = 4;
  const newCanvas = createCanvas(canvas.width * scale, canvas.height * scale);
  const ctx = newCanvas.getContext("2d");

  // Draw scaled up with smoothing
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(canvas, 0, 0, newCanvas.width, newCanvas.height);

  // Enhance contrast
  const imgData = ctx.getImageData(0, 0, newCanvas.width, newCanvas.height);
  const data = imgData.data;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const brightness = (r + g + b) / 3;
    
    // Increase contrast: make dark darker, light lighter
    const factor = 1.5;
    const newBrightness = Math.max(0, Math.min(255, (brightness - 128) * factor + 128));
    const ratio = newBrightness / (brightness || 1);
    
    data[i] = Math.max(0, Math.min(255, r * ratio));
    data[i + 1] = Math.max(0, Math.min(255, g * ratio));
    data[i + 2] = Math.max(0, Math.min(255, b * ratio));
  }
  ctx.putImageData(imgData, 0, 0);

  return newCanvas;
}

function generateBoardString(board) {
  const maxRow = Math.max(...board.map(b => b.row));
  const lines = [];

  for (let row = 0; row <= maxRow; row++) {
    const rowCells = board.filter(b => b.row === row).sort((a, b) => a.col - b.col);
    if (rowCells.length === 0) continue;

    let line = "";
    let lastCol = -1;
    for (const cell of rowCells) {
      // Fill gaps with spaces (will be handled as empty in parseBoard)
      while (lastCol < cell.col - 1) {
        line += " ";
        lastCol++;
      }
      line += cell.value;
      lastCol = cell.col;
    }
    lines.push(line);
  }

  return lines.join("\n");
}

// Export for Node.js
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    processScreenshot,
    loadImage,
    createCanvas,
    detectBoardBoundaries,
    detectGrid,
    extractCells,
    classifyCell,
    processCellsWithOCR,
    generateBoardString,
  };
}

