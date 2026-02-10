#!/usr/bin/env node

// Test script for solver with detailed logging
// Usage: node test-solver.js [board-string]

const fs = require("fs");
const {
  parseBoard,
  solve,
  extendBoard,
  remainingCount,
  applyMove,
  formatMove,
  printBoard,
  getRowCol,
  groupMovesForDisplay,
  isMoveValidOnBoard,
} = require("./solver.js");

function printSolutionWithRowRemovals(initialBoard, sequence, phaseLabel) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`${phaseLabel}`);
  console.log(`${"=".repeat(60)}\n`);

  let currentBoard = initialBoard;
  let moveNum = 0;

  for (const move of sequence) {
    moveNum++;
    const [i, j] = move;
    const [ri, ci] = getRowCol(i);
    const [rj, cj] = getRowCol(j);
    const vi = currentBoard[i], vj = currentBoard[j];
    const prevLen = currentBoard.length;
    const prevRows = prevLen / 9;

    console.log(`Move ${moveNum}: ${vi}(${ri},${ci}) <-> ${vj}(${rj},${cj})`);

    currentBoard = applyMove(currentBoard, i, j);
    const newLen = currentBoard.length;
    const newRows = newLen / 9;

    if (newLen < prevLen) {
      const rowsRemoved = prevRows - newRows;
      console.log(`  ⚠️  ROW REMOVAL: ${rowsRemoved} row(s) removed (${prevLen} -> ${newLen} cells, ${prevRows} -> ${newRows} rows)`);
    } else {
      console.log(`  ✓ No row removal (${prevLen} cells, ${prevRows} rows)`);
    }

    // Print board state after move
    console.log("  Board after move:");
    printBoard(currentBoard);
    console.log(`  Remaining: ${remainingCount(currentBoard)} cells\n`);
  }

  console.log(`\n${phaseLabel} Summary:`);
  console.log(`  Total moves: ${sequence.length}`);
  console.log(`  Final remaining: ${remainingCount(currentBoard)} cells`);
  console.log(`  Final board state:`);
  printBoard(currentBoard);
  console.log();

  return currentBoard;
}

function printGroupedSteps(initialBoard, sequence, phaseLabel) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`${phaseLabel} - GROUPED STEPS`);
  console.log(`${"=".repeat(60)}\n`);

  // Debug: Show macro groups first
  console.log("DEBUG: Macro Groups (before sub-grouping):\n");
  let debugBoard = initialBoard;
  let debugMacroNum = 0;
  let debugMoveIdx = 0;
  
  for (const move of sequence) {
    const prevLen = debugBoard.length;
    debugBoard = applyMove(debugBoard, move[0], move[1]);
    debugMoveIdx++;
    
    if (debugBoard.length < prevLen) {
      debugMacroNum++;
      console.log(`  Macro Group ${debugMacroNum} ends at move ${debugMoveIdx} (row removal)`);
    }
  }
  console.log();

  const groups = groupMovesForDisplay(initialBoard, sequence);
  let stepNum = 0;
  let currentBoard = initialBoard;
  let totalMovesShown = 0;

  for (const group of groups) {
    stepNum++;
    const { board: groupBoard, moves: groupMoves, rowRemovalIdx } = group;
    const hasRowRemoval = rowRemovalIdx >= 0;

    console.log(`Step ${stepNum}: ${groupMoves.length} move(s)${hasRowRemoval ? " [ROW REMOVAL]" : ""}`);
    console.log(`  Board at start of step:`);
    printBoard(groupBoard);
    console.log(`  Moves in this step:`);

    // Verify each move is valid on the current board
    for (let m = 0; m < groupMoves.length; m++) {
      const move = groupMoves[m];
      const [i, j] = move;
      const [ri, ci] = getRowCol(i);
      const [rj, cj] = getRowCol(j);
      const vi = groupBoard[i], vj = groupBoard[j];
      const isValid = isMoveValidOnBoard(groupBoard, move);
      const isHighlighted = m === rowRemovalIdx;
      const marker = isHighlighted ? " ⚠️ [TRIGGERS ROW REMOVAL]" : "";
      const validMarker = isValid ? "✓" : "✗ INVALID!";

      console.log(`    ${validMarker} Move ${m + 1}: ${vi}(${ri},${ci}) <-> ${vj}(${rj},${cj})${marker}`);

      if (!isValid) {
        console.log(`      ERROR: This move is not valid on the board at this step!`);
      }
    }

    // Apply all moves in the group
    let afterBoard = groupBoard;
    for (const move of groupMoves) {
      const prevLen = afterBoard.length;
      afterBoard = applyMove(afterBoard, move[0], move[1]);
      if (afterBoard.length < prevLen) {
        const rowsRemoved = (prevLen - afterBoard.length) / 9;
        console.log(`    → Row removal detected: ${rowsRemoved} row(s) removed`);
      }
    }

    console.log(`  Board after step:`);
    printBoard(afterBoard);
    console.log(`  Remaining: ${remainingCount(afterBoard)} cells\n`);

    totalMovesShown += groupMoves.length;
    currentBoard = afterBoard;
  }

  console.log(`\nGrouping Summary:`);
  console.log(`  Total steps: ${groups.length}`);
  console.log(`  Total moves in sequence: ${sequence.length}`);
  console.log(`  Total moves shown in steps: ${totalMovesShown}`);
  if (totalMovesShown !== sequence.length) {
    console.log(`  ⚠️  WARNING: ${sequence.length - totalMovesShown} move(s) missing!`);
    console.log(`  Missing moves:`);
    let shownSet = new Set();
    for (const group of groups) {
      for (const move of group.moves) {
        shownSet.add(`${move[0]},${move[1]}`);
      }
    }
    for (let i = 0; i < sequence.length; i++) {
      const move = sequence[i];
      const key = `${move[0]},${move[1]}`;
      if (!shownSet.has(key)) {
        const [ri, ci] = getRowCol(move[0]);
        const [rj, cj] = getRowCol(move[1]);
        console.log(`    Move ${i + 1}: (${ri},${ci}) <-> (${rj},${cj})`);
      }
    }
  }
  const stepsWithRemoval = groups.filter(g => g.rowRemovalIdx >= 0).length;
  console.log(`  Steps with row removal: ${stepsWithRemoval}`);
  console.log();
}

