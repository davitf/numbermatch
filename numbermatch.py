"""
The game is played on a grid filled with numbers. Grid is x cells wide and infinitely high (it expands vertically if needed)

You remove pairs of the same number, or pairs that add up to 10.

Numbers must be next to each other horizontally, vertically, or diagonally. There can't be any number between them. Distance between the cells has no limit. You can also pair the last number of one row with the first number of the next row.  Empty cells are skipped.

When pairs are cleared, they disappear. If row is empty then its removed and all the rows under it are moved up. 

You can add numbers 5 times. When you add numbers, it collects all the remaining numbers, skipping the empty cells, and appends them starting from the cell after the last number in the grid. 

Each pair cleared gives 1 point. Each row cleared gives 5 rows.

The goal is to either clear the board or get the highest score possible. 

If no moves remain, game ends. 
"""

import time
from typing import Tuple

BOARD1 = """
147179814
786565452
557892137
61656
"""

# The same board as above, but with some pairs cleared.
BOARD2 = """
147179814
78.565452
..78921..
.1656
"""

BOARD3 = """
672936789
594589514
723176352
41425
"""

ROW_SIZE = 9

def parse_board(board_str: str) -> list[int]:
    """
    Parse a board string into a 1D array.
    - Numbers 1-9 represent cells with that number
    - '.' represents cleared cells (0)
    - Empty cells after the last number are represented as -1
    Each row is 9 cells wide.
    """
    lines = [line.strip() for line in board_str.strip().split('\n') if line.strip()]
    board: list[int] = []
    
    for line in lines:
        row: list[int] = []
        for char in line:
            if char == '.':
                row.append(0)  # Cleared cell
            elif char.isdigit():
                row.append(int(char))
        
        # Pad row to 9 cells with -1 (empty/unused cells)
        while len(row) < 9:
            row.append(-1)
        
        board.extend(row)
    
    return board


def get_row_col(index: int) -> Tuple[int, int]:
    """Convert 1D index to (row, col) coordinates."""
    row = index // ROW_SIZE
    col = index % ROW_SIZE
    return row, col


def get_index(row: int, col: int) -> int:
    """Convert (row, col) coordinates to 1D index."""
    return row * ROW_SIZE + col


def is_valid_pair(board: list[int], i: int, j: int) -> bool:
    """
    Check if two cells form a valid pair (same number or sum to 10).
    Returns True if valid, False otherwise.
    """
    val_i = board[i]
    val_j = board[j]
    
    # Both must be numbers (not 0 or -1)
    if val_i <= 0 or val_j <= 0:
        return False
    
    # Same number or sum to 10
    return val_i == val_j or val_i + val_j == 10


def has_clear_path(i: int, j: int, board: list[int]) -> bool:
    """
    Check if there's a clear path between two cells (only empty cells between them).
    Path can be horizontal, vertical, or diagonal. Also handles wrapping
    from last number of one row to first number of next row.
    """
    if i == j:
        return False
    
    # Ensure i < j for consistent range checking
    if i > j:
        i, j = j, i
    
    row_i, col_i = get_row_col(i)
    row_j, col_j = get_row_col(j)
    
    # Check if all cells between i and j are empty (handles horizontal and next-row wrapping)
    if all(board[k] <= 0 for k in range(i + 1, j)):
        return True
    
    # Check vertical path: same column, check all cells in the vertical line between them
    if col_i == col_j:
        # Check all cells in the column between the two rows (excluding the endpoints)
        for row in range(row_i + 1, row_j):
            idx = get_index(row, col_i)
            if board[idx] > 0:
                return False
        return True
    
    # Check diagonal path: check if cells form a diagonal line and all intermediate cells are empty
    row_diff = row_j - row_i
    col_diff = col_j - col_i

    # Check if it's a diagonal (same absolute difference in rows and columns)
    if abs(row_diff) == abs(col_diff):
        # Check all cells along the diagonal path between them
        col_step = 1 if col_diff > 0 else -1

        col = col_i
        for row in range(row_i + 1, row_j):
            col += col_step
            if col < 0 or col >= ROW_SIZE:
                return False

            idx = get_index(row, col)
            if board[idx] > 0:
                return False

        return True
    
    return False


