import { describe, expect, it } from "vitest";
import { lineScore, scorePlacement, streakMultiplier } from "../../src/core/scoring";
import { DEFAULT_CONFIG } from "../../src/config";
import type { ScoringConfig } from "../../src/core/types";

const S: ScoringConfig = DEFAULT_CONFIG.scoring;

describe("scoring", () => {
  it("既定値が docs/01 §6 の表と一致", () => {
    expect(S.perCell).toBe(1);
    expect(S.lineBase).toBe(10);
    expect(S.streak.step).toBe(0.25);
    expect(S.streak.max).toBe(2.0);
    expect(S.boardClearBonus).toBe(300);
  });

  it("消去点は 1:10, 2:30, 3:60, 4:100, 5:150, 6:210", () => {
    expect([1, 2, 3, 4, 5, 6].map((n) => lineScore(n, 10))).toEqual([10, 30, 60, 100, 150, 210]);
    expect(lineScore(0, 10)).toBe(0);
    expect(lineScore(-1, 10)).toBe(0);
  });

  it("ストリーク倍率は 1.0 から step ずつ増え max で頭打ち", () => {
    const m = (s: number): number => streakMultiplier(s, 0.25, 2.0);
    expect(m(0)).toBe(1);
    expect(m(1)).toBe(1);
    expect(m(2)).toBe(1.25);
    expect(m(3)).toBe(1.5);
    expect(m(5)).toBe(2.0);
    expect(m(50)).toBe(2.0); // 上限
  });

  it("配置点はセル数 × perCell", () => {
    expect(scorePlacement({ cellCount: 5, lines: 0, streakAfter: 0, boardCleared: false }, S)).toBe(
      5,
    );
    expect(scorePlacement({ cellCount: 9, lines: 0, streakAfter: 0, boardCleared: false }, S)).toBe(
      9,
    );
  });

  it("配置点 + 消去点(ストリーク 1 は等倍)", () => {
    expect(scorePlacement({ cellCount: 4, lines: 1, streakAfter: 1, boardCleared: false }, S)).toBe(
      4 + 10,
    );
    expect(scorePlacement({ cellCount: 9, lines: 6, streakAfter: 1, boardCleared: false }, S)).toBe(
      9 + 210,
    );
  });

  it("ストリークは消去点にだけ掛かる", () => {
    // 3 連続目: 倍率 1.5。消去 2 列 = 30 → 45。配置点 3 はそのまま。
    expect(scorePlacement({ cellCount: 3, lines: 2, streakAfter: 3, boardCleared: false }, S)).toBe(
      3 + 45,
    );
  });

  it("全消しボーナスは倍率の外側で加算", () => {
    expect(scorePlacement({ cellCount: 1, lines: 1, streakAfter: 1, boardCleared: true }, S)).toBe(
      1 + 10 + 300,
    );
  });

  it("端数は加算ごとに Math.round される", () => {
    const odd: ScoringConfig = {
      perCell: 1.4,
      lineBase: 7,
      streak: { step: 0.25, max: 2 },
      boardClearBonus: 300.6,
    };
    // 配置: round(3 × 1.4) = round(4.2) = 4
    // 消去: lineScore(1, 7) = 7、倍率 1.25 → round(8.75) = 9
    // 全消し: round(300.6) = 301
    expect(
      scorePlacement({ cellCount: 3, lines: 1, streakAfter: 2, boardCleared: true }, odd),
    ).toBe(4 + 9 + 301);
  });

  it("得点は常に 0 以上で有限(スコアの単調非減少の前提)", () => {
    for (let lines = 0; lines <= 20; lines++) {
      for (let streak = 0; streak <= 20; streak++) {
        const v = scorePlacement(
          { cellCount: 9, lines, streakAfter: streak, boardCleared: false },
          S,
        );
        expect(Number.isFinite(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(0);
      }
    }
  });
});
