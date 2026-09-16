/**
 * experiment:eval(docs/05 §6.3)。
 *
 * 統計の参照値は実装とは独立に、Python で t 分布の密度を数値積分(Simpson 則、20 万分割)して求めた。
 * 教科書の既知値(df=10 の 2.228、df=1 の 12.706 で両側 5 %)とも一致する。
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Experiment } from "../../src/config/schema";
import { decide, guardrailCheck, type DecideInput } from "../../scripts/experiment/decide";
import {
  logGamma,
  regularizedBeta,
  tQuantile,
  tTwoSidedP,
  welch,
} from "../../scripts/experiment/stats";
import type { ArmSummary, InstallRow } from "../../scripts/metrics/aggregate";
import { latestMetricsDate, parseArgs, runEval } from "../../scripts/experiment-eval";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), "hamaru-eval-"));

describe("stats", () => {
  it("logGamma", () => {
    expect(logGamma(5)).toBeCloseTo(Math.log(24), 12);
    expect(logGamma(0.5)).toBeCloseTo(Math.log(Math.sqrt(Math.PI)), 12);
    expect(logGamma(10.5)).toBeCloseTo(13.940625219403763, 10);
  });

  it("regularizedBeta の端と対称性", () => {
    expect(regularizedBeta(0, 2, 3)).toBe(0);
    expect(regularizedBeta(1, 2, 3)).toBe(1);
    expect(regularizedBeta(0.3, 2, 3) + regularizedBeta(0.7, 3, 2)).toBeCloseTo(1, 12);
    // I_x(1, 1) = x
    expect(regularizedBeta(0.37, 1, 1)).toBeCloseTo(0.37, 12);
  });

  it.each([
    [2.0, 10, 0.0733880348],
    [2.228138851986, 10, 0.05],
    [12.7062047362, 1, 0.05],
    [1.0, 3.5, 0.3813372536],
    [0.5, 27.3, 0.6210816183],
    [3.0, 200, 0.0030430471],
    [2.5, 5, 0.0544900993],
  ])("tTwoSidedP(t=%s, df=%s) = %s(独立に数値積分した参照値)", (t, df, p) => {
    expect(tTwoSidedP(t, df)).toBeCloseTo(p, 6);
    expect(tTwoSidedP(-t, df)).toBeCloseTo(p, 6);
  });

  it("tTwoSidedP の端", () => {
    expect(tTwoSidedP(0, 7)).toBe(1);
    expect(tTwoSidedP(Infinity, 7)).toBe(0);
  });

  it("tQuantile は既知の臨界値を返す", () => {
    expect(tQuantile(0.975, 10)).toBeCloseTo(2.228138852, 6);
    expect(tQuantile(0.975, 1)).toBeCloseTo(12.7062047362, 5);
    expect(tQuantile(0.975, 1e6)).toBeCloseTo(1.959966, 4);
  });

  it("welch は Python で独立に計算した t / df / p と一致する", () => {
    const a = [19.8, 20.4, 19.6, 17.8, 18.5, 18.9, 18.3, 18.9, 19.5, 22.0];
    const b = [
      28.2, 26.6, 20.1, 23.3, 25.2, 22.1, 17.7, 27.6, 20.6, 13.7, 23.2, 17.5, 20.6, 18.0, 23.9,
      21.6, 24.3, 20.4, 23.9, 13.3,
    ];
    const r = welch(a, b);
    expect(r).not.toBeNull();
    expect(r?.mean0).toBeCloseTo(19.37, 10);
    expect(r?.mean1).toBeCloseTo(21.59, 10);
    expect(r?.t).toBeCloseTo(2.22551204, 7);
    expect(r?.df).toBeCloseTo(24.52463494, 6);
    expect(r?.p).toBeCloseTo(0.0354845308, 6);
    // 95 % CI は diff を挟み、0 を含まない(p < 0.05 と整合)
    expect(r?.ciLow).toBeGreaterThan(0);
    expect(r?.ciHigh).toBeGreaterThan(r?.diff ?? Infinity);
  });

  it("welch の端: 2 件未満は null、分散 0 は p=1 か p=0", () => {
    expect(welch([1], [1, 2])).toBeNull();
    expect(welch([1, 1], [1, 1])).toMatchObject({ t: 0, p: 1 });
    expect(welch([1, 1], [2, 2])).toMatchObject({ t: null, p: 0, diff: 1 });
  });
});

/* ------------------------------------------------------------------ */
/* 判定                                                                 */
/* ------------------------------------------------------------------ */

