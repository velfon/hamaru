/**
 * 次のかけらを決める(docs/01 §5.3)。**純粋・乱数ゼロ**。逆手の心臓部。
 *
 *   1. いま置いたかけらの**中心**を出す(セルの平均を四捨五入)
 *   2. そこを中心とする `window`×`window` の窓を見て、**タイルのあるマス**を集める
 *      (いま置いたマスは含めない = 盤がもともと持っていた形だけが残る)
 *   3. いちばん大きなひとまとまりを取る。ひとつも無ければ 1 マス
 *   4. **熱**(最後に消してからの手数)から決まる大きさにそろえる
 *
 * 3 までが「あなたが触れた形を、窯が覚えている」。4 が「消さずにいると重くなる」。
 * どちらも盤とあなたの手だけで決まるので、同じ手からは必ず同じかけらが出る。
 */
import { largestGroup, normalize, resize } from "./piece";
import type { Board, CellOffset, Color, Piece, SakateConfig } from "./types";

/** 熱からかけらの大きさを出す。 */
export function pieceSizeFor(heat: number, cfg: SakateConfig): number {
  const grown = 1 + Math.floor(Math.max(0, heat) / Math.max(1, cfg.growEvery));
  return Math.max(1, Math.min(cfg.maxPiece, grown));
}

/** かけらの色。乱数を使わず、手数から順に選ぶ(6 色を巡回)。 */
export function colorFor(moves: number): Color {
  return ((Math.abs(Math.floor(moves)) % 6) + 1) as Color;
}

/** 置いたセルの中心(四捨五入)。 */
function centreOf(placed: ReadonlyArray<readonly [number, number]>): [number, number] {
  let sx = 0;
  let sy = 0;
  for (const [x, y] of placed) {
    sx += x;
    sy += y;
  }
  return [Math.round(sx / placed.length), Math.round(sy / placed.length)];
}

/**
 * 次のかけら。`board` は**消去まで終わった後**の盤を渡す
 * (消すと窓が空くので、次のかけらは小さくなる。docs/01 §5.3)。
 */
export function deriveNextPiece(
  board: Board,
  size: number,
  placed: ReadonlyArray<readonly [number, number]>,
  heat: number,
  cfg: SakateConfig,
  moves: number,
): Piece {
  const target = pieceSizeFor(heat, cfg);
  if (placed.length === 0) return { cells: resize([[0, 0]], target), color: colorFor(moves) };

  const [cx, cy] = centreOf(placed);
  const just = new Set(placed.map(([x, y]) => `${x},${y}`));
  const radius = Math.floor(Math.max(1, cfg.window) / 2);
  const found: CellOffset[] = [];
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const x = cx + dx;
      const y = cy + dy;
      if (x < 0 || y < 0 || x >= size || y >= size) continue;
      if (board[y * size + x] === 0) continue;
      if (just.has(`${x},${y}`)) continue;
      found.push([x, y]);
    }
  }
  const shape = found.length === 0 ? [[0, 0] as CellOffset] : largestGroup(found);
  return { cells: resize(normalize(shape), target), color: colorFor(moves) };
}
