/**
 * 次のかけらの作り方(docs/01 §5.3)。逆手の心臓部。
 *
 * ここが壊れるとゲームが別物になるので、性質を厚く固める。
 */
import { describe, expect, it } from "vitest";
import { createBoard } from "../../src/core/board";
import { colorFor, deriveNextPiece, pieceSizeFor } from "../../src/core/derive";
import { largestGroup, normalize } from "../../src/core/piece";
import { DEFAULT_CONFIG } from "../../src/config";
import type { Board, SakateConfig } from "../../src/core/types";

const SIZE = DEFAULT_CONFIG.board.size;
const CFG: SakateConfig = DEFAULT_CONFIG.sakate;
const at = (board: Board, x: number, y: number, v = 1): void => {
  board[y * SIZE + x] = v;
};

describe("pieceSizeFor(熱 → 大きさ)", () => {
  it("熱 0 は 1 マス。growEvery 手ごとに 1 マス増える", () => {
    const cfg = { ...CFG, growEvery: 2, maxPiece: 5 };
    expect(pieceSizeFor(0, cfg)).toBe(1);
    expect(pieceSizeFor(1, cfg)).toBe(1);
    expect(pieceSizeFor(2, cfg)).toBe(2);
    expect(pieceSizeFor(4, cfg)).toBe(3);
  });

  it("上限で頭打ち。負の熱は 1 マス", () => {
    const cfg = { ...CFG, growEvery: 1, maxPiece: 4 };
    expect(pieceSizeFor(99, cfg)).toBe(4);
    expect(pieceSizeFor(-5, cfg)).toBe(1);
  });
});

describe("colorFor", () => {
  it("6 色を順に巡回する(乱数を使わない)", () => {
    expect([0, 1, 2, 3, 4, 5, 6].map(colorFor)).toEqual([1, 2, 3, 4, 5, 6, 1]);
  });
});

describe("deriveNextPiece", () => {
  it("まわりにタイルが無ければ 1 マス(熱 0 のとき)", () => {
    const board = createBoard(SIZE);
    const piece = deriveNextPiece(board, SIZE, [[5, 5]], 0, CFG, 1);
    expect(piece.cells).toEqual([[0, 0]]);
  });

  it("置いたマスの**まわりにあったタイル**の形になる", () => {
    const board = createBoard(SIZE);
    // (4,5) と (4,6) に既存のタイル。(5,5) に置いたとみなす
    at(board, 4, 5);
    at(board, 4, 6);
    at(board, 5, 5); // いま置いたマス(数に入れない)
    const piece = deriveNextPiece(board, SIZE, [[5, 5]], 0, { ...CFG, growEvery: 99 }, 1);
    // 縦に 2 マス並んだ形 → 熱 0 なので 1 マスに削られる
    expect(piece.cells).toHaveLength(1);

    const grown = deriveNextPiece(board, SIZE, [[5, 5]], 4, { ...CFG, growEvery: 2 }, 1);
    expect(normalize([...grown.cells])).toEqual([
      [0, 0],
      [0, 1],
      [0, 2],
    ]);
  });

  it("いま置いたマスは次のかけらに数えない(自分の形が返ってこない)", () => {
    const board = createBoard(SIZE);
    for (const [x, y] of [
      [5, 5],
      [6, 5],
      [7, 5],
    ] as const) {
      at(board, x, y);
    }
    const piece = deriveNextPiece(
      board,
      SIZE,
      [
        [5, 5],
        [6, 5],
        [7, 5],
      ],
      0,
      CFG,
      1,
    );
    expect(piece.cells).toEqual([[0, 0]]);
  });

  it("窓の外は見ない", () => {
    const board = createBoard(SIZE);
    at(board, 0, 0); // 遠いタイル
    at(board, 5, 5);
    const piece = deriveNextPiece(board, SIZE, [[5, 5]], 6, { ...CFG, growEvery: 1 }, 1);
    // まわりに何も無いので 1 マスから育てた縦棒になる(遠いタイルは影響しない)
    expect(piece.cells).toHaveLength(pieceSizeFor(6, { ...CFG, growEvery: 1 }));
  });

  it("かけらはいつもひとつながり", () => {
    const board = createBoard(SIZE);
    at(board, 4, 4);
    at(board, 6, 6); // 斜めに離れたタイル(窓には入るがつながっていない)
    for (let heat = 0; heat < 12; heat++) {
      const piece = deriveNextPiece(board, SIZE, [[5, 5]], heat, CFG, heat);
      expect(largestGroup([...piece.cells])).toHaveLength(piece.cells.length);
    }
  });

  it("同じ盤・同じ手からは必ず同じかけら(乱数ゼロ)", () => {
    const board = createBoard(SIZE);
    at(board, 4, 5);
    at(board, 5, 4);
    for (let i = 0; i < 5; i++) {
      expect(deriveNextPiece(board, SIZE, [[5, 5]], 3, CFG, 7)).toEqual(
        deriveNextPiece(board, SIZE, [[5, 5]], 3, CFG, 7),
      );
    }
  });

  it("大きさは熱だけで決まり、上限を超えない", () => {
    const board = createBoard(SIZE);
    for (let x = 3; x <= 7; x++) for (let y = 3; y <= 7; y++) at(board, x, y);
    for (const heat of [0, 1, 5, 50]) {
      const piece = deriveNextPiece(board, SIZE, [[5, 5]], heat, CFG, 1);
      expect(piece.cells).toHaveLength(pieceSizeFor(heat, CFG));
      expect(piece.cells.length).toBeLessThanOrEqual(CFG.maxPiece);
    }
  });
});
