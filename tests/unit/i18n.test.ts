/**
 * i18n(docs/01 §12、docs/03 §7)。
 * キー差分そのものは `npm run i18n:check` が見るので、ここは実行時の挙動を見る。
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  detectLang,
  formatCountdown,
  formatDate,
  formatNumber,
  getLang,
  MESSAGES,
  setLang,
  t,
} from "../../src/i18n";

afterEach(() => setLang("ja"));

describe("detectLang", () => {
  it("先頭が ja* なら ja、それ以外は en", () => {
    expect(detectLang(["ja-JP", "en-US"])).toBe("ja");
    expect(detectLang(["ja"])).toBe("ja");
    expect(detectLang(["en-US", "ja"])).toBe("en");
    expect(detectLang(["fr"])).toBe("en");
  });

  it("空・未定義でも落ちない", () => {
    expect(detectLang([])).toBe("en");
    expect(detectLang(undefined)).toBe("en");
  });
});

describe("t", () => {
  it("言語を切り替えると文言が変わる", () => {
    setLang("ja");
    expect(t("home.play")).toBe("エンドレス");
    setLang("en");
    expect(t("home.play")).toBe("Play endless");
    expect(getLang()).toBe("en");
  });

  it("プレースホルダを置換する", () => {
    setLang("ja");
    expect(t("a11y.placed", { points: 12, lines: 1 })).toBe("12 点、1 列消去");
    setLang("en");
    expect(t("a11y.placed", { points: 12, lines: 1 })).toBe("12 points, 1 lines cleared");
  });

  it("未知のキーはキー自身を返す", () => {
    expect(t("nope.nope")).toBe("nope.nope");
  });

  it("引数が足りないときはプレースホルダを残す", () => {
    setLang("ja");
    expect(t("home.daily.streak", {})).toBe("連続 {n} 日");
  });

  it("ja / en のキー集合が一致する", () => {
    expect(Object.keys(MESSAGES.ja).sort()).toEqual(Object.keys(MESSAGES.en).sort());
  });
});

describe("書式", () => {
  it("3 桁区切り(docs/01 §6)", () => {
    setLang("ja");
    expect(formatNumber(1234567)).toBe("1,234,567");
    setLang("en");
    expect(formatNumber(0)).toBe("0");
  });

  it("残り時間は hh:mm", () => {
    expect(formatCountdown(0)).toBe("00:00");
    expect(formatCountdown(60_000)).toBe("00:01");
    expect(formatCountdown(3_600_000 * 7 + 60_000 * 3)).toBe("07:03");
    expect(formatCountdown(-5)).toBe("00:00");
  });

  it("日付は UTC で表示する", () => {
    setLang("en");
    expect(formatDate("2026-10-01")).toBe("10/1");
    expect(formatDate("こわれた")).toBe("こわれた");
  });
});
