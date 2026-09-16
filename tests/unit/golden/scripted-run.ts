/**
 * golden テスト(docs/06 §3)用の**固定の操作列**。
 *
 * 乱数を一切使わず、手番と形状だけから配置先を決める決定的なスクリプトなので、
 * 同じ config・同じシードなら必ず同じ最終状態になる。
 * この関数を変えると golden が全て変わるため、変更には人間承認が要る。
 */
import { validPositions } from "../../../src/core/board";
import { newGame, place } from "../../../src/core/game";
import { getShape } from "../../../src/core/shapes";
import { TRAY_SIZE } from "../../../src/core/tray";
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
  rng: number;
  round: number;
  linesCleared: number;
  longestStreak: number;
  status: string;
  tray: Array<string | null>;
  board: number[];
}

/**
 * スロット t のピースの配置先を選ぶ(候補が無ければ null)。
 * 方策は「走査順で最初に置ける位置」= 最も左上に詰める、という乱数を使わない固定手順。
 * 盤が詰まりにくく 50 手を消化できるので、消去・ストリーク・トレイ更新まで golden に載る。
 */
function choose(state: GameState, t: number): [number, number] | null {
  const piece = state.tray[t];
  if (piece === null || piece === undefined) return null;
  const shape = getShape(piece.shapeId);
  if (shape === undefined) return null;
  const positions = validPositions(state.board, state.size, shape);
  return positions[0] ?? null;
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
    let moved = false;
    for (let k = 0; k < TRAY_SIZE; k++) {
      const t = (m + k) % TRAY_SIZE;
      const target = choose(state, t);
      if (target === null) continue;
      const r = place(state, config, t, target[0], target[1]);
      if (!r.result.ok) continue;
      state = r.state;
      applied++;
      moved = true;
      break;
    }
    if (!moved) break;
  }

  return {
    state,
    snapshot: {
      seed,
      mode,
      movesRequested: moves,
      movesApplied: applied,
      score: state.score,
      rng: state.rng,
      round: state.round,
      linesCleared: state.linesCleared,
      longestStreak: state.longestStreak,
      status: state.status,
      tray: state.tray.map((p) => (p === null || p === undefined ? null : p.shapeId)),
      board: Array.from(state.board),
    },
  };
}
