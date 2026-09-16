/**
 * 盤の操作(docs/01 §5、docs/02 §3)。すべて純粋関数で、引数の盤を変更しない。
 */
import { getShape } from "./shapes";
import type { Board, Piece, Shape } from "./types";

export function createBoard(size: number): Board {
  return new Uint8Array(size * size);
}

export function boardIndex(size: number, x: number, y: number): number {
  return y * size + x;
}

/** 形状の全セルが盤内かつ空なら true(docs/01 §5.1)。 */
export function canPlace(board: Board, size: number, shape: Shape, x: number, y: number): boolean {
  if (!Number.isInteger(x) || !Number.isInteger(y)) return false;
  for (const [dx, dy] of shape.cells) {
    const cx = x + dx;
    const cy = y + dy;
    if (cx < 0 || cy < 0 || cx >= size || cy >= size) return false;
    if (board[cy * size + cx] !== 0) return false;
  }
  return true;
}

/** 配置後の新しい盤を返す(copy-on-write)。呼び出し前に canPlace を確認すること。 */
export function placeShape(board: Board, size: number, shape: Shape, x: number, y: number): Board {
  const next = Uint8Array.from(board);
  for (const [dx, dy] of shape.cells) {
    next[(y + dy) * size + (x + dx)] = shape.color;
  }
  return next;
}

/** 形状を (x, y) に置いたときに埋まるセルの絶対座標。 */
export function shapeCellsAt(shape: Shape, x: number, y: number): Array<[number, number]> {
  return shape.cells.map(([dx, dy]): [number, number] => [x + dx, y + dy]);
}

export interface ClearResult {
  board: Board;
  rows: number[];
  cols: number[];
  /** 消えたセルの絶対座標。交差セルは 1 回だけ含まれる(docs/01 §13)。 */
  cells: Array<[number, number]>;
}

/**
 * 完全に埋まった行・列を同時に検出して消す(docs/01 §5.2 手順 3)。
 * 検出は消去前の盤に対して行うので、行と列は互いに影響しない。
 */
export function clearLines(board: Board, size: number): ClearResult {
  const rows: number[] = [];
  const cols: number[] = [];

  for (let y = 0; y < size; y++) {
    let full = true;
    for (let x = 0; x < size; x++) {
      if (board[y * size + x] === 0) {
        full = false;
        break;
      }
    }
    if (full) rows.push(y);
  }
  for (let x = 0; x < size; x++) {
    let full = true;
    for (let y = 0; y < size; y++) {
      if (board[y * size + x] === 0) {
        full = false;
        break;
      }
    }
    if (full) cols.push(x);
  }

  if (rows.length === 0 && cols.length === 0) {
    return { board, rows, cols, cells: [] };
  }

  const next = Uint8Array.from(board);
  const cells: Array<[number, number]> = [];
  const seen = new Uint8Array(size * size);
  for (const y of rows) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      if (seen[i] === 0) {
        seen[i] = 1;
        cells.push([x, y]);
      }
      next[i] = 0;
    }
  }
  for (const x of cols) {
    for (let y = 0; y < size; y++) {
      const i = y * size + x;
      if (seen[i] === 0) {
        seen[i] = 1;
        cells.push([x, y]);
      }
      next[i] = 0;
    }
  }
  return { board: next, rows, cols, cells };
}

/** 形状を置ける位置(左上基準)をすべて列挙する。 */
export function validPositions(board: Board, size: number, shape: Shape): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let y = 0; y + shape.h <= size; y++) {
    for (let x = 0; x + shape.w <= size; x++) {
      if (canPlace(board, size, shape, x, y)) out.push([x, y]);
    }
  }
  return out;
}

/** 形状が盤のどこかに置けるか。 */
export function shapeFits(board: Board, size: number, shape: Shape): boolean {
  for (let y = 0; y + shape.h <= size; y++) {
    for (let x = 0; x + shape.w <= size; x++) {
      if (canPlace(board, size, shape, x, y)) return true;
    }
  }
  return false;
}

/** トレイに残るピースのうち 1 つでも置けるか(docs/01 §5.2 手順 6)。 */
export function anyFits(board: Board, size: number, tray: ReadonlyArray<Piece | null>): boolean {
  for (const piece of tray) {
    if (piece === null || piece === undefined) continue;
    const shape = getShape(piece.shapeId);
    if (shape === undefined) continue;
    if (shapeFits(board, size, shape)) return true;
  }
  return false;
}

/** 盤の埋まり率 0〜1。 */
export function fillRatio(board: Board): number {
  if (board.length === 0) return 0;
  let filled = 0;
  for (let i = 0; i < board.length; i++) {
    if (board[i] !== 0) filled++;
  }
  return filled / board.length;
}

/** 盤が空か。 */
export function isBoardEmpty(board: Board): boolean {
  for (let i = 0; i < board.length; i++) {
    if (board[i] !== 0) return false;
  }
  return true;
}
