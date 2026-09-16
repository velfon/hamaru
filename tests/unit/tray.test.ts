import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../../src/config";
import { deepMerge } from "../../src/config/resolve";
import { anyFits, boardIndex, createBoard } from "../../src/core/board";
import { createRng } from "../../src/core/rng";
import { SHAPES, getShape } from "../../src/core/shapes";
import {
  PITY_MAX_CELLS,
  TRAY_SIZE,
  effectiveWeights,
  generateTray,
  pickWeighted,
} from "../../src/core/tray";
import type { Board, Piece, ResolvedConfig } from "../../src/core/types";

const SIZE = DEFAULT_CONFIG.board.size;

const withConfig = (override: unknown): ResolvedConfig =>
  deepMerge(structuredClone(DEFAULT_CONFIG), override);

const zeroWeights = (): Record<string, number> => Object.fromEntries(SHAPES.map((s) => [s.id, 0]));

const isSmall = (shapeId: string): boolean =>
  (getShape(shapeId)?.cells.length ?? 99) <= PITY_MAX_CELLS;

const ids = (tray: ReadonlyArray<Piece | null>): string[] =>
  tray.map((p) => (p === null || p === undefined ? "-" : p.shapeId));

describe("tray", () => {
  it("常に 3 つ返す", () => {
    const rng = createRng("tray");
    const board = createBoard(SIZE);
    for (let i = 0; i < 50; i++) {
      expect(generateTray(rng, board, DEFAULT_CONFIG)).toHaveLength(TRAY_SIZE);
    }
  });

  it("重みゼロの形状は出ない", () => {
    const weights = zeroWeights();
    weights["dot"] = 1;
    weights["sq2"] = 1;
    const config = withConfig({ pieces: { weights, noTripleDuplicate: false } });
    const rng = createRng("zero-weights");
    const board = createBoard(SIZE);
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) {
      for (const id of ids(generateTray(rng, board, config))) seen.add(id);
    }
    expect([...seen].sort()).toEqual(["dot", "sq2"]);
  });

  it("noTripleDuplicate: 3 つ同一 ID のトレイが出ない", () => {
    // 形状が 2 種類しかないと三つ子が出やすいので、その状況で検証する。
    const weights = zeroWeights();
    weights["dot"] = 1;
    weights["h2"] = 1;
    const on = withConfig({
      pieces: { weights, noTripleDuplicate: true, fitGuarantee: "none" },
    });
    const off = withConfig({
      pieces: { weights, noTripleDuplicate: false, fitGuarantee: "none" },
    });
    const board = createBoard(SIZE);

    const countTriples = (config: ResolvedConfig): number => {
      const rng = createRng("triples");
      let n = 0;
      for (let i = 0; i < 3000; i++) {
        const [a, b, c] = ids(generateTray(rng, board, config));
        if (a === b && b === c) n++;
      }
      return n;
    };

    expect(countTriples(off)).toBeGreaterThan(0); // 対照: 無効なら発生する
    expect(countTriples(on)).toBe(0);
  });

  it('fitGuarantee "oneOfThree": 少なくとも 1 つ置ける', () => {
    // 下 2 行だけ空いた盤(高さ 2 以下の形状なら置ける)。
    const board = createBoard(SIZE).fill(1);
    for (let y = 8; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) board[boardIndex(SIZE, x, y)] = 0;
    }
    const rng = createRng("fit-guarantee");
    for (let i = 0; i < 300; i++) {
      const tray = generateTray(rng, board, DEFAULT_CONFIG);
      expect(anyFits(board, SIZE, tray), `試行 ${i}: ${ids(tray).join(",")}`).toBe(true);
    }
  });

  it("fitGuarantee は最大 20 回の再抽選までのベストエフォート(docs/01 §4.2)", () => {
    // dot しか置けない極端な盤。20 回引き直しても保証できないことがある。
    const board = createBoard(SIZE).fill(1);
    board[boardIndex(SIZE, 2, 7)] = 0;
    const rng = createRng("best-effort");
    let fits = 0;
    const trials = 300;
    for (let i = 0; i < trials; i++) {
      if (anyFits(board, SIZE, generateTray(rng, board, DEFAULT_CONFIG))) fits++;
    }
    expect(fits / trials).toBeGreaterThan(0.9);
    expect(fits).toBeLessThanOrEqual(trials);
  });

  it('fitGuarantee "none" では置けないトレイが出る', () => {
    const board = createBoard(SIZE).fill(1);
    board[boardIndex(SIZE, 2, 7)] = 0;
    const config = withConfig({ pieces: { fitGuarantee: "none" } });
    const rng = createRng("no-guarantee");
    let unfit = 0;
    for (let i = 0; i < 100; i++) {
      if (!anyFits(board, SIZE, generateTray(rng, board, config))) unfit++;
    }
    expect(unfit).toBeGreaterThan(0);
  });

  it("盤に全く置けない場合は最大再抽選の後そのまま返す(ゲームオーバー判定に任せる)", () => {
    const full = createBoard(SIZE).fill(1);
    const rng = createRng("hopeless");
    const tray = generateTray(rng, full, DEFAULT_CONFIG);
    expect(tray).toHaveLength(TRAY_SIZE);
    expect(anyFits(full, SIZE, tray)).toBe(false);
  });

  describe("pity", () => {
    const filledBoard = (cells: number): Board => {
      const b = createBoard(SIZE);
      for (let i = 0; i < cells; i++) b[i] = 1;
      return b;
    };

    it("閾値未満では重みが変わらない", () => {
      const w = effectiveWeights(filledBoard(50), DEFAULT_CONFIG); // 0.5 < 0.6
      expect(w).toEqual(SHAPES.map((s) => DEFAULT_CONFIG.pieces.weights[s.id] ?? 0));
    });

    it("閾値以上でセル数 3 以下の重みが smallBoost 倍になる", () => {
      const w = effectiveWeights(filledBoard(60), DEFAULT_CONFIG); // 0.6 >= 0.6
      SHAPES.forEach((shape, i) => {
        const base = DEFAULT_CONFIG.pieces.weights[shape.id] ?? 0;
        const expected = shape.cells.length <= PITY_MAX_CELLS ? base * 1.5 : base;
        expect(w[i], shape.id).toBeCloseTo(expected, 10);
      });
    });

    it("pity 無効なら底上げしない", () => {
      const config = withConfig({ pieces: { pity: { enabled: false } } });
      const w = effectiveWeights(filledBoard(90), config);
      expect(w).toEqual(SHAPES.map((s) => config.pieces.weights[s.id] ?? 0));
    });

    it("統計: 10 000 回の抽選で小形状の比率が上がる", () => {
      const board = filledBoard(60);
      const base = withConfig({
        pieces: { fitGuarantee: "none", noTripleDuplicate: false, pity: { enabled: false } },
      });
      const pity = withConfig({
        pieces: { fitGuarantee: "none", noTripleDuplicate: false, pity: { enabled: true } },
      });

      const smallRatio = (config: ResolvedConfig): number => {
        const rng = createRng("pity-stats");
        let small = 0;
        let total = 0;
        for (let i = 0; i < 10_000 / TRAY_SIZE; i++) {
          for (const id of ids(generateTray(rng, board, config))) {
            total++;
            if (isSmall(id)) small++;
          }
        }
        return small / total;
      };

      const baseRatio = smallRatio(base);
      const pityRatio = smallRatio(pity);
      // 既定重みでの理論値: 小形状(セル数 <= 3)の重み合計 7.8 / 全体 16.35 ≒ 0.477
      // pity 時: 11.7 / 20.25 ≒ 0.578
      expect(baseRatio).toBeGreaterThan(0.45);
      expect(baseRatio).toBeLessThan(0.51);
      expect(pityRatio).toBeGreaterThan(0.55);
      expect(pityRatio).toBeGreaterThan(baseRatio + 0.05);
    });
  });

  describe("pickWeighted", () => {
    it("重みに比例する", () => {
      const w = SHAPES.map((s) => (s.id === "dot" ? 3 : s.id === "h2" ? 1 : 0));
      expect(pickWeighted(0, w).id).toBe("dot");
      expect(pickWeighted(0.74, w).id).toBe("dot");
      expect(pickWeighted(0.76, w).id).toBe("h2");
      expect(pickWeighted(0.999999, w).id).toBe("h2");
    });

    it("合計が 0 なら先頭の形状にフォールバックする", () => {
      expect(
        pickWeighted(
          0.5,
          SHAPES.map(() => 0),
        ).id,
      ).toBe("dot");
    });

    it("rnd = 1(境界越え)でも最後の正の重みの形状を返す", () => {
      const w = SHAPES.map((s) => (s.id === "r3x2" ? 1 : 0));
      expect(pickWeighted(1, w).id).toBe("r3x2");
    });
  });
});
