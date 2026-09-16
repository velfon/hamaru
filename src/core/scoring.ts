/**
 * 配点(docs/01 §6)。
 *
 *   配置       +セル数 × perCell
 *   消去       lineBase × n × (n+1) / 2   (n = 同時に消えた行数 + 列数)
 *   ストリーク 消去点に min(1 + step × (s−1), max) を乗算
 *   全消し     +boardClearBonus
 *
 * 端数は各加算ごとに Math.round する。
 */
import type { ScoringConfig } from "./types";

/** n 列同時消しの基礎点。1:10, 2:30, 3:60, 4:100, 5:150, 6:210(lineBase = 10)。 */
export function lineScore(n: number, lineBase: number): number {
  if (n <= 0) return 0;
  return (lineBase * n * (n + 1)) / 2;
}

/**
 * ストリーク倍率。s は「連続して消去が発生した配置回数」。
 * s <= 1 のとき 1.0、以降 step ずつ増えて max で頭打ち。
 */
export function streakMultiplier(s: number, step: number, max: number): number {
  if (s <= 1) return 1;
  return Math.min(1 + step * (s - 1), max);
}

export interface ScoreInput {
  /** 置いたピースのセル数。 */
  cellCount: number;
  /** 同時に消えた行数 + 列数。 */
  lines: number;
  /** この配置の後のストリーク値。 */
  streakAfter: number;
  /** 消去後に盤が空になったか。 */
  boardCleared: boolean;
}

/** 1 回の配置で得られる得点。 */
export function scorePlacement(input: ScoreInput, cfg: ScoringConfig): number {
  let total = Math.round(input.cellCount * cfg.perCell);
  if (input.lines > 0) {
    const base = lineScore(input.lines, cfg.lineBase);
    const mult = streakMultiplier(input.streakAfter, cfg.streak.step, cfg.streak.max);
    total += Math.round(base * mult);
  }
  if (input.boardCleared) {
    total += Math.round(cfg.boardClearBonus);
  }
  return total;
}
