// Number Match Solver
// Works in both browser and Node.js

"use strict";

const ROW_SIZE = 9;

// ─── Board helpers ───────────────────────────────────────────────────────────
function parseBoard(str) {
  const lines = str.trim().split("\n").map(l => l.trim()).filter(Boolean);
  const board = [];
  for (const line of lines) {
    const row = [];
    for (const ch of line) {
      if (ch === ".") row.push(0);
      else if (ch >= "1" && ch <= "9") row.push(+ch);
    }
    while (row.length < ROW_SIZE) row.push(-1);
    board.push(...row);
  }
  return board;
}

function getRowCol(idx) { return [Math.floor(idx / ROW_SIZE), idx % ROW_SIZE]; }
function getIndex(r, c) { return r * ROW_SIZE + c; }

function isValidPair(board, i, j) {
  const a = board[i], b = board[j];
  if (a <= 0 || b <= 0) return false;
  return a === b || a + b === 10;
}

function findNextInDir(board, row, col, dr, dc, nRows) {
  let r = row + dr, c = col + dc;
  while (r >= 0 && r < nRows && c >= 0 && c < ROW_SIZE) {
    const idx = r * ROW_SIZE + c;
    if (board[idx] > 0) return idx;
    r += dr; c += dc;
  }
  return -1;
}

function findAllMoves(board) {
  const moves = [];
  const n = board.length;
  const nRows = n / ROW_SIZE;
  for (let i = 0; i < n; i++) {
    if (board[i] <= 0) continue;
    const vi = board[i];
    const ri = Math.floor(i / ROW_SIZE), ci = i % ROW_SIZE;

    // 1) Horizontal / adjacent: next non-empty in 1D
    for (let k = i + 1; k < n; k++) {
      if (board[k] > 0) {
        if (vi === board[k] || vi + board[k] === 10) moves.push([i, k]);
        break;
      }
    }
    // 2) Vertical down
    let j = findNextInDir(board, ri, ci, 1, 0, nRows);
    if (j > i && isValidPair(board, i, j)) moves.push([i, j]);
    // 3) Diagonal down-right
    j = findNextInDir(board, ri, ci, 1, 1, nRows);
    if (j > i && isValidPair(board, i, j)) moves.push([i, j]);
    // 4) Diagonal down-left
    j = findNextInDir(board, ri, ci, 1, -1, nRows);
    if (j > i && isValidPair(board, i, j)) moves.push([i, j]);
  }
  return moves;
}

function applyMove(board, i, j) {
  const b = board.slice();
  b[i] = 0; b[j] = 0;
  // Remove fully empty rows
  const kept = [];
  for (let r = 0; r < b.length / ROW_SIZE; r++) {
    const start = r * ROW_SIZE;
    const row = b.slice(start, start + ROW_SIZE);
    if (row.some(v => v > 0)) kept.push(...row);
  }
  return kept;
}

function extendBoard(board) {
  const remaining = board.filter(v => v > 0);
  let lastIndex = -1;
  for (let i = board.length - 1; i >= 0; i--) {
    if (board[i] !== -1) { lastIndex = i; break; }
  }
  let newBoard;
  if (lastIndex === -1) { newBoard = []; }
  else {
    newBoard = board.slice(0, lastIndex + 1);
    while (newBoard.length && newBoard[newBoard.length - 1] === -1) newBoard.pop();
  }
  newBoard.push(...remaining);
  while (newBoard.length % ROW_SIZE !== 0) newBoard.push(-1);
  return newBoard;
}

function remainingCount(board) {
  let c = 0;
  for (let i = 0; i < board.length; i++) if (board[i] > 0) c++;
  return c;
}

function boardKey(board) { return board.join(","); }

// ─── Solver ──────────────────────────────────────────────────────────────────
function solve(board, topK = 5) {
  const visited = new Set();
  const topResults = []; // [{seq:[...], board:[...]}]
  let maxTopRemaining = Infinity;
  let statesExplored = 0;
  let solved = false;

  function dfs(curBoard, curSeq) {
    if (solved) return;
    const key = boardKey(curBoard);
    if (visited.has(key)) return;
    visited.add(key);
    statesExplored++;

    const moves = findAllMoves(curBoard);
    if (moves.length === 0) {
      const curRemaining = remainingCount(curBoard);
      const curKey = [curRemaining, curSeq.length];
      const worstKey = topResults.length
        ? [remainingCount(topResults[topResults.length - 1].board),
           topResults[topResults.length - 1].seq.length]
        : [Infinity, Infinity];

      if (topResults.length < topK ||
          curKey[0] < worstKey[0] || (curKey[0] === worstKey[0] && curKey[1] < worstKey[1])) {
        topResults.push({ seq: curSeq.slice(), board: curBoard.slice() });
        topResults.sort((a, b) => {
          const ra = remainingCount(a.board), rb = remainingCount(b.board);
          return ra !== rb ? ra - rb : a.seq.length - b.seq.length;
        });
        if (topResults.length > topK) topResults.pop();
        maxTopRemaining = topResults.length
          ? remainingCount(topResults[topResults.length - 1].board) : Infinity;
        if (curRemaining === 0) solved = true;
      }
      return;
    }

    // Prioritize moves that don't cause row removals
    const sortedMoves = moves.slice().sort((moveA, moveB) => {
      const boardA = applyMove(curBoard, moveA[0], moveA[1]);
      const boardB = applyMove(curBoard, moveB[0], moveB[1]);
      const causesRemovalA = boardA.length < curBoard.length;
      const causesRemovalB = boardB.length < curBoard.length;
      
      // Moves that don't cause removal come first
      if (causesRemovalA !== causesRemovalB) {
        return causesRemovalA ? 1 : -1;
      }
      return 0; // Keep original order for moves of same type
    });

    for (const move of sortedMoves) {
      if (solved) return;
      const newBoard = applyMove(curBoard, move[0], move[1]);
      curSeq.push(move);
      dfs(newBoard, curSeq);
      curSeq.pop();
    }
  }

  dfs(board, []);
  return { results: topResults, states: statesExplored };
}