function main() {
  let boardStr;

  if (process.argv[2]) {
    // Read from file or use as direct input
    if (fs.existsSync(process.argv[2])) {
      boardStr = fs.readFileSync(process.argv[2], "utf-8");
    } else {
      // Treat as direct board string (newlines separated by spaces or \n)
      boardStr = process.argv[2].replace(/\\n/g, "\n");
    }
  } else {
    // Default test board
    boardStr = `147179814
786565452
557892137
61656`;
  }

  console.log("Initial board:");
  const board = parseBoard(boardStr);
  printBoard(board);
  console.log(`Remaining: ${remainingCount(board)} cells\n`);

  const startTime = Date.now();

  // Phase 1
  console.log("=== PHASE 1: SOLVING INITIAL BOARD ===");
  const phase1 = solve(board, 5);
  const phase1Time = ((Date.now() - startTime) / 1000).toFixed(2);

  console.log(`\nPhase 1 completed in ${phase1Time}s`);
  console.log(`States explored: ${phase1.states}`);
  console.log(`Top ${phase1.results.length} results:`);
  phase1.results.forEach((r, i) => {
    console.log(`  #${i + 1}: ${r.seq.length} moves, ${remainingCount(r.board)} remaining`);
  });

  if (!phase1.results.length) {
    console.log("No moves found!");
    return;
  }

  // Print detailed solution for best result
  const bestPhase1 = phase1.results[0];
  const phase1EndBoard = printSolutionWithRowRemovals(
    board,
    bestPhase1.seq,
    "PHASE 1 DETAILED SOLUTION"
  );

  // Print grouped steps
  printGroupedSteps(board, bestPhase1.seq, "PHASE 1");

  // Phase 2
  console.log("\n=== PHASE 2: EXTEND + SOLVE ===");
  const extended = extendBoard(phase1EndBoard);
  console.log("Extended board:");
  printBoard(extended);
  console.log(`Remaining: ${remainingCount(extended)} cells\n`);

  const phase2StartTime = Date.now();
  const phase2 = solve(extended, 5);
  const phase2Time = ((Date.now() - phase2StartTime) / 1000).toFixed(2);

  console.log(`\nPhase 2 completed in ${phase2Time}s`);
  console.log(`States explored: ${phase2.states}`);
  console.log(`Top ${phase2.results.length} results:`);
  phase2.results.forEach((r, i) => {
    console.log(`  #${i + 1}: ${r.seq.length} moves, ${remainingCount(r.board)} remaining`);
  });

  if (phase2.results.length) {
    const bestPhase2 = phase2.results[0];
    printSolutionWithRowRemovals(
      extended,
      bestPhase2.seq,
      "PHASE 2 DETAILED SOLUTION"
    );

    // Print grouped steps
    printGroupedSteps(extended, bestPhase2.seq, "PHASE 2");

    const totalTime = ((Date.now() - startTime) / 1000).toFixed(2);
    const totalMoves = bestPhase1.seq.length + bestPhase2.seq.length;
    const finalRemaining = remainingCount(bestPhase2.board);

    console.log(`${"=".repeat(60)}`);
    console.log(`OVERALL BEST SOLUTION`);
    console.log(`${"=".repeat(60)}`);
    console.log(`Total time: ${totalTime}s`);
    console.log(`Total moves: ${totalMoves} (${bestPhase1.seq.length} + ${bestPhase2.seq.length})`);
    console.log(`Final remaining: ${finalRemaining} cells`);
    console.log(`${"=".repeat(60)}\n`);
  }
}

main();

