/**
 * かけら(docs/01 §5)。**純粋**。
 *
 * 逆手(さかて)には形状カタログが無い。かけらは盤から derive される任意の形で、
 * ここはその形を扱う道具だけを持つ。すべて「正規化された相対座標の配列」で表す:
 * 左上が (0,0) に寄っていて、読み順(上から下、左から右)に並んでいる。
 */
import type { CellOffset, Color, Piece } from "./types";

const N4: ReadonlyArray<CellOffset> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

const key = (x: number, y: number): string => `${x},${y}`;

/** 読み順に並べ、左上を (0,0) に寄せる。 */
export function normalize(cells: ReadonlyArray<CellOffset>): CellOffset[] {
  if (cells.length === 0) return [];
  let minX = Infinity;
  let minY = Infinity;
  for (const [x, y] of cells) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
  }
  return cells
    .map(([x, y]): CellOffset => [x - minX, y - minY])
    .sort((a, b) => a[1] - b[1] || a[0] - b[0]);
}

/** いちばん大きなひとまとまり(同じ大きさなら読み順で先のもの)。 */
export function largestGroup(cells: ReadonlyArray<CellOffset>): CellOffset[] {
  const set = new Set(cells.map(([x, y]) => key(x, y)));
  const seen = new Set<string>();
  let best: CellOffset[] = [];
  for (const start of normalize(cells).length === 0 ? [] : cells) {
    if (seen.has(key(start[0], start[1]))) continue;
    const group: CellOffset[] = [];
    const stack: CellOffset[] = [start];
    seen.add(key(start[0], start[1]));
    while (stack.length > 0) {
      const cell = stack.pop() as CellOffset;
      group.push(cell);
      for (const [dx, dy] of N4) {
        const next: CellOffset = [cell[0] + dx, cell[1] + dy];
        const k = key(next[0], next[1]);
        if (set.has(k) && !seen.has(k)) {
          seen.add(k);
          stack.push(next);
        }
      }
    }
    if (group.length > best.length) best = group;
  }
  return best;
}

/**
 * ちょうど `size` マスの形にそろえる。
 * 足りなければ**読み順でいちばん先の隣**を足し、多ければ先頭から幅優先で `size` マスだけ残す。
 * どちらも決定的で、つながりは保たれる。
 */
export function resize(cells: ReadonlyArray<CellOffset>, size: number): CellOffset[] {
  const target = Math.max(1, Math.floor(size));
  let current = normalize(cells);
  if (current.length === 0) return [[0, 0]];

  while (current.length < target) {
    const have = new Set(current.map(([x, y]) => key(x, y)));
    const candidates: CellOffset[] = [];
    for (const [x, y] of current) {
      for (const [dx, dy] of N4) {
        const next: CellOffset = [x + dx, y + dy];
        if (!have.has(key(next[0], next[1]))) candidates.push(next);
      }
    }
    if (candidates.length === 0) break;
    candidates.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
    current = normalize([...current, candidates[0] as CellOffset]);
  }

  if (current.length > target) {
    // 先頭のマスから幅優先で target マス。つながったまま削れる。
    const set = new Set(current.map(([x, y]) => key(x, y)));
    const taken: CellOffset[] = [];
    const seen = new Set<string>();
    const queue: CellOffset[] = [current[0] as CellOffset];
    seen.add(key(queue[0]?.[0] ?? 0, queue[0]?.[1] ?? 0));
    while (queue.length > 0 && taken.length < target) {
      const cell = queue.shift() as CellOffset;
      taken.push(cell);
      const neighbours = N4.map(([dx, dy]): CellOffset => [cell[0] + dx, cell[1] + dy])
        .filter(([x, y]) => set.has(key(x, y)) && !seen.has(key(x, y)))
        .sort((a, b) => a[1] - b[1] || a[0] - b[0]);
      for (const n of neighbours) {
        seen.add(key(n[0], n[1]));
        queue.push(n);
      }
    }
    current = normalize(taken);
  }
  return current;
}

export function makePiece(cells: ReadonlyArray<CellOffset>, color: Color): Piece {
  return { cells: normalize(cells), color };
}

/** かけらの幅と高さ。 */
export function pieceSize(piece: Piece): { w: number; h: number } {
  let w = 0;
  let h = 0;
  for (const [x, y] of piece.cells) {
    if (x + 1 > w) w = x + 1;
    if (y + 1 > h) h = y + 1;
  }
  return { w, h };
}

/** 盤の (x, y) を左上としたときの絶対座標。 */
export function pieceCellsAt(piece: Piece, x: number, y: number): Array<[number, number]> {
  return piece.cells.map(([dx, dy]): [number, number] => [x + dx, y + dy]);
}
