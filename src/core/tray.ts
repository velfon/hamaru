/**
 * トレイ生成(docs/01 §4.2)。
 *
 * 1. 重み付き抽選を 3 回。
 * 2. noTripleDuplicate: 3 つが同一 ID なら 3 つ目を引き直す(最大 10 回)。
 * 3. fitGuarantee "oneOfThree": 少なくとも 1 つが盤に置けるまで全体を引き直す(最大 20 回)。
 * 4. pity: 埋まり率 >= threshold なら セル数 <= 3 の重みを smallBoost 倍。
 *
 * 実装ノート(docs/01 §14 N-3): 手順 4 の pity は「手順 1 で使う重み」を変えるものなので、
 * 実装では最初に実効重みを求めてから 1〜3 を回す。
 */
import { anyFits, fillRatio } from "./board";
import { SHAPES } from "./shapes";
import type { Board, Piece, ResolvedConfig, Shape } from "./types";

export const TRAY_SIZE = 3;

/** pity の対象になるセル数の上限(docs/01 §4.2)。 */
export const PITY_MAX_CELLS = 3;

const MAX_DUPLICATE_REDRAWS = 10;
const MAX_TRAY_REDRAWS = 20;

/** 盤の状態と config から、形状ごとの実効重みを返す(SHAPES と同じ順序)。 */
export function effectiveWeights(board: Board, config: ResolvedConfig): number[] {
  const { weights, pity } = config.pieces;
  const boost = pity.enabled && fillRatio(board) >= pity.threshold ? pity.smallBoost : 1;
  return SHAPES.map((shape) => {
    const w = weights[shape.id] ?? 0;
    if (w <= 0) return 0;
    return shape.cells.length <= PITY_MAX_CELLS ? w * boost : w;
  });
}

/**
 * 重み付き抽選。weights は SHAPES と同じ順序・長さ。
 * 合計が 0 以下なら(スキーマ上あり得ないが)先頭の形状を返す。
 */
export function pickWeighted(rnd: number, weights: readonly number[]): Shape {
  let total = 0;
  for (const w of weights) {
    if (w > 0) total += w;
  }
  const first = SHAPES[0] as Shape;
  if (total <= 0) return first;

  let acc = 0;
  const target = rnd * total;
  for (let i = 0; i < SHAPES.length; i++) {
    const w = weights[i] ?? 0;
    if (w <= 0) continue;
    acc += w;
    if (target < acc) return SHAPES[i] as Shape;
  }
  // 浮動小数の丸めで抜けた場合の保険。最後の正の重みの形状。
  for (let i = SHAPES.length - 1; i >= 0; i--) {
    if ((weights[i] ?? 0) > 0) return SHAPES[i] as Shape;
  }
  return first;
}

/** 乱数器の最小契約(rng.ts の Rng を満たす)。 */
export interface TrayRng {
  next(): number;
}

/** 3 つのピースを生成する。rng の状態は呼び出し側で保存すること。 */
export function generateTray(
  rng: TrayRng,
  board: Board,
  config: ResolvedConfig,
): Array<Piece | null> {
  const weights = effectiveWeights(board, config);
  const { noTripleDuplicate, fitGuarantee } = config.pieces;

  let tray: Piece[] = [];
  for (let attempt = 0; attempt < MAX_TRAY_REDRAWS; attempt++) {
    tray = [];
    for (let i = 0; i < TRAY_SIZE; i++) {
      tray.push({ shapeId: pickWeighted(rng.next(), weights).id });
    }

    if (noTripleDuplicate) {
      for (let k = 0; k < MAX_DUPLICATE_REDRAWS; k++) {
        const [a, b, c] = tray;
        if (a === undefined || b === undefined || c === undefined) break;
        if (!(a.shapeId === b.shapeId && b.shapeId === c.shapeId)) break;
        tray[2] = { shapeId: pickWeighted(rng.next(), weights).id };
      }
    }

    if (fitGuarantee !== "oneOfThree") break;
    if (anyFits(board, config.board.size, tray)) break;
  }
  return tray;
}
