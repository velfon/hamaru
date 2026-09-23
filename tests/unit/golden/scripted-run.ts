/**
 * golden テスト(docs/06 §3)用の**固定の操作列**。
 *
 * 逆手は供給に乱数が無いので、配置先さえ決定的に選べば全体が決定的になる。
 * 方策は「走査順で最初に置ける位置」= いちばん左上に詰める。
 * この関数を変えると golden が全て変わるため、変更には人間承認が要る。
 */
import { validPositions } from "../../../src/core/board";
import { newGame, place } from "../../../src/core/game";
import type { GameState, Mode, ResolvedConfig } from "../../../src/core/types";

export const GOLDEN_MOVES = 50;
/** startedAt は演出用でロジックに影響しないが、golden を安定させるため固定する。 */
export const GOLDEN_NOW = 0;

export interface GoldenSnapshot {
  seed: string;
  mode: Mode;
  movesRequested: number;
  movesApplied: number;
  score: number;
  heat: number;
  moves: number;
  linesCleared: number;
  longestStreak: number;
  status: string;
  /** 手持ちのかけら(正規化済みの相対座標)。 */
  piece: Array<[number, number]>;
  board: number[];
}

export function runGoldenScript(
  config: ResolvedConfig,
  mode: Mode,
  seed: string,
  moves: number = GOLDEN_MOVES,
): { state: GameState; snapshot: GoldenSnapshot } {
  let state = newGame(config, mode, seed, GOLDEN_NOW);
  let applied = 0;

  for (let m = 0; m < moves && state.status === "playing"; m++) {
    const target = validPositions(state.board, state.size, state.piece)[0];
    if (target === undefined) break;
    const r = place(state, config, target[0], target[1]);
    if (!r.result.ok) break;
    state = r.state;
    applied++;
  }

  return {
    state,
    snapshot: {
      seed,
      mode,
      movesRequested: moves,
      movesApplied: applied,
      score: state.score,
      heat: state.heat,
      moves: state.moves,
      linesCleared: state.linesCleared,
      longestStreak: state.longestStreak,
      status: state.status,
      piece: state.piece.cells.map(([x, y]): [number, number] => [x, y]),
      board: Array.from(state.board),
    },
  };
}
