/**
 * デイリー結果カードの共有テキスト(docs/01 §9.4)。
 *
 *   HAMARU Daily #<n> (<YYYY-MM-DD>)
 *   4,520 pts · 18 lines · streak x2.0
 *   ▓▓▓▓▓▓▓░░░
 *   https://<host>/#/daily
 */
import { describe, expect, it } from "vitest";
import { buildShareText, dailyLabelNo, GAUGE_STEPS, type ShareInput } from "../../src/ui/share";

const base: ShareInput = {
  dailyNo: 12,
  date: "2026-10-12",
  score: 4520,
  lines: 18,
  multiplier: 2,
  gaugeMax: 6000,
  url: "https://hamaru.example/#/daily",
};

function lines(input: ShareInput): string[] {
  return buildShareText(input).split("\n");
}

describe("buildShareText", () => {
  it("設計書の形に一致する", () => {
    expect(buildShareText(base)).toBe(
      [
        "HAMARU Daily #12 (2026-10-12)",
        "4,520 pts · 18 lines · streak x2.0",
        "▓▓▓▓▓▓▓░░░",
        "https://hamaru.example/#/daily",
      ].join("\n"),
    );
  });

  it("epoch より前(通算番号 0 以下)は番号を出さない", () => {
    const text = buildShareText({ ...base, dailyNo: -13, date: "2026-09-17" });
    expect(text.split("\n")[0]).toBe("HAMARU Daily (2026-09-17)");
    expect(dailyLabelNo(0)).toBe("");
    expect(dailyLabelNo(null)).toBe("");
    expect(dailyLabelNo(1)).toBe(" #1");
  });

  it("ゲージは 10 段階", () => {
    expect(lines({ ...base, score: 0 })[2]).toBe("░".repeat(GAUGE_STEPS));
    expect(lines({ ...base, score: 6000 })[2]).toBe("▓".repeat(GAUGE_STEPS));
    expect(lines({ ...base, score: 999_999 })[2]).toBe("▓".repeat(GAUGE_STEPS));
    expect(lines({ ...base, score: 3000 })[2]).toBe("▓▓▓▓▓░░░░░");
  });

  it("gaugeMax が 0 でも落ちない", () => {
    expect(lines({ ...base, score: 100, gaugeMax: 0 })[2]).toBe("░".repeat(GAUGE_STEPS));
  });

  it("倍率は小数 1 桁", () => {
    expect(lines({ ...base, multiplier: 1 })[1]).toContain("streak x1.0");
    expect(lines({ ...base, multiplier: 1.75 })[1]).toContain("streak x1.8");
  });

  it("スコアは 3 桁区切り(表示と揃える)", () => {
    expect(lines({ ...base, score: 1234567 })[1]?.startsWith("1,234,567 pts")).toBe(true);
  });
});
