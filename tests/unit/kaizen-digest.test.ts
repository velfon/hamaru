/**
 * 週次ダイジェストの草稿(docs/05 §7.2)。
 */
import { describe, expect, it } from "vitest";
import type { Metrics } from "../../scripts/metrics/aggregate";
import type { MetricsReport } from "../../scripts/metrics/report";
import { buildDigest, isoWeek } from "../../scripts/kaizen-digest";

describe("isoWeek", () => {
  it.each([
    ["2026-10-19", "2026-W43"], // 月曜
    ["2026-10-25", "2026-W43"], // 日曜
    ["2026-10-26", "2026-W44"],
    ["2026-01-01", "2026-W01"], // 木曜
    ["2027-01-01", "2026-W53"], // 金曜 → 前年の最終週
    ["2024-12-30", "2025-W01"], // 月曜 → 翌年の第 1 週
  ])("%s → %s", (date, week) => {
    expect(isoWeek(date)).toBe(week);
  });
});

const metrics = (o: Partial<Metrics>): Metrics => ({
  sessions: 1000,
  installs_active: 400,
  installs_new: 120,
  games: 2500,
  games_per_session: 2.5,
  median_game_seconds: 190,
  median_score: 1200,
  p90_score: 3000,
  abandon_rate: 0.12,
  session_minutes_median: 6,
  d1_return: 0.2,
  daily_start_rate: 0.3,
  daily_completion: 0.7,
  share_rate: 0.05,
  crash_free: 0.998,
  lcp_p75: 1200,
  inp_p75: 60,
  cls_p75: 0.01,
  ...o,
});

const report = (d7: Metrics, extra: Partial<MetricsReport> = {}): MetricsReport =>
  ({
    schemaVersion: 1,
    generatedAt: "",
    date: "",
    version: "abc1234",
    windows: {},
    overall: { d7 },
    byDay: [],
    byPlatform: {},
    byLang: {},
    experiment: null,
    topErrors: [],
    vitals: { lcp_p75: null, inp_p75: null, cls_p75: null },
    sampling: { maxSampleInterval: 1 },
    ...extra,
  }) as MetricsReport;

describe("buildDigest", () => {
  const CHANGELOG = [
    "# CHANGELOG",
    "2026-10-11 | ux | 古い | … | … | …",
    "2026-10-13 | rule | pity 0.5 を実験 | 詰みが早い | games_per_session | —",
    "2026-10-19 | fix | 当日分は含めない | … | … | …",
  ].join("\n");

  it("指標表・今週の出荷・実験・注意を並べる", () => {
    const text = buildDigest({
      date: "2026-10-19",
      current: report(metrics({ games: 3000, d1_return: 0.23 }), {
        experiment: {
          id: "EXP-0003",
          status: "running",
          startedAt: "2026-10-13T00:00:00Z",
          days: 6,
          primaryMetric: "games_per_session",
          guardrails: [],
          minUsersPerArm: 300,
          maxDays: 14,
          arms: {
            control: {
              installs: 200,
              sessions: 0,
              games: 0,
              games_per_session: { mean: 2.4, sd: 1 },
              crash_free: 0.998,
              median_game_seconds: 180,
              abandon_rate: 0.1,
            },
          },
        },
        topErrors: [
          {
            stackHash: "3fa9",
            message: "TypeError: x",
            n: 14,
            nRecent: 5,
            firstVersion: "abc1234",
            isNew: true,
            rising: true,
          },
          {
            stackHash: "old1",
            message: "old",
            n: 14,
            nRecent: 1,
            firstVersion: "zzz",
            isNew: false,
            rising: false,
          },
        ],
      }),
      previous: report(metrics({})),
      decision: null,
      changelog: CHANGELOG,
    });
    expect(text).toContain("# Weekly digest 2026-W43(草稿)");
    expect(text).toContain("集計: 2026-10-12 〜 2026-10-18(UTC)");
    expect(text).toContain("| games(北極星) | 3,000 | 2,500 | +20.0% |");
    expect(text).toContain("| d1_return | 23.0% | 20.0% | +3.0pt |");
    expect(text).toContain("| lcp_p75 | 1200 ms | 1200 ms | +0.0% |");
    expect(text).toContain("- 2026-10-13 | rule | pity 0.5 を実験");
    expect(text).not.toContain("古い");
    expect(text).not.toContain("当日分は含めない");
    expect(text).toContain("- EXP-0003(6 日目 / 最大 14 日、主要指標 games_per_session)");
    expect(text).toContain("`3fa9` TypeError: x(14 件、直近 1 日 5、新規)");
    expect(text).not.toContain("`old1`");
  });

  it("metrics が無い週・前週が無い週でも壊れない", () => {
    const empty = buildDigest({
      date: "2026-10-19",
      current: null,
      previous: null,
      decision: null,
      changelog: "",
    });
    expect(empty).toContain("(集計日の metrics がありません)");
    expect(empty).toContain("- なし");
    const noPrev = buildDigest({
      date: "2026-10-19",
      current: report(metrics({})),
      previous: null,
      decision: null,
      changelog: "",
    });
    expect(noPrev).toContain("| games(北極星) | 2,500 | — | — |");
  });
});
