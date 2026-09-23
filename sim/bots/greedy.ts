/**
 * greedy ボット(docs/06 §4)。逆手の「素直な人」の近似。
 *
 * 方策: 消える手を優先 → 盤を埋めすぎない → **次に来るかけらが小さくなる**手。
 * 3 つ目が逆手ならではで、これが無いとすぐ詰む。
 */
import { canPlace, clearLines, placePiece, validPositions } from "../../src/core/board";
import { deriveNextPiece } from "../../src/core/derive";
import { countFilled } from "../evaluate";
import type { Board, GameState, Piece, ResolvedConfig } from "../../src/core/types";
import type { Bot, Move } from "./types";

export interface Candidate extends Move {
  value: number;
  lines: number;
}

/** 1 手打った後の盤・消えた本数・次のかけら。 */
export function simulate(
  state: GameState,
  config: ResolvedConfig,
  x: number,
  y: number,
): { board: Board; lines: number; next: Piece; heat: number } {
  const placed = state.piece.cells.map(([dx, dy]): [number, number] => [x + dx, y + dy]);
  const filled = placePiece(state.board, state.size, state.piece, x, y);
  const cleared = clearLines(filled, state.size);
  const lines = cleared.rows.length + cleared.cols.length;
  const heat = lines > 0 ? 0 : state.heat + 1;
  const next = deriveNextPiece(
    cleared.board,
    state.size,
    placed,
    heat,
    config.sakate,
    state.moves + 1,
  );
  return { board: cleared.board, lines, next, heat };
}

/** 手の良さ。大きいほど良い。 */
export function valueOf(state: GameState, config: ResolvedConfig, x: number, y: number): Candidate {
  const { board, lines, next } = simulate(state, config, x, y);
  const value = lines * 120 - next.cells.length * 5 - countFilled(board) * 0.4;
  return { x, y, value, lines };
}

export const greedyBot: Bot = {
  name: "greedy",
  chooseMove(state: GameState, config: ResolvedConfig): Move | null {
    let best: Candidate | null = null;
    for (const [x, y] of validPositions(state.board, state.size, state.piece)) {
      if (!canPlace(state.board, state.size, state.piece, x, y)) continue;
      const candidate = valueOf(state, config, x, y);
      if (best === null || candidate.value > best.value) best = candidate;
    }
    return best === null ? null : { x: best.x, y: best.y };
  },
};