const NOW = Date.parse("2026-10-20T18:00:00Z");
const daysAgo = (d: number): string =>
  new Date(NOW - d * 86_400_000 - 3_600_000).toISOString().replace(".000Z", "Z");

function experiment(overrides: Partial<Experiment> = {}): Experiment {
  return {
    id: "EXP-0003",
    status: "running",
    startedAt: daysAgo(5),
    hypothesis: "pity を早める",
    primaryMetric: "games_per_session",
    guardrails: ["crash_free", "median_game_seconds", "abandon_rate"],
    minUsersPerArm: 300,
    maxDays: 14,
    allocation: { control: 0.5, treatment: 0.5 },
    variants: { control: {}, treatment: { pieces: { pity: { threshold: 0.5 } } } },
    lockedInDaily: true,
    ...overrides,
  };
}

/** 決定的な「ばらつき」: -1.5, -0.5, +0.5, +1.5 を繰り返す(標準偏差 ≈ 1.12)。 */
const wobble = (i: number): number => (i % 4) - 1.5;

function rows(
  variant: string,
  n: number,
  value: (i: number) => { games?: number; abandons?: number; sessions?: number },
): InstallRow[] {
  return Array.from({ length: n }, (_, i) => {
    const v = value(i);
    return {
      install: `${variant}-${i}`,
      variant,
      w: 1,
      sessions: v.sessions ?? 10,
      games: v.games ?? 20,
      abandons: v.abandons ?? 0,
      gameMinutes: 30,
      errorSessions: 0,
      sessionRows: 10,
      dailyStarts: 0,
      dailyResults: 0,
      shares: 0,
    };
  });
}

const arm = (overrides: Partial<ArmSummary> = {}): ArmSummary => ({
  installs: 400,
  sessions: 4000,
  games: 8000,
  games_per_session: { mean: 2, sd: 1 },
  crash_free: 0.995,
  median_game_seconds: 190,
  abandon_rate: 0.1,
  ...overrides,
});

function input(o: {
  exp?: Experiment | null;
  control: InstallRow[];
  treatment: InstallRow[];
  armC?: Partial<ArmSummary>;
  armT?: Partial<ArmSummary>;
}): DecideInput {
  return {
    date: "2026-10-20",
    nowMs: NOW,
    experiment: o.exp === undefined ? experiment() : o.exp,
    arms: { control: arm(o.armC), treatment: arm(o.armT) },
    installs: [...o.control, ...o.treatment],
  };
}

// gps(games / sessions): control ≈ 2.0 ± 1.1、treatment ≈ 2.4 ± 1.1(sessions = 10)
const gps = (mean: number) => (i: number) => ({ games: (mean + wobble(i) * 0.75) * 10 });