def _find_next_in_direction(
    board: list[int], row: int, col: int, d_row: int, d_col: int, n_rows: int
) -> int:
    """Find the next non-empty cell starting from (row,col) going in direction
    (d_row, d_col), skipping empty cells. Returns the 1D index or -1."""
    r, c = row + d_row, col + d_col
    while 0 <= r < n_rows and 0 <= c < ROW_SIZE:
        idx = r * ROW_SIZE + c
        if board[idx] > 0:
            return idx
        r += d_row
        c += d_col
    return -1


def find_all_moves(board: list[int]) -> list[Tuple[int, int]]:
    """
    Find all possible moves (pairs that can be removed).
    For each active cell, checks 4 directions for the nearest non-empty neighbor:
      - horizontal/adjacent (next in 1D order, wrapping across rows)
      - vertical (down, same column)
      - diagonal down-right
      - diagonal down-left
    Returns a list of tuples (i, j) where i < j are indices of the pair.
    """
    moves: list[Tuple[int, int]] = []
    n = len(board)
    n_rows = n // ROW_SIZE

    for i in range(n):
        if board[i] <= 0:
            continue

        vi = board[i]
        row_i, col_i = i // ROW_SIZE, i % ROW_SIZE

        # 1) Horizontal / adjacent: next non-empty cell in 1D order
        for k in range(i + 1, n):
            if board[k] > 0:
                if vi == board[k] or vi + board[k] == 10:
                    moves.append((i, k))
                break

        # 2) Vertical (down): same column, next row with non-empty cell
        j = _find_next_in_direction(board, row_i, col_i, 1, 0, n_rows)
        if j > i and is_valid_pair(board, i, j):
            moves.append((i, j))

        # 3) Diagonal down-right
        j = _find_next_in_direction(board, row_i, col_i, 1, 1, n_rows)
        if j > i and is_valid_pair(board, i, j):
            moves.append((i, j))

        # 4) Diagonal down-left
        j = _find_next_in_direction(board, row_i, col_i, 1, -1, n_rows)
        if j > i and is_valid_pair(board, i, j):
            moves.append((i, j))

    return moves


def extend_board(board: list[int]) -> list[int]:
    """
    Extend the board by collecting all remaining numbers (not 0 or -1)
    and appending them after the last number in the grid.
    """
    # Collect all remaining numbers (skip empty cells 0 and -1)
    remaining: list[int] = [val for val in board if val > 0]
    
    # Find the last index that has a number (not -1)
    last_index = -1
    for i in range(len(board) - 1, -1, -1):
        if board[i] != -1:  # Last cell that's not an unused cell
            last_index = i
            break
    
    # Create new board: keep everything up to and including last_index
    new_board: list[int]
    if last_index == -1:
        new_board = []
    else:
        new_board = board[:last_index + 1].copy()
        # Remove any trailing -1 values
        while new_board and new_board[-1] == -1:
            new_board.pop()
    
    # Append the collected remaining numbers
    new_board.extend(remaining)
    
    # Pad with -1 to ensure rows are complete (multiple of 9)
    while len(new_board) % 9 != 0:
        new_board.append(-1)
    
    return new_board


def apply_move(board: list[int], i: int, j: int) -> list[int]:
    """
    Apply a move: clear cells i and j, then remove fully empty rows.
    Returns a new board.
    """
    new_board = board.copy()
    new_board[i] = 0
    new_board[j] = 0

    # Remove fully empty rows (all cells <= 0)
    num_rows = len(new_board) // ROW_SIZE
    kept: list[int] = []
    for r in range(num_rows):
        row_start = r * ROW_SIZE
        row_slice = new_board[row_start:row_start + ROW_SIZE]
        if any(val > 0 for val in row_slice):
            kept.extend(row_slice)

    # If all rows were removed, return empty board
    if not kept:
        return []

    return kept


def board_key(board: list[int]) -> tuple[int, ...]:
    """Convert board to a hashable tuple for deduplication."""
    return tuple(board)


def remaining_count(board: list[int]) -> int:
    """Count the number of remaining number cells (> 0) on the board."""
    return sum(1 for v in board if v > 0)


# A result from the solver: (sequence of moves, final board state)
SolveResult = Tuple[list[Tuple[int, int]], list[int]]


