import { describe, expect, it } from "vitest";
import {
  anyFits,
  boardIndex,
  canPlace,
  clearLines,
  createBoard,
  fillRatio,
  isBoardEmpty,
  placeShape,
  shapeCellsAt,
  shapeFits,
  validPositions,
} from "../../src/core/board";
import { getShape } from "../../src/core/shapes";
import type { Board, Shape } from "../../src/core/types";

const SIZE = 10;
const shape = (id: string): Shape => {
  const s = getShape(id);
  if (s === undefined) throw new Error(`unknown shape ${id}`);
  return s;
};

const fillRow = (board: Board, y: number, from = 0, to = SIZE): void => {
  for (let x = from; x < to; x++) board[y * SIZE + x] = 1;
};
const fillCol = (board: Board, x: number, from = 0, to = SIZE): void => {
  for (let y = from; y < to; y++) board[y * SIZE + x] = 1;
};

describe("board", () => {
  it("createBoard は size*size の空盤", () => {
    const b = createBoard(SIZE);
    expect(b).toHaveLength(100);
    expect(isBoardEmpty(b)).toBe(true);
    expect(fillRatio(b)).toBe(0);
    expect(boardIndex(SIZE, 3, 4)).toBe(43);
  });

  describe("canPlace の境界", () => {
    const empty = createBoard(SIZE);

    it("角: dot は (9,9) に置ける、(10,9) は置けない", () => {
      expect(canPlace(empty, SIZE, shape("dot"), 9, 9)).toBe(true);
      expect(canPlace(empty, SIZE, shape("dot"), 10, 9)).toBe(false);
      expect(canPlace(empty, SIZE, shape("dot"), 0, 0)).toBe(true);
      expect(canPlace(empty, SIZE, shape("dot"), -1, 0)).toBe(false);
      expect(canPlace(empty, SIZE, shape("dot"), 0, -1)).toBe(false);
      expect(canPlace(empty, SIZE, shape("dot"), 0, 10)).toBe(false);
    });

    it("端: h5 は x=5 に置けて x=6 は置けない(docs/06 §8)", () => {
      expect(canPlace(empty, SIZE, shape("h5"), 5, 0)).toBe(true);
      expect(canPlace(empty, SIZE, shape("h5"), 6, 0)).toBe(false);
      expect(canPlace(empty, SIZE, shape("v5"), 0, 5)).toBe(true);
      expect(canPlace(empty, SIZE, shape("v5"), 0, 6)).toBe(false);
    });

    it("重なり: 埋まっているセルには置けない", () => {
      const b = createBoard(SIZE);
      b[boardIndex(SIZE, 1, 1)] = 3;
      expect(canPlace(b, SIZE, shape("sq2"), 0, 0)).toBe(false);
      expect(canPlace(b, SIZE, shape("sq2"), 2, 2)).toBe(true);
      // L 字の欠けた部分は重なっても良い。
      expect(canPlace(b, SIZE, shape("c_nw"), 0, 0)).toBe(true);
    });

    it("整数以外の座標は置けない", () => {
      expect(canPlace(empty, SIZE, shape("dot"), 1.5, 0)).toBe(false);
      expect(canPlace(empty, SIZE, shape("dot"), 0, Number.NaN)).toBe(false);
    });

    it("空盤に 3×3 を置ける(空入力ケース)", () => {
      expect(canPlace(empty, SIZE, shape("sq3"), 0, 0)).toBe(true);
      expect(canPlace(empty, SIZE, shape("sq3"), 7, 7)).toBe(true);
      expect(canPlace(empty, SIZE, shape("sq3"), 8, 7)).toBe(false);
    });
  });

  it("placeShape は元の盤を変更しない(copy-on-write)", () => {
    const b = createBoard(SIZE);
    const next = placeShape(b, SIZE, shape("sq2"), 0, 0);
    expect(isBoardEmpty(b)).toBe(true);
    expect(next[boardIndex(SIZE, 0, 0)]).toBe(shape("sq2").color);
    expect(fillRatio(next)).toBeCloseTo(0.04);
    expect(shapeCellsAt(shape("c_nw"), 5, 6)).toEqual([
      [5, 6],
      [6, 6],
      [5, 7],
    ]);
  });

  describe("clearLines", () => {
    it("完全な行・列がなければ同じ盤をそのまま返す", () => {
      const b = createBoard(SIZE);
      fillRow(b, 0, 0, 9);
      const r = clearLines(b, SIZE);
      expect(r.rows).toEqual([]);
      expect(r.cols).toEqual([]);
      expect(r.cells).toEqual([]);
      expect(r.board).toBe(b);
    });

    it("1 行消去", () => {
      const b = createBoard(SIZE);
      fillRow(b, 4);
      const r = clearLines(b, SIZE);
      expect(r.rows).toEqual([4]);
      expect(r.cols).toEqual([]);
      expect(r.cells).toHaveLength(10);
      expect(isBoardEmpty(r.board)).toBe(true);
      expect(isBoardEmpty(b)).toBe(false); // 入力は不変
    });

    it("行と列が同時に消え、交差セルは 1 回だけ数える(docs/01 §13)", () => {
      const b = createBoard(SIZE);
      fillRow(b, 3);
      fillCol(b, 7);
      const r = clearLines(b, SIZE);
      expect(r.rows).toEqual([3]);
      expect(r.cols).toEqual([7]);
      expect(r.cells).toHaveLength(19); // 10 + 10 − 1(交差)
      const keys = new Set(r.cells.map(([x, y]) => `${x},${y}`));
      expect(keys.size).toBe(19);
      expect(isBoardEmpty(r.board)).toBe(true);
    });

    it("3 行 + 3 列同時(sq3 相当)= 6 列", () => {
      const b = createBoard(SIZE);
      for (const y of [0, 1, 2]) fillRow(b, y);
      for (const x of [4, 5, 6]) fillCol(b, x);
      const r = clearLines(b, SIZE);
      expect(r.rows).toEqual([0, 1, 2]);
      expect(r.cols).toEqual([4, 5, 6]);
      expect(r.rows.length + r.cols.length).toBe(6);
      const expected = 3 * 10 + 3 * 10 - 3 * 3;
      expect(r.cells).toHaveLength(expected);
    });

    it("消去後に完全な行・列は残らない", () => {
      const b = createBoard(SIZE);
      for (let y = 0; y < SIZE; y++) fillRow(b, y);
      const r = clearLines(b, SIZE);
      expect(r.rows).toHaveLength(10);
      expect(r.cols).toHaveLength(10);
      const again = clearLines(r.board, SIZE);
      expect(again.rows).toEqual([]);
      expect(again.cols).toEqual([]);
      expect(isBoardEmpty(r.board)).toBe(true);
    });
  });

  describe("validPositions / shapeFits / anyFits", () => {
    it("空盤の候補数は (size−w+1) × (size−h+1)", () => {
      const b = createBoard(SIZE);
      expect(validPositions(b, SIZE, shape("dot"))).toHaveLength(100);
      expect(validPositions(b, SIZE, shape("h5"))).toHaveLength(6 * 10);
      expect(validPositions(b, SIZE, shape("sq3"))).toHaveLength(8 * 8);
      expect(shapeFits(b, SIZE, shape("sq3"))).toBe(true);
    });

    it("満杯の盤ではどれも置けない", () => {
      const full = createBoard(SIZE).fill(1);
      expect(validPositions(full, SIZE, shape("dot"))).toEqual([]);
      expect(shapeFits(full, SIZE, shape("dot"))).toBe(false);
      expect(anyFits(full, SIZE, [{ shapeId: "dot" }, null, null])).toBe(false);
    });

    it("anyFits は null・未知 ID を読み飛ばす", () => {
      const b = createBoard(SIZE);
      expect(anyFits(b, SIZE, [null, null, null])).toBe(false);
      expect(anyFits(b, SIZE, [null, { shapeId: "ghost" }, null])).toBe(false);
      expect(anyFits(b, SIZE, [null, { shapeId: "ghost" }, { shapeId: "dot" }])).toBe(true);
    });

    it("穴が 1 つだけの盤では dot だけが置ける", () => {
      const b = createBoard(SIZE).fill(1);
      b[boardIndex(SIZE, 5, 5)] = 0;
      expect(validPositions(b, SIZE, shape("dot"))).toEqual([[5, 5]]);
      expect(shapeFits(b, SIZE, shape("h2"))).toBe(false);
      expect(anyFits(b, SIZE, [{ shapeId: "h2" }, { shapeId: "sq2" }, { shapeId: "dot" }])).toBe(
        true,
      );
    });
  });

  it("fillRatio は 0 長の盤で 0", () => {
    expect(fillRatio(createBoard(0))).toBe(0);
  });
});