// ─── Display helpers ─────────────────────────────────────────────────────────
function hasClearPath(i, j, board) {
  if (i === j) return false;
  if (i > j) { let t = i; i = j; j = t; }
  const [ri, ci] = getRowCol(i);
  const [rj, cj] = getRowCol(j);

  // All cells between i and j empty?
  let allEmpty = true;
  for (let k = i + 1; k < j; k++) { if (board[k] > 0) { allEmpty = false; break; } }
  if (allEmpty) return true;

  // Vertical
  if (ci === cj) {
    for (let r = ri + 1; r < rj; r++) { if (board[getIndex(r, ci)] > 0) return false; }
    return true;
  }
  // Diagonal
  const rd = rj - ri, cd = cj - ci;
  if (Math.abs(rd) === Math.abs(cd)) {
    const cs = cd > 0 ? 1 : -1;
    let c = ci;
    for (let r = ri + 1; r < rj; r++) {
      c += cs;
      if (c < 0 || c >= ROW_SIZE) return false;
      if (board[getIndex(r, c)] > 0) return false;
    }
    return true;
  }
  return false;
}

function isMoveValidOnBoard(board, move) {
  const [i, j] = move;
  if (i >= board.length || j >= board.length) return false;
  return isValidPair(board, i, j) && hasClearPath(i, j, board);
}

function groupMovesForDisplay(startBoard, moves) {
  // Step 1: Identify which moves trigger row removals
  // Apply moves one by one and mark which ones cause row removals
  const rowRemovalMoves = new Set();
  let testBoard = startBoard;
  
  for (let i = 0; i < moves.length; i++) {
    const move = moves[i];
    const prevLen = testBoard.length;
    testBoard = applyMove(testBoard, move[0], move[1]);
    if (testBoard.length < prevLen) {
      rowRemovalMoves.add(i);
    }
  }

  // Step 2: Split moves into segments between row removals
  // Each row-removal move becomes its own step
  // Non-removal moves between removals are grouped together
  const result = [];
  let currentBoard = startBoard;
  let segmentStart = 0;

  for (let i = 0; i <= moves.length; i++) {
    const isRowRemoval = rowRemovalMoves.has(i);
    const isLast = i === moves.length;

    if (isRowRemoval || isLast) {
      // Process segment from segmentStart to i
      if (i > segmentStart) {
        const segmentMoves = moves.slice(segmentStart, i);
        
        // Group non-removal moves by independence
        let remaining = segmentMoves;
        let segmentBoard = currentBoard;

        while (remaining.length) {
          const subgroup = [];
          const deferred = [];

          // Find all moves valid on current board
          for (const mv of remaining) {
            if (isMoveValidOnBoard(segmentBoard, mv)) {
              subgroup.push(mv);
            } else {
              deferred.push(mv);
            }
          }

          if (subgroup.length === 0) {
            // No valid moves - process first deferred move anyway
            // (it should become valid as we apply moves sequentially)
            if (deferred.length > 0) {
              subgroup.push(deferred[0]);
              deferred.shift();
            } else {
              break;
            }
          }

          // Apply subgroup moves
          let nextBoard = segmentBoard;
          for (const mv of subgroup) {
            nextBoard = applyMove(nextBoard, mv[0], mv[1]);
          }

          // Add subgroup as a step (no row removal)
          result.push({ board: segmentBoard, moves: subgroup, rowRemovalIdx: -1 });
          segmentBoard = nextBoard;
          remaining = deferred;
        }

        currentBoard = segmentBoard;
      }

      // If this is a row-removal move, add it as its own step
      if (isRowRemoval) {
        const move = moves[i];
        result.push({ board: currentBoard, moves: [move], rowRemovalIdx: 0 });
        currentBoard = applyMove(currentBoard, move[0], move[1]);
      }

      segmentStart = i + 1;
    }
  }

  return result;
}

function formatMove(board, move) {
  const [i, j] = move;
  const [ri, ci] = getRowCol(i);
  const [rj, cj] = getRowCol(j);
  const vi = board[i], vj = board[j];
  return `(${ri},${ci})=${vi} <-> (${rj},${cj})=${vj}`;
}

function printBoard(board) {
  for (let i = 0; i < board.length; i += ROW_SIZE) {
    const row = board.slice(i, i + ROW_SIZE);
    const rowStr = row.map(v => v === 0 ? "." : v > 0 ? v : " ").join("");
    console.log(rowStr.trimEnd());
  }
}

// Export for Node.js
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    ROW_SIZE,
    parseBoard,
    getRowCol,
    getIndex,
    isValidPair,
    findAllMoves,
    applyMove,
    extendBoard,
    remainingCount,
    boardKey,
    solve,
    hasClearPath,
    isMoveValidOnBoard,
    groupMovesForDisplay,
    formatMove,
    printBoard,
  };
}