def solve(board: list[int], top_k: int = 5) -> list[SolveResult]:
    """
    DFS solver: find the sequences of moves that leave the fewest remaining cells.
    Returns the top_k results as (sequence, end_board) pairs, sorted best first
    (fewest remaining cells).
    """
    visited: set[tuple[int, ...]] = set()
    # Store top_k results: (sequence, end_board), sorted best-first (fewest remaining)
    top_results: list[SolveResult] = []
    max_top_remaining = float('inf')  # Worst remaining count in top_results
    states_explored = 0
    start_time = time.time()
    last_print_time = start_time

    solved = False

    def dfs(cur_board: list[int], current_sequence: list[Tuple[int, int]]) -> None:
        nonlocal max_top_remaining, states_explored, last_print_time, solved

        if solved:
            return

        key = board_key(cur_board)
        if key in visited:
            return
        visited.add(key)
        states_explored += 1

        # Periodic progress report
        now = time.time()
        if now - last_print_time >= 2.0:
            elapsed = now - start_time
            best_remaining = remaining_count(top_results[0][1]) if top_results else -1
            print(f"  [{elapsed:.1f}s] States explored: {states_explored}, "
                  f"best so far: {best_remaining} remaining, "
                  f"current depth: {len(current_sequence)}")
            last_print_time = now

        moves = find_all_moves(cur_board)

        if not moves:
            # Base case: no more moves — record if good enough
            cur_remaining = remaining_count(cur_board)
            worst_key = (max_top_remaining, len(top_results[-1][0])) if top_results else (float('inf'), float('inf'))
            cur_key = (cur_remaining, len(current_sequence))
            if len(top_results) < top_k or cur_key < worst_key:
                top_results.append((current_sequence.copy(), cur_board.copy()))
                # Sort by remaining count ascending (fewest first), then by move count (fewer first)
                top_results.sort(key=lambda r: (remaining_count(r[1]), len(r[0])))
                if len(top_results) > top_k:
                    top_results.pop()
                max_top_remaining = remaining_count(top_results[-1][1]) if top_results else float('inf')

                if cur_remaining == remaining_count(top_results[0][1]):
                    elapsed = now - start_time
                    print(f"  [{elapsed:.1f}s] New best: {cur_remaining} remaining, "
                          f"{len(current_sequence)} moves "
                          f"(states explored: {states_explored})")

                if cur_remaining == 0:
                    solved = True
            return

        for move in moves:
            if solved:
                return
            new_board = apply_move(cur_board, move[0], move[1])
            current_sequence.append(move)
            dfs(new_board, current_sequence)
            current_sequence.pop()

    print("Solving...")
    dfs(board, [])
    elapsed = time.time() - start_time
    best_remaining = remaining_count(top_results[0][1]) if top_results else -1
    print(f"Done in {elapsed:.1f}s. States explored: {states_explored}, "
          f"best: {best_remaining} remaining")
    return top_results


CELL_SIZE = 50
LINE_COLORS = [
    "#E53935", "#1E88E5", "#43A047", "#FB8C00", "#8E24AA",
    "#00ACC1", "#D81B60", "#6D4C41", "#546E7A", "#FFB300",
    "#7CB342", "#039BE5", "#C0CA33", "#F4511E", "#5E35B1",
]


def is_move_valid_on_board(board: list[int], move: Tuple[int, int]) -> bool:
    """Check if a move can be performed on the given board state."""
    i, j = move
    if i >= len(board) or j >= len(board):
        return False
    return is_valid_pair(board, i, j) and has_clear_path(i, j, board)


