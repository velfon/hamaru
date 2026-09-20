/**
 * 改善エージェントを動かす日の判定(docs/05 §13 N-11)。
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { DecisionJson } from "../../scripts/experiment/decide";
import type { MetricsReport, TopErrorJson } from "../../scripts/metrics/report";
import { shouldRun, DEFAULT_MIN_SESSIONS } from "../../scripts/kaizen-should-run";

const metrics = (o: {
  sessions?: number;
  crashFree?: number | null;
  lcp?: number | null;
  inp?: number | null;
  errors?: TopErrorJson[];
}): MetricsReport =>
  ({
    overall: {
      d7: { sessions: o.sessions ?? 0, crash_free: o.crashFree ?? 1 },
    },
    topErrors: o.errors ?? [],
    vitals: { lcp_p75: o.lcp ?? 400, inp_p75: o.inp ?? 40, cls_p75: 0 },
  }) as unknown as MetricsReport;

const error = (over: Partial<TopErrorJson>): TopErrorJson => ({
  stackHash: "3fa9",
  message: "TypeError: x",
  n: 3,
  nRecent: 3,
  firstVersion: "abc1234",
  isNew: false,
  rising: false,
  ...over,
});

const decision = (d: DecisionJson["decision"]): DecisionJson =>
  ({ decision: d, experiment: "EXP-0001", reason: "" }) as DecisionJson;

const run = (m: MetricsReport, d: DecisionJson | null = null, minSessions = DEFAULT_MIN_SESSIONS) =>
  shouldRun({ metrics: m, decision: d, minSessions });

describe("shouldRun", () => {
  it("データが少なく異常も無い日は動かさない(既定の状態)", () => {
    const r = run(metrics({ sessions: 15 }));
    expect(r.run).toBe(false);
    expect(r.reason).toContain("15 < 200");
  });

  it("実験の結論が要る日は人数に関係なく動かす", () => {
    for (const d of ["promote", "rollback", "inconclusive"] as const) {
      expect(run(metrics({ sessions: 1 }), decision(d)).run).toBe(true);
    }
    // continue / none は結論処理が不要
    for (const d of ["continue", "none"] as const) {
      expect(run(metrics({ sessions: 1 }), decision(d)).run).toBe(false);
    }
  });

  it("新規・増加中のエラーがあれば動かす", () => {
    expect(run(metrics({ sessions: 1, errors: [error({ isNew: true })] })).run).toBe(true);
    expect(run(metrics({ sessions: 1, errors: [error({ rising: true })] })).run).toBe(true);
    // 既知で落ち着いているエラーだけなら動かさない
    expect(run(metrics({ sessions: 1, errors: [error({})] })).run).toBe(false);
  });

  it("crash_free の低下は、セッションが 20 以上のときだけ異常とみなす", () => {
    expect(run(metrics({ sessions: 30, crashFree: 0.99 })).run).toBe(true);
    expect(run(metrics({ sessions: 19, crashFree: 0.5 })).run).toBe(false);
    expect(run(metrics({ sessions: 30, crashFree: null })).run).toBe(false);
  });

  it("性能が予算を割ったら動かす", () => {
    expect(run(metrics({ sessions: 5, lcp: 1600 })).run).toBe(true);
    expect(run(metrics({ sessions: 5, inp: 120 })).run).toBe(true);
    expect(run(metrics({ sessions: 5, lcp: 1500, inp: 100 })).run).toBe(false);
    expect(run(metrics({ sessions: 5, lcp: null, inp: null })).run).toBe(false);
  });

  it("データが十分な日は動かす(しきい値は変えられる)", () => {
    expect(run(metrics({ sessions: 200 })).run).toBe(true);
    expect(run(metrics({ sessions: 60 }), null, 50).run).toBe(true);
    expect(run(metrics({ sessions: 40 }), null, 50).run).toBe(false);
  });
});

describe("CLI と workflow の結線", () => {
  const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

  it("指標を読んで run / reason を GITHUB_OUTPUT に書く", () => {
    const dir = mkdtempSync(join(tmpdir(), "hamaru-gate-"));
    const out = join(dir, "out.txt");
    writeFileSync(join(dir, "2026-09-20.json"), JSON.stringify(metrics({ sessions: 15 })));
    const run = (args: string[]) =>
      execFileSync("npx", ["tsx", "scripts/kaizen-should-run.ts", ...args], {
        cwd: repoRoot,
        encoding: "utf8",
        env: { ...process.env, GITHUB_OUTPUT: out },
      });

    expect(run(["--metrics", dir, "--date", "2026-09-20"])).toContain("skip — 直近 7 日");
    expect(readFileSync(out, "utf8")).toContain("run=false");

    // 実験の判定ファイルがあれば読む
    writeFileSync(join(dir, "2026-09-20-decision.json"), JSON.stringify(decision("promote")));
    expect(run(["--metrics", dir, "--date", "2026-09-20", "--min-sessions", "200"])).toContain(
      "run — 実験の結論処理が必要",
    );
    expect(readFileSync(out, "utf8")).toContain("run=true");
  }, 60_000);

  it("kaizen-daily.yml は gate の結果で Claude の起動を切り替える", () => {
    const yml = readFileSync(join(repoRoot, ".github/workflows/kaizen-daily.yml"), "utf8");
    expect(yml).toContain("npm run kaizen:should-run");
    expect(yml).toContain("id: gate");
    // Claude と playwright の導入はゲートが true の日だけ(step ごとに区切って照合する)
    const steps = yml.split(/\n {6}- /);
    for (const marker of ["uses: anthropics/claude-code-action@v1", "npx playwright install"]) {
      const step = steps.filter((s) => s.includes(marker));
      expect(step).toHaveLength(1);
      expect(step[0]).toContain("if: steps.gate.outputs.run == 'true'");
    }
  });
});