describe("decide", () => {
  it("稼働中の実験がなければ none", () => {
    const d = decide({
      date: "2026-10-20",
      nowMs: NOW,
      experiment: null,
      arms: null,
      installs: [],
    });
    expect(d.decision).toBe("none");
    expect(d.experiment).toBeNull();
  });

  it("サンプル到達・有意に改善 → promote", () => {
    const d = decide(
      input({
        control: rows("control", 400, gps(2.0)),
        treatment: rows("treatment", 400, gps(2.4)),
      }),
    );
    expect(d.decision).toBe("promote");
    expect(d.stats?.welch?.p).toBeLessThan(0.05);
    expect(d.stats?.welch?.liftPct).toBeCloseTo(20, 5);
    expect(d.reason).toMatch(
      /^n=400\/400, days=5, lift=\+20\.0% \(95%CI \+\d+\.\d\.\.\+\d+\.\d\), p=0\.000, guardrails ok$/,
    );
    expect(d.guardrails.map((g) => g.ok)).toEqual([true, true, true]);
  });

  it("サンプル到達・有意に悪化 → rollback", () => {
    const d = decide(
      input({
        control: rows("control", 400, gps(2.4)),
        treatment: rows("treatment", 400, gps(2.0)),
      }),
    );
    expect(d.decision).toBe("rollback");
    expect(d.stats?.welch?.liftPct).toBeLessThan(0);
  });

  it("サンプル不足 → continue(検定の数値は参考として残す)", () => {
    const d = decide(
      input({ control: rows("control", 50, gps(2.0)), treatment: rows("treatment", 50, gps(2.4)) }),
    );
    expect(d.decision).toBe("continue");
    expect(d.reason).toContain("need n>=300/arm");
    expect(d.reason).toContain("guardrails not evaluated (n<100)");
    expect(d.stats?.welch).not.toBeNull();
  });

  it("サンプル到達でも 3 日未満なら continue", () => {
    const exp = experiment({ startedAt: daysAgo(2) });
    const d = decide(
      input({
        exp,
        control: rows("control", 400, gps(2.0)),
        treatment: rows("treatment", 400, gps(2.4)),
      }),
    );
    expect(d.decision).toBe("continue");
    expect(d.stats?.days).toBe(2);
  });

  it("ガードレール違反(n≥100)→ 有意差がなくても rollback", () => {
    const d = decide(
      input({
        control: rows("control", 150, gps(2.0)),
        treatment: rows("treatment", 150, gps(2.0)),
        armC: { crash_free: 0.995 },
        armT: { crash_free: 0.98 },
      }),
    );
    expect(d.decision).toBe("rollback");
    expect(d.reason).toContain("guardrail breached: crash_free");
  });

  it("ガードレールは n<100 では判定しない", () => {
    const d = decide(
      input({
        control: rows("control", 99, gps(2.0)),
        treatment: rows("treatment", 99, gps(2.0)),
        armT: { crash_free: 0.5 },
      }),
    );
    expect(d.decision).toBe("continue");
    expect(d.guardrails).toEqual([]);
  });

  it("median_game_seconds が帯域外 → rollback", () => {
    const d = decide(
      input({
        control: rows("control", 150, gps(2.0)),
        treatment: rows("treatment", 150, gps(2.0)),
        armT: { median_game_seconds: 95 },
      }),
    );
    expect(d.decision).toBe("rollback");
    expect(d.reason).toContain("median_game_seconds");
  });

  it("maxDays 経過・有意差なし → inconclusive", () => {
    const exp = experiment({ startedAt: daysAgo(15) });
    const d = decide(
      input({
        exp,
        control: rows("control", 400, gps(2.0)),
        treatment: rows("treatment", 400, gps(2.0)),
      }),
    );
    expect(d.decision).toBe("inconclusive");
    expect(d.reason).toContain("maxDays reached");
  });

  it("maxDays 経過・サンプル不足 → inconclusive", () => {
    const exp = experiment({ startedAt: daysAgo(14) });
    const d = decide(
      input({
        exp,
        control: rows("control", 20, gps(2.0)),
        treatment: rows("treatment", 20, gps(2.4)),
      }),
    );
    expect(d.decision).toBe("inconclusive");
  });

  it("abandon_rate は下がるのが改善 → promote", () => {
    const exp = experiment({ primaryMetric: "abandon_rate", guardrails: [] });
    const ab = (rate: number) => (i: number) => ({
      games: 20,
      abandons: (rate + wobble(i) * 0.05) * 20,
    });
    const d = decide(
      input({
        exp,
        control: rows("control", 400, ab(0.3)),
        treatment: rows("treatment", 400, ab(0.2)),
      }),
    );
    expect(d.stats?.direction).toBe("down");
    expect(d.decision).toBe("promote");
  });

  it("分母のない install は検定から外す(games_per_session で sessions=0)", () => {
    const control = [
      ...rows("control", 400, gps(2.0)),
      ...rows("control", 5, () => ({ sessions: 0, games: 0 })).map((r, i) => ({
        ...r,
        install: `c0-${i}`,
      })),
    ];
    const d = decide(input({ control, treatment: rows("treatment", 400, gps(2.4)) }));
    expect(d.stats?.installs["control"]).toBe(405);
    expect(d.stats?.n["control"]).toBe(400);
  });

  it("未対応の主要指標・ガードレール・3 腕は例外(黙って進めない)", () => {
    const c = rows("control", 10, gps(2));
    const t = rows("treatment", 10, gps(2));
    expect(() =>
      decide(input({ exp: experiment({ primaryMetric: "vibes" }), control: c, treatment: t })),
    ).toThrow("未対応の主要指標");
    expect(() =>
      decide(input({ exp: experiment({ guardrails: ["mood"] }), control: c, treatment: t })),
    ).toThrow("未対応のガードレール");
    const three = experiment({
      allocation: { control: 0.4, a: 0.3, b: 0.3 },
      variants: { control: {}, a: {}, b: {} },
    });
    expect(() => decide(input({ exp: three, control: c, treatment: t }))).toThrow("2 腕のみ");
  });

  it("<指標>_min_<n> / _max_<n> のガードレール", () => {
    const min = guardrailCheck("median_game_seconds_min_120");
    expect(min(arm(), arm({ median_game_seconds: 119 })).ok).toBe(false);
    expect(min(arm(), arm({ median_game_seconds: 120 })).ok).toBe(true);
    const max = guardrailCheck("abandon_rate_max_0.25");
    expect(max(arm(), arm({ abandon_rate: 0.3 })).ok).toBe(false);
    expect(max(arm(), arm({ abandon_rate: null })).skipped).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* CLI / ファイル                                                       */
/* ------------------------------------------------------------------ */

describe("runEval", () => {
  const writeJson = (path: string, v: unknown): string => {
    writeFileSync(path, JSON.stringify(v), "utf8");
    return path;
  };
  const experimentsFile = (exps: Experiment[]) =>
    writeJson(join(tmp, `exp-${exps.length}-${Math.random()}.json`), {
      schemaVersion: 1,
      experiments: exps,
    });

  it("実験がなければ metrics が無くても decision=none を書く", () => {
    const dir = join(tmp, "none");
    const { decision, path } = runEval(
      parseArgs(["--metrics", dir, "--experiments", experimentsFile([])], NOW),
    );
    expect(decision.decision).toBe("none");
    expect(path).toBe(join(dir, "2026-10-20-decision.json"));
    expect(JSON.parse(readFileSync(path, "utf8")).decision).toBe("none");
  });

  it("metrics と installs を読んで判定し、最新の日付を使う", () => {
    const dir = join(tmp, "run");
    mkdirSync(dir, { recursive: true });
    const exp = experiment();
    writeJson(join(dir, "2026-10-19.json"), { experiment: { id: "EXP-0003", arms: {} } });
    writeJson(join(dir, "2026-10-20.json"), {
      experiment: { id: "EXP-0003", arms: { control: arm(), treatment: arm() } },
    });
    writeJson(join(dir, "2026-10-20-installs.json"), {
      experiment: "EXP-0003",
      rows: [...rows("control", 400, gps(2.0)), ...rows("treatment", 400, gps(2.4))],
    });
    expect(latestMetricsDate(dir)).toBe("2026-10-20");
    const { decision } = runEval(
      parseArgs(["--metrics", dir, "--experiments", experimentsFile([exp])], NOW),
    );
    expect(decision.decision).toBe("promote");
    expect(decision.date).toBe("2026-10-20");
  });

  it("別の実験の集計なら例外", () => {
    const dir = join(tmp, "mismatch");
    mkdirSync(dir, { recursive: true });
    writeJson(join(dir, "2026-10-20.json"), { experiment: { id: "EXP-0002", arms: {} } });
    expect(() =>
      runEval(parseArgs(["--metrics", dir, "--experiments", experimentsFile([experiment()])], NOW)),
    ).toThrow("EXP-0002 の集計です");
  });

  it("CLI: 実験が稼働中なのに metrics が無ければ exit 1", () => {
    const dir = join(tmp, "cli-missing");
    let code = 0;
    let output = "";
    try {
      execFileSync(
        "npx",
        [
          "tsx",
          "scripts/experiment-eval.ts",
          "--metrics",
          dir,
          "--experiments",
          experimentsFile([experiment()]),
          "--date",
          "2026-10-20",
        ],
        { cwd: repoRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
      );
    } catch (e) {
      const err = e as { status?: number; stderr?: string };
      code = err.status ?? 1;
      output = err.stderr ?? "";
    }
    expect(code).toBe(1);
    expect(output).toContain("先に metrics:pull を実行してください");
  }, 60_000);
});