def group_moves_for_display(
    start_board: list[int], moves: list[Tuple[int, int]]
) -> list[Tuple[list[int], list[Tuple[int, int]], int]]:
    """
    Group moves for display in two levels:
    1. First, split the ordered move sequence into macro groups at row-removal
       boundaries: process moves in order, and whenever a move causes a row
       removal, end the macro group there (that move is the last in the group).
    2. Within each macro group, sub-group by independence: all moves that are
       valid on the current board form one visual step; moves that only become
       valid after earlier ones are cleared go into the next sub-group.

    Returns list of (board_at_start, moves_in_subgroup, row_removal_move_idx).
    row_removal_move_idx is the index within the subgroup of the move that
    triggers a row removal, or -1 if no row removal occurs in that subgroup.
    Only the last subgroup of a macro group can have row_removal_move_idx >= 0.
    """
    # --- Step 1: split into macro groups at row-removal boundaries ---
    macro_groups: list[Tuple[list[int], list[Tuple[int, int]], bool]] = []
    current_board = start_board
    current_macro: list[Tuple[int, int]] = []
    macro_start_board = start_board

    for move in moves:
        prev_len = len(current_board)
        current_board = apply_move(current_board, move[0], move[1])
        current_macro.append(move)

        if len(current_board) < prev_len:
            # Row removal — end this macro group
            macro_groups.append((macro_start_board, current_macro, True))
            macro_start_board = current_board
            current_macro = []

    if current_macro:
        macro_groups.append((macro_start_board, current_macro, False))

    # --- Step 2: within each macro group, sub-group by independence ---
    result: list[Tuple[list[int], list[Tuple[int, int]], int]] = []

    for macro_board, macro_moves, has_row_removal in macro_groups:
        current = macro_board
        remaining = list(macro_moves)

        while remaining:
            subgroup: list[Tuple[int, int]] = []
            deferred: list[Tuple[int, int]] = []

            for mv in remaining:
                if is_move_valid_on_board(current, mv):
                    subgroup.append(mv)
                else:
                    deferred.append(mv)

            if not subgroup:
                break

            # Apply subgroup moves
            next_board = current
            for mv in subgroup:
                next_board = apply_move(next_board, mv[0], mv[1])

            # Only the last subgroup in a row-removal macro group gets the
            # highlight; find which move actually triggers the removal.
            row_removal_idx = -1
            if not deferred and has_row_removal:
                # This is the last subgroup — find the triggering move
                for k in range(len(subgroup) - 1, -1, -1):
                    test_board = current
                    for m_idx, m in enumerate(subgroup):
                        if m_idx != k:
                            test_board = apply_move(test_board, m[0], m[1])
                    before = len(test_board)
                    after = apply_move(test_board, subgroup[k][0], subgroup[k][1])
                    if len(after) < before:
                        row_removal_idx = k
                        break

            result.append((current, subgroup, row_removal_idx))
            current = next_board
            remaining = deferred

    return result


def board_to_svg(
    board: list[int],
    moves: list[Tuple[int, int]] | None = None,
    highlight_move_idx: int = -1,
) -> str:
    """Render board as inline SVG with optional move lines.
    highlight_move_idx: index within moves to draw with a thicker line."""
    if not board:
        return '<div style="color:#4CAF50;font-weight:bold;padding:8px">Board cleared!</div>'

    num_rows = len(board) // ROW_SIZE
    width = ROW_SIZE * CELL_SIZE
    height = num_rows * CELL_SIZE

    highlighted: set[int] = set()
    if moves:
        for mi, mj in moves:
            highlighted.add(mi)
            highlighted.add(mj)

    parts: list[str] = [
        f'<svg width="{width}" height="{height}" '
        f'xmlns="http://www.w3.org/2000/svg" style="display:block">'
    ]

    # Draw cells
    for idx in range(len(board)):
        row, col = get_row_col(idx)
        x = col * CELL_SIZE
        y = row * CELL_SIZE
        val = board[idx]

        if idx in highlighted:
            fill, stroke = "#C8E6C9", "#4CAF50"
        elif val > 0:
            fill, stroke = "#F5F5F5", "#DDD"
        elif val == 0:
            fill, stroke = "#FAFAFA", "#EEE"
        else:
            fill, stroke = "#FFF", "#F5F5F5"

        parts.append(
            f'<rect x="{x + 2}" y="{y + 2}" '
            f'width="{CELL_SIZE - 4}" height="{CELL_SIZE - 4}" '
            f'fill="{fill}" stroke="{stroke}" rx="4"/>'
        )

        if val > 0:
            fw = "bold" if idx in highlighted else "normal"
            parts.append(
                f'<text x="{x + CELL_SIZE // 2}" y="{y + CELL_SIZE // 2 + 7}" '
                f'text-anchor="middle" font-size="20" font-family="monospace" '
                f'font-weight="{fw}" fill="#333">{val}</text>'
            )
        elif val == 0:
            parts.append(
                f'<text x="{x + CELL_SIZE // 2}" y="{y + CELL_SIZE // 2 + 5}" '
                f'text-anchor="middle" font-size="16" fill="#CCC">\u00b7</text>'
            )

    # Draw move lines (no numbers, just colored lines connecting the pairs)
    if moves:
        for k, (mi, mj) in enumerate(moves):
            row_i, col_i = get_row_col(mi)
            row_j, col_j = get_row_col(mj)
            x1 = col_i * CELL_SIZE + CELL_SIZE // 2
            y1 = row_i * CELL_SIZE + CELL_SIZE // 2
            x2 = col_j * CELL_SIZE + CELL_SIZE // 2
            y2 = row_j * CELL_SIZE + CELL_SIZE // 2
            color = LINE_COLORS[k % len(LINE_COLORS)]
            width = 5 if k == highlight_move_idx else 3
            opacity = 0.9 if k == highlight_move_idx else 0.7

            parts.append(
                f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" '
                f'stroke="{color}" stroke-width="{width}" stroke-linecap="round" '
                f'opacity="{opacity}"/>'
            )

    parts.append("</svg>")
    return "\n".join(parts)


