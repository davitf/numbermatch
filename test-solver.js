#!/usr/bin/env node

// Test script for solver with detailed logging
// Usage: node test-solver.js [board-string] [--verbose]

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
  solveMultiPhase,
} = require("./solver.js");

function printSolutionWithRowRemovals(initialBoard, sequence, phaseLabel, verbose = false) {
  if (!verbose) {
    // Non-verbose: just return the final board
    let currentBoard = initialBoard;
    for (const move of sequence) {
      currentBoard = applyMove(currentBoard, move[0], move[1]);
    }
    return currentBoard;
  }

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

function printGroupedSteps(initialBoard, sequence, phaseLabel, verbose = false) {
  const groups = groupMovesForDisplay(initialBoard, sequence);
  let stepNum = 0;
  let totalMovesShown = 0;

  if (verbose) {
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
  }

  for (const group of groups) {
    stepNum++;
    const { board: groupBoard, moves: groupMoves, rowRemovalIdx } = group;
    const hasRowRemoval = rowRemovalIdx >= 0;

    console.log(`Step ${stepNum}: ${groupMoves.length} move(s)${hasRowRemoval ? " [ROW REMOVAL]" : ""}`);
    
    if (verbose) {
      console.log(`  Board at start of step:`);
      printBoard(groupBoard);
    }
    
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
      const validMarker = verbose && !isValid ? "✗ INVALID!" : "✓";

      console.log(`    ${validMarker} Move ${m + 1}: ${vi}(${ri},${ci}) <-> ${vj}(${rj},${cj})${marker}`);

      if (verbose && !isValid) {
        console.log(`      ERROR: This move is not valid on the board at this step!`);
      }
    }

    // Apply all moves in the group
    let afterBoard = groupBoard;
    for (const move of groupMoves) {
      const prevLen = afterBoard.length;
      afterBoard = applyMove(afterBoard, move[0], move[1]);
      if (verbose && afterBoard.length < prevLen) {
        const rowsRemoved = (prevLen - afterBoard.length) / 9;
        console.log(`    → Row removal detected: ${rowsRemoved} row(s) removed`);
      }
    }

    if (verbose) {
      console.log(`  Board after step:`);
      printBoard(afterBoard);
    }
    console.log(`  Remaining: ${remainingCount(afterBoard)} cells\n`);

    totalMovesShown += groupMoves.length;
  }

  console.log(`Grouping Summary:`);
  console.log(`  Total steps: ${groups.length}`);
  console.log(`  Total moves in sequence: ${sequence.length}`);
  console.log(`  Total moves shown in steps: ${totalMovesShown}`);
  if (verbose && totalMovesShown !== sequence.length) {
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
  if (verbose) {
    console.log();
  }
}

function main() {
  let boardStr;
  let verbose = false;

  // Check for verbose flag
  const args = process.argv.slice(2);
  if (args.includes("--verbose") || args.includes("-v")) {
    verbose = true;
    args.splice(args.indexOf("--verbose") >= 0 ? args.indexOf("--verbose") : args.indexOf("-v"), 1);
  }

  if (args[0]) {
    // Read from file or use as direct input
    if (fs.existsSync(args[0])) {
      boardStr = fs.readFileSync(args[0], "utf-8");
    } else {
      // Treat as direct board string (newlines separated by spaces or \n)
      boardStr = args[0].replace(/\\n/g, "\n");
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

  // Use multi-phase solver
  console.log("=== MULTI-PHASE SOLVER ===");
  const result = solveMultiPhase(board, 5, 100, (msg) => {
    // Always log progress messages
    console.log(msg);
  });

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(2);

  console.log(`\n${"=".repeat(60)}`);
  console.log(`SOLVER SUMMARY`);
  console.log(`${"=".repeat(60)}`);
  console.log(`Total time: ${totalTime}s`);
  console.log(`Total states explored: ${result.totalStatesExplored}`);
  console.log(`Phases completed: ${result.allPhases.length}`);

  if (!result.bestSolution) {
    console.log("No solution found!");
    return;
  }

  const { bestSolution } = result;
  console.log(`Best solution: ${bestSolution.remaining} remaining, ${bestSolution.totalMoves} total moves`);
  console.log(`Phases: ${bestSolution.phaseSeqs.length}`);
  bestSolution.phaseSeqs.forEach((seq, i) => {
    console.log(`  Phase ${i + 1}: ${seq.length} moves`);
  });
  console.log(`${"=".repeat(60)}\n`);

  // Print detailed solution for each phase
  // phaseBoards contains the board BEFORE each phase starts
  for (let phaseIdx = 0; phaseIdx < bestSolution.phaseSeqs.length; phaseIdx++) {
    const phaseSeq = bestSolution.phaseSeqs[phaseIdx];
    const phaseLabel = `PHASE ${phaseIdx + 1} DETAILED SOLUTION`;
    
    // Get the starting board for this phase from phaseBoards
    const phaseStartBoard = bestSolution.phaseBoards[phaseIdx];
    
    const phaseEndBoard = printSolutionWithRowRemovals(
      phaseStartBoard,
      phaseSeq,
      phaseLabel,
      verbose
    );

    // Print grouped steps (always show, but skip boards if not verbose)
    printGroupedSteps(phaseStartBoard, phaseSeq, `PHASE ${phaseIdx + 1}`, verbose);

    // If not last phase, show extended board (which is the next phase's starting board)
    if (verbose && phaseIdx < bestSolution.phaseSeqs.length - 1) {
      const nextPhaseBoard = bestSolution.phaseBoards[phaseIdx + 1];
      console.log("\n[Board extended for next phase]");
      printBoard(nextPhaseBoard);
      console.log(`Remaining: ${remainingCount(nextPhaseBoard)} cells\n`);
    }
  }

  console.log(`${"=".repeat(60)}`);
  console.log(`FINAL RESULT`);
  console.log(`${"=".repeat(60)}`);
  console.log(`Total moves: ${bestSolution.totalMoves}`);
  console.log(`Final remaining: ${bestSolution.remaining} cells`);
  console.log(`Final board state:`);
  printBoard(bestSolution.finalBoard);
  console.log(`${"=".repeat(60)}\n`);
}

main();

