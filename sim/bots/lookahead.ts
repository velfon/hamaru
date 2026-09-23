/**
 * lookahead ボット(docs/06 §4)。逆手の「上手い人」の近似。
 *
 * greedy に加えて、**derive された次のかけらを実際に置いてみる**(1 手先)。
 * 逆手では次に来る形が自分の手で決まるので、ここを読めるかどうかが腕の差になる。
 */
import { validPositions } from "../../src/core/board";
import { countFilled } from "../evaluate";
import type { GameState, ResolvedConfig } from "../../src/core/types";
import { simulate } from "./greedy";
import type { Bot, Move } from "./types";

/** 2 手目まで読む候補の数(全部読むと遅すぎる)。 */
const BEAM = 8;

export const lookaheadBot: Bot = {
  name: "lookahead",
  chooseMove(state: GameState, config: ResolvedConfig): Move | null {
    // 1 手目の価値で候補を絞ってから、上位だけ 2 手目を読む(ビーム探索)。
    const first = validPositions(state.board, state.size, state.piece).map(([x, y]) => {
      const sim = simulate(state, config, x, y);
      return {
        x,
        y,
        sim,
        value: sim.lines * 120 - sim.next.cells.length * 5 - countFilled(sim.board) * 0.4,
      };
    });
    if (first.length === 0) return null;
    first.sort((a, b) => b.value - a.value);

    let best: { x: number; y: number; value: number } | null = null;
    for (const candidate of first.slice(0, BEAM)) {
      const after: GameState = {
        ...state,
        board: candidate.sim.board,
        piece: candidate.sim.next,
        heat: candidate.sim.heat,
        moves: state.moves + 1,
      };
      let bestNext = -Infinity;
      for (const [x2, y2] of validPositions(candidate.sim.board, state.size, candidate.sim.next)) {
        const second = simulate(after, config, x2, y2);
        const v =
          second.lines * 120 - second.next.cells.length * 5 - countFilled(second.board) * 0.4;
        if (v > bestNext) bestNext = v;
      }
      const value = candidate.value + (bestNext === -Infinity ? -800 : bestNext * 0.7);
      if (best === null || value > best.value) best = { x: candidate.x, y: candidate.y, value };
    }
    return best === null ? null : { x: best.x, y: best.y };
  },
};
