/**
 * canary(docs/05 §7.3): デプロイ後 30 分のエラー session 率を直前 24 時間と比べる。
 */
import { describe, expect, it } from "vitest";
import { canarySql, judge, runCanary, type CanaryWindow } from "../../scripts/canary";

const SINCE = Date.parse("2026-10-15T03:00:00Z");
const W: CanaryWindow = { sinceMs: SINCE, windowMs: 30 * 60_000, baselineMs: 24 * 3_600_000 };

/** n 個の session(うち e 個にエラー)を、デプロイ前(before)か後に置く。 */
function sessions(n: number, e: number, after: boolean, w = 1) {
  return Array.from({ length: n }, (_, i) => ({
    w,
    errors: i < e ? 1 : 0,
    firstMs: after ? SINCE + 60_000 : SINCE - 3_600_000,
  }));
}

describe("judge", () => {
  it("直近に session が無ければ skip", () => {
    expect(judge(sessions(100, 1, false), W).decision).toBe("skip");
  });

  it("エラー session 20 以上かつ基準の 3 倍超 → rollback", () => {
    // 基準 10/1000 = 1 %、直近 20/200 = 10 %
    const r = judge([...sessions(1000, 10, false), ...sessions(200, 20, true)], W);
    expect(r.decision).toBe("rollback");
    expect(r.recent).toEqual({ sessions: 200, errorSessions: 20, rate: 0.1 });
  });

  it("率が高くてもエラー session が 20 未満なら ok(少数のノイズで戻さない)", () => {
    expect(judge([...sessions(1000, 10, false), ...sessions(40, 19, true)], W).decision).toBe("ok");
  });

  it("3 倍ちょうどは ok(超えたときだけ)", () => {
    // 基準 1 %、直近 3 %(30/1000)
    expect(judge([...sessions(1000, 10, false), ...sessions(1000, 30, true)], W).decision).toBe(
      "ok",
    );
    expect(judge([...sessions(1000, 10, false), ...sessions(1000, 31, true)], W).decision).toBe(
      "rollback",
    );
  });

  it("基準が 0 件でも 0.1 % を下限に判定する", () => {
    expect(judge([...sessions(500, 0, false), ...sessions(100, 20, true)], W).decision).toBe(
      "rollback",
    );
    expect(judge(sessions(100, 20, true), W).decision).toBe("rollback");
  });

  it("サンプリングの重みを数える", () => {
    const r = judge([...sessions(100, 1, false), ...sessions(10, 2, true, 10)], W);
    expect(r.recent).toEqual({ sessions: 100, errorSessions: 20, rate: 0.2 });
    expect(r.decision).toBe("rollback");
  });
});

describe("runCanary", () => {
  it("SQL は直前 24 時間〜デプロイ後 30 分、JOIN なし", () => {
    const sql = canarySql(W);
    expect(sql).toContain("timestamp >= toDateTime('2026-10-14 03:00:00')");
    expect(sql).toContain("timestamp < toDateTime('2026-10-15 03:30:00')");
    expect(sql).not.toMatch(/\bJOIN\b/);
  });

  it("応答の数値が文字列でも判定できる", async () => {
    const rows = [
      ...Array.from({ length: 100 }, (_, i) => ({
        session: `b${i}`,
        w: "1",
        errors: "0",
        first_ts: String((SINCE - 3_600_000) / 1000),
      })),
      ...Array.from({ length: 25 }, (_, i) => ({
        session: `r${i}`,
        w: "1",
        errors: "2",
        first_ts: String((SINCE + 60_000) / 1000),
      })),
    ];
    const r = await runCanary(async () => rows.map((x) => JSON.stringify(x)).join("\n"), W);
    expect(r.decision).toBe("rollback");
    expect(r.baseline.sessions).toBe(100);
  });
});
