/**
 * greedy ボット(docs/06 §4)。
 * 方策: 1 手の得点最大 → 消去優先 → 同点なら盤中央から遠い順。
 * 平均的な人間の近似として使う。
 */
import { getShape } from "../../src/core/shapes";
import type { Rng } from "../../src/core/rng";
import type { Board, GameState, ResolvedConfig, Shape } from "../../src/core/types";
import { countFilled, evaluateMove } from "../evaluate";
import type { Bot, Move } from "./types";
import { trayPieces } from "./types";

export interface Candidate extends Move {
  score: number;
  lines: number;
}

/** 盤中央からの距離(形状のバウンディングボックス中心)。大きいほど端。 */
export function distanceFromCenter(shape: Shape, x: number, y: number, size: number): number {
  const cx = x + shape.w / 2 - size / 2;
  const cy = y + shape.h / 2 - size / 2;
  return cx * cx + cy * cy;
}

/** a が b より良ければ true(得点 → 消去数 → 中央からの距離 の順)。 */
function better(
  aScore: number,
  aLines: number,
  aDist: number,
  bScore: number,
  bLines: number,
  bDist: number,
): boolean {
  if (aScore !== bScore) return aScore > bScore;
  if (aLines !== bLines) return aLines > bLines;
  return aDist > bDist;
}

/**
 * 与えられた盤・トレイに対する最良手を 1 つ返す。lookahead からも使う。
 * `board` は読むだけで変更しない(評価関数が書き換えて元に戻す)。
 */
export function bestMove(
  board: Board,
  size: number,
  tray: ReadonlyArray<{ trayIndex: number; shapeId: string }>,
  config: ResolvedConfig,
  streak: number,
  filled: number,
): Candidate | null {
  let best: Candidate | null = null;
  let bestDist = -1;

  for (const { trayIndex, shapeId } of tray) {
    const shape = getShape(shapeId);
    if (shape === undefined) continue;
    for (let y = 0; y + shape.h <= size; y++) {
      for (let x = 0; x + shape.w <= size; x++) {
        let ok = true;
        for (const [dx, dy] of shape.cells) {
          if (board[(y + dy) * size + (x + dx)] !== 0) {
            ok = false;
            break;
          }
        }
        if (!ok) continue;

        const value = evaluateMove(board, size, shape, x, y, config.scoring, streak, filled);
        const dist = distanceFromCenter(shape, x, y, size);
        if (
          best === null ||
          better(value.score, value.lines, dist, best.score, best.lines, bestDist)
        ) {
          best = { trayIndex, x, y, score: value.score, lines: value.lines };
          bestDist = dist;
        }
      }
    }
  }
  return best;
}

export const greedyBot: Bot = {
  name: "greedy",
  chooseMove(state: GameState, config: ResolvedConfig, _rng: Rng): Move | null {
    const tray = [...trayPieces(state)];
    const move = bestMove(
      state.board,
      state.size,
      tray,
      config,
      state.streak,
      countFilled(state.board),
    );
    return move === null ? null : { trayIndex: move.trayIndex, x: move.x, y: move.y };
  },
};
