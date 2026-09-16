/**
 * `npm run experiment:eval` — 稼働中の実験を判定して `kaizen/metrics/<date>-decision.json` を書く
 * (docs/05 §4.2、§6.3)。判定は決定的。config の書き換え(promote の取り込み等)はしない。
 * 結論処理は daily エージェントが decision.json に従って行う(kaizen/prompts/daily.md)。
 *
 *   npm run experiment:eval -- [--metrics kaizen/metrics] [--date YYYY-MM-DD] [--out DIR]
 *                              [--experiments src/config/experiments.json] [--now ISO]
 *
 * - `--date` 省略時は metrics ディレクトリの最新の `<date>.json`(無ければ今日 UTC)。
 * - 稼働中の実験が無ければ decision=none を書く(metrics が無くてもよい)。
 * - 実験があるのに metrics / installs が無い、または別の実験の集計なら exit 1。
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { DEFAULT_EXPERIMENTS_PATH, loadExperiments } from "../src/config/load";
import { runningExperiment } from "../src/config/resolve";
import { utcDateString } from "../src/core/daily";
import { decide, type DecisionJson } from "./experiment/decide";
import type { ArmSummary, InstallRow } from "./metrics/aggregate";
import type { InstallsFile, MetricsReport } from "./metrics/report";

export interface EvalOptions {
  metrics: string;
  out: string | null;
  date: string | null;
  experimentsPath: string;
  nowMs: number;
}

export function parseArgs(argv: readonly string[], nowMs: number): EvalOptions {
  const opts: EvalOptions = {
    metrics: "kaizen/metrics",
    out: null,
    date: null,
    experimentsPath: DEFAULT_EXPERIMENTS_PATH,
    nowMs,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = (): string => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${arg} に値がありません`);
      return v;
    };
    if (arg === "--metrics") opts.metrics = value();
    else if (arg === "--out") opts.out = value();
    else if (arg === "--date") opts.date = value();
    else if (arg === "--experiments") opts.experimentsPath = value();
    else if (arg === "--now") {
      const ms = Date.parse(value());
      if (Number.isNaN(ms)) throw new Error("--now は ISO 8601");
      opts.nowMs = ms;
    } else throw new Error(`不明な引数: ${arg}`);
  }
  if (opts.date !== null && !/^\d{4}-\d{2}-\d{2}$/.test(opts.date)) {
    throw new Error("--date は YYYY-MM-DD");
  }
  return opts;
}

/** metrics ディレクトリの最新の `<YYYY-MM-DD>.json` の日付。 */
export function latestMetricsDate(dir: string): string | null {
  if (!existsSync(dir)) return null;
  const dates = readdirSync(dir)
    .map((f) => /^(\d{4}-\d{2}-\d{2})\.json$/.exec(f)?.[1])
    .filter((d): d is string => d !== undefined)
    .sort();
  return dates.at(-1) ?? null;
}

export function runEval(opts: EvalOptions): { decision: DecisionJson; path: string } {
  const dir = resolve(opts.metrics);
  const date = opts.date ?? latestMetricsDate(dir) ?? utcDateString(opts.nowMs);
  const exp = runningExperiment(loadExperiments(opts.experimentsPath));

  let arms: Record<string, ArmSummary> | null = null;
  let installs: InstallRow[] = [];

  if (exp !== null) {
    const metricsPath = join(dir, `${date}.json`);
    const installsPath = join(dir, `${date}-installs.json`);
    if (!existsSync(metricsPath)) {
      throw new Error(
        `${exp.id} が稼働中ですが ${metricsPath} がありません。先に metrics:pull を実行してください`,
      );
    }
    const report = JSON.parse(readFileSync(metricsPath, "utf8")) as MetricsReport;
    if (report.experiment?.id !== exp.id) {
      throw new Error(
        `${metricsPath} は ${report.experiment?.id ?? "実験なし"} の集計です(稼働中: ${exp.id})。metrics:pull をやり直してください`,
      );
    }
    if (!existsSync(installsPath)) throw new Error(`${installsPath} がありません`);
    const file = JSON.parse(readFileSync(installsPath, "utf8")) as InstallsFile;
    if (file.experiment !== exp.id)
      throw new Error(`${installsPath} は ${file.experiment} の行です`);
    arms = report.experiment.arms;
    installs = file.rows;
  }

  const decision = decide({ date, nowMs: opts.nowMs, experiment: exp, arms, installs });
  const out = resolve(opts.out ?? opts.metrics);
  mkdirSync(out, { recursive: true });
  const path = join(out, `${date}-decision.json`);
  writeFileSync(path, JSON.stringify(decision, null, 2) + "\n", "utf8");
  return { decision, path };
}

function main(): number {
  try {
    const opts = parseArgs(process.argv.slice(2), Date.now());
    const { decision, path } = runEval(opts);
    console.log(`experiment:eval: ${decision.experiment ?? "-"} → ${decision.decision}`);
    console.log(`  ${decision.reason}`);
    console.log(`  wrote ${path}`);
    return 0;
  } catch (e) {
    console.error(`experiment:eval: ${(e as Error).message}`);
    return 1;
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  process.exitCode = main();
}
