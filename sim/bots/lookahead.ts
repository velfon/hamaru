/**
 * lookahead ボット(docs/06 §4)。
 * トレイ 3 つの順列(最大 6 通り)を試し、各順列を greedy に置いたときの
 * 合計得点が最大になる順列の **最初の手** を選ぶ(深さ 3)。上限の近似。
 */
import type { Rng } from "../../src/core/rng";
import type { GameState, ResolvedConfig } from "../../src/core/types";
import { applyMoveInPlace, countFilled } from "../evaluate";
import { getShape } from "../../src/core/shapes";
import { bestMove } from "./greedy";
import type { Bot, Move } from "./types";
import { trayPieces } from "./types";

type TrayEntry = { trayIndex: number; shapeId: string };

/** 要素数 <= 3 の全順列。 */
export function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [[...items]];
  const out: T[][] = [];
  for (let i = 0; i < items.length; i++) {
    const head = items[i] as T;
    const rest = [...items.slice(0, i), ...items.slice(i + 1)];
    for (const tail of permutations(rest)) out.push([head, ...tail]);
  }
  return out;
}

export const lookaheadBot: Bot = {
  name: "lookahead",
  chooseMove(state: GameState, config: ResolvedConfig, _rng: Rng): Move | null {
    const tray: TrayEntry[] = [...trayPieces(state)];
    if (tray.length === 0) return null;

    const size = state.size;
    const scratch = new Uint8Array(state.board.length);

    let bestTotal = -1;
    let bestFirst: Move | null = null;

    for (const order of permutations(tray)) {
      scratch.set(state.board);
      let filled = countFilled(scratch);
      let streak = state.streak;
      let total = 0;
      let first: Move | null = null;

      for (const entry of order) {
        const move = bestMove(scratch, size, [entry], config, streak, filled);
        if (move === null) break; // この順列では置けない。ここまでの合計で評価する。
        if (first === null) first = { trayIndex: move.trayIndex, x: move.x, y: move.y };
        total += move.score;
        const shape = getShape(entry.shapeId);
        /* c8 ignore next */
        if (shape === undefined) break;
        const applied = applyMoveInPlace(scratch, size, shape, move.x, move.y);
        streak = applied.lines > 0 ? streak + 1 : 0;
        filled = applied.filled;
      }

      if (first !== null && total > bestTotal) {
        bestTotal = total;
        bestFirst = first;
      }
    }
    return bestFirst;
  },
};
