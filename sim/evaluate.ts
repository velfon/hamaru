/**
 * ボットの手の評価(docs/06 §4)。
 *
 * 候補手は数万回/ゲーム評価するので、`core` の `place`(盤を複製する)ではなく
 * **盤を書き換えて元に戻す**非確保の評価関数を使う。結果は core と一致する。
 */
import { scorePlacement } from "../src/core/scoring";
import type { Board, ScoringConfig, Shape } from "../src/core/types";

export interface MoveValue {
  /** この配置で得られる得点(ストリーク倍率・全消しボーナス込み)。 */
  score: number;
  /** 同時に消える行数 + 列数。 */
  lines: number;
  boardCleared: boolean;
}

/** 盤の埋まっているセル数。 */
export function countFilled(board: Board): number {
  let n = 0;
  for (let i = 0; i < board.length; i++) {
    if (board[i] !== 0) n++;
  }
  return n;
}

function rowFull(board: Board, size: number, y: number): boolean {
  const base = y * size;
  for (let x = 0; x < size; x++) {
    if (board[base + x] === 0) return false;
  }
  return true;
}

function colFull(board: Board, size: number, x: number): boolean {
  for (let y = 0; y < size; y++) {
    if (board[y * size + x] === 0) return false;
  }
  return true;
}

/**
 * (x, y) に置いたときの価値を、盤を変更せずに求める。
 * ピースが触れた行・列だけを調べれば十分(他の行・列は状態が変わらない)。
 */
export function evaluateMove(
  board: Board,
  size: number,
  shape: Shape,
  x: number,
  y: number,
  scoring: ScoringConfig,
  streakBefore: number,
  filledBefore: number,
): MoveValue {
  for (const [dx, dy] of shape.cells) {
    board[(y + dy) * size + (x + dx)] = shape.color;
  }

  let rows = 0;
  let cols = 0;
  for (let dy = 0; dy < shape.h; dy++) {
    if (rowFull(board, size, y + dy)) rows++;
  }
  for (let dx = 0; dx < shape.w; dx++) {
    if (colFull(board, size, x + dx)) cols++;
  }

  for (const [dx, dy] of shape.cells) {
    board[(y + dy) * size + (x + dx)] = 0;
  }

  const lines = rows + cols;
  const filledAfter = filledBefore + shape.cells.length;
  const clearedCells = rows * size + cols * size - rows * cols;
  const boardCleared = lines > 0 && filledAfter - clearedCells === 0;
  const streakAfter = lines > 0 ? streakBefore + 1 : 0;

  return {
    score: scorePlacement(
      { cellCount: shape.cells.length, lines, streakAfter, boardCleared },
      scoring,
    ),
    lines,
    boardCleared,
  };
}

/**
 * 盤を **その場で** 更新する(配置 + 行列消去)。lookahead の内部探索用。
 * 返り値は新しい埋まりセル数。
 */
export function applyMoveInPlace(
  board: Board,
  size: number,
  shape: Shape,
  x: number,
  y: number,
): { lines: number; filled: number } {
  for (const [dx, dy] of shape.cells) {
    board[(y + dy) * size + (x + dx)] = shape.color;
  }
  const rows: number[] = [];
  const cols: number[] = [];
  for (let dy = 0; dy < shape.h; dy++) {
    if (rowFull(board, size, y + dy)) rows.push(y + dy);
  }
  for (let dx = 0; dx < shape.w; dx++) {
    if (colFull(board, size, x + dx)) cols.push(x + dx);
  }
  for (const ry of rows) {
    for (let cx = 0; cx < size; cx++) board[ry * size + cx] = 0;
  }
  for (const cx of cols) {
    for (let ry = 0; ry < size; ry++) board[ry * size + cx] = 0;
  }
  return { lines: rows.length + cols.length, filled: countFilled(board) };
}