def generate_solution_html(
    initial_board: list[int],
    phases: list[Tuple[str, list[int], list[Tuple[int, int]]]],
    filename: str = "solution.html",
) -> None:
    """
    Generate HTML page visualizing the solution.
    phases: list of (label, start_board, move_sequence).
    """
    html = [
        '<!DOCTYPE html>',
        '<html><head><meta charset="utf-8">',
        '<title>Number Match Solution</title>',
        '<style>',
        'body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;',
        '       max-width: 520px; margin: 0 auto; padding: 20px; background: #FAFAFA; }',
        'h1 { color: #333; border-bottom: 2px solid #4CAF50; padding-bottom: 8px; }',
        'h2 { color: #555; margin-top: 36px; }',
        '.step { background: white; border-radius: 8px; padding: 16px; margin: 16px 0;',
        '        box-shadow: 0 1px 3px rgba(0,0,0,0.1); }',
        '.step-title { font-weight: bold; margin-bottom: 4px; color: #444; }',
        '.move-list { font-size: 13px; color: #666; margin: 4px 0 12px 0;',
        '             line-height: 1.7; }',
        '.move-item { display: inline-block; background: #F5F5F5; border-radius: 4px;',
        '             padding: 1px 6px; margin: 2px; white-space: nowrap; }',
        '.extend-banner { background: #FFF3E0; border-left: 4px solid #FF9800;',
        '                  padding: 12px 16px; margin: 24px 0; border-radius: 4px;',
        '                  font-weight: bold; color: #E65100; }',
        '.final { background: #E8F5E9; }',
        '.row-removed { font-size: 12px; color: #E65100; font-style: italic;',
        '               margin-top: 4px; }',
        '</style></head><body>',
        '<h1>Number Match Solution</h1>',
    ]

    move_counter = 0
    step_counter = 0

    for phase_idx, (label, start_board, moves) in enumerate(phases):
        html.append(f'<h2>{label}</h2>')

        if phase_idx > 0:
            html.append(
                '<div class="extend-banner">'
                '\u27f3 Board extended &mdash; remaining numbers duplicated</div>'
            )
            html.append('<div class="step">')
            html.append('<div class="step-title">Extended board</div>')
            html.append(board_to_svg(start_board))
            html.append('</div>')

        groups = group_moves_for_display(start_board, moves)

        for group_board, group_moves, row_removal_idx in groups:
            step_counter += 1
            rows_removed = row_removal_idx >= 0

            # Move descriptions
            descs: list[str] = []
            for mi, mj in group_moves:
                vi, vj = group_board[mi], group_board[mj]
                move_counter += 1
                descs.append(
                    f'<span class="move-item">'
                    f'{vi} \u2194 {vj}'
                    f'</span>'
                )

            n = len(group_moves)
            html.append('<div class="step">')
            html.append(
                f'<div class="step-title">'
                f'Step {step_counter}: '
                f'{n} move{"s" if n != 1 else ""}'
                f'{" (removes row)" if rows_removed else ""}'
                f'</div>'
            )
            html.append(f'<div class="move-list">{" ".join(descs)}</div>')
            html.append(board_to_svg(
                group_board, group_moves,
                highlight_move_idx=row_removal_idx,
            ))

            if rows_removed:
                # Compute how many rows removed
                temp = group_board
                for mv in group_moves:
                    temp = apply_move(temp, mv[0], mv[1])
                n_removed = (len(group_board) - len(temp)) // ROW_SIZE
                html.append(
                    f'<div class="row-removed">'
                    f'\u2191 {n_removed} empty row{"s" if n_removed != 1 else ""} '
                    f'removed after this step</div>'
                )

            html.append('</div>')

        # Final board after phase
        final_board = start_board
        for move in moves:
            final_board = apply_move(final_board, move[0], move[1])

        remaining = remaining_count(final_board)
        html.append('<div class="step final">')
        html.append(
            f'<div class="step-title">After {label}: '
            f'{remaining} cell{"s" if remaining != 1 else ""} remaining</div>'
        )
        html.append(board_to_svg(final_board))
        html.append('</div>')

    html.append('</body></html>')

    with open(filename, 'w') as f:
        f.write('\n'.join(html))

    print(f"Solution visualization saved to {filename}")


def print_board(board: list[int]) -> None:
    """Print board in a readable format."""
    for i in range(0, len(board), 9):
        row = board[i:i+9]
        row_str = ''.join(
            '.' if val == 0 else str(val) if val > 0 else ' '
            for val in row
        )
        print(row_str.rstrip())


def format_move(board: list[int], move: Tuple[int, int]) -> str:
    """Format a move for display."""
    i, j = move
    row_i, col_i = get_row_col(i)
    row_j, col_j = get_row_col(j)
    val_i = board[i]
    val_j = board[j]
    return f"({row_i},{col_i})={val_i} <-> ({row_j},{col_j})={val_j}"


def print_sequence(start_board: list[int], sequence: list[Tuple[int, int]]) -> None:
    """Print a move sequence step by step."""
    b = start_board
    for step, move in enumerate(sequence):
        print(f"  {step + 1}. {format_move(b, move)}")
        b = apply_move(b, move[0], move[1])
    print("  Board after these moves:")
    print_board(b)


if __name__ == "__main__":
    print("Enter the board (use . for cleared cells, empty line to finish):")
    lines: list[str] = []
    while True:
        line = input()
        if not line.strip():
            break
        lines.append(line)

    board_str = "\n".join(lines)
    board = parse_board(board_str)

    print("\n=== BOARD ===")
    print_board(board)

    print("\n=== PHASE 1: SOLVING INITIAL BOARD ===")
    top_results = solve(board)

    if not top_results:
        print("No moves found!")
    else:
        print(f"\nTop {len(top_results)} results from phase 1:")
        for rank, (seq, end_board) in enumerate(top_results):
            remaining = remaining_count(end_board)
            print(f"  #{rank + 1}: {len(seq)} moves, {remaining} cells remaining")

        # Phase 2: extend each top board and solve again
        print("\n=== PHASE 2: EXTEND + SOLVE ===")
        overall_best_remaining = float('inf')
        overall_best_phase1_rank = -1
        overall_best_phase2_seq: list[Tuple[int, int]] = []
        overall_best_phase1_seq: list[Tuple[int, int]] = []
        overall_best_extended_board: list[int] = []
        overall_best_final_board: list[int] = []

        for rank, (phase1_seq, end_board) in enumerate(top_results):
            remaining = remaining_count(end_board)
            print(f"\n--- Extending result #{rank + 1} "
                  f"({len(phase1_seq)} moves, {remaining} cells remaining) ---")
            extended = extend_board(end_board)
            print_board(extended)

            phase2_results = solve(extended)
            if phase2_results:
                phase2_seq, phase2_end = phase2_results[0]
                final_remaining = remaining_count(phase2_end)
                total_moves = len(phase1_seq) + len(phase2_seq)
                print(f"  Phase 2 best: {len(phase2_seq)} moves, "
                      f"{final_remaining} remaining (total {total_moves} moves)")

                if final_remaining < overall_best_remaining:
                    overall_best_remaining = final_remaining
                    overall_best_phase1_rank = rank
                    overall_best_phase1_seq = phase1_seq
                    overall_best_phase2_seq = phase2_seq
                    overall_best_extended_board = extended
                    overall_best_final_board = phase2_end
                    if final_remaining == 0:
                        break
            else:
                print("  No moves after extending!")

        # Print overall best
        total_moves = len(overall_best_phase1_seq) + len(overall_best_phase2_seq)
        print(f"\n{'=' * 50}")
        print(f"=== OVERALL BEST: {int(overall_best_remaining)} remaining, "
              f"{total_moves} moves "
              f"(from result #{overall_best_phase1_rank + 1}) ===")
        print(f"{'=' * 50}")

        print(f"\nPhase 1 ({len(overall_best_phase1_seq)} moves):")
        print_sequence(board, overall_best_phase1_seq)

        print("\n  [extend]")
        print_board(overall_best_extended_board)

        print(f"\nPhase 2 ({len(overall_best_phase2_seq)} moves):")
        print_sequence(overall_best_extended_board, overall_best_phase2_seq)

        # Generate HTML visualization
        phases = [
            ("Phase 1", board, overall_best_phase1_seq),
            ("Phase 2", overall_best_extended_board, overall_best_phase2_seq),
        ]
        generate_solution_html(board, phases)
