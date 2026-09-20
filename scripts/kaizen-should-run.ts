/**
 * `npm run kaizen:should-run` — その日に改善エージェントを動かす意味があるかを決める(docs/05 §13 N-11)。
 *
 *   tsx scripts/kaizen-should-run.ts --metrics kaizen/metrics --date YYYY-MM-DD [--min-sessions 200]
 *
 * データがほとんど無い時期に毎晩 Claude を動かしても、効果を測れないまま利用枠と費用だけ使う。
 * 一方で「新しいエラー」「性能の悪化」「実験の結論」は人数が少なくても直す価値がある。
 * そこで、次のどれかに当てはまる日だけ動かす(判断は決定論的で、LLM には委ねない)。
 */
import { readFileSync } from "node:fs";
import { appendFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { DecisionJson } from "./experiment/decide";
import type { MetricsReport } from "./metrics/report";

/** これを下回る crash_free は異常(docs/00 §4 の目標 99.5 %)。 */
export const CRASH_FREE_MIN = 0.995;
/** 異常判定に必要な最小のセッション数(少なすぎると 1 件のエラーで跳ねる)。 */
export const CRASH_FREE_MIN_SESSIONS = 20;
/** 性能の予算(docs/02 §9)。 */
export const LCP_MAX_MS = 1500;
export const INP_MAX_MS = 100;
/** 「データが十分」と見なす直近 7 日のセッション数(vars.KAIZEN_MIN_SESSIONS で変えられる)。 */
export const DEFAULT_MIN_SESSIONS = 200;

export interface GateInput {
  metrics: MetricsReport;
  decision: DecisionJson | null;
  minSessions: number;
}

export interface GateResult {
  run: boolean;
  reason: string;
}

export function shouldRun(input: GateInput): GateResult {
  const { metrics, decision, minSessions } = input;
  const d7 = metrics.overall["d7"];

  const conclusion = decision?.decision;
  if (conclusion === "promote" || conclusion === "rollback" || conclusion === "inconclusive") {
    return {
      run: true,
      reason: `実験の結論処理が必要(${decision?.experiment ?? "?"}: ${conclusion})`,
    };
  }

  const errors = metrics.topErrors.filter((e) => e.isNew || e.rising);
  if (errors.length > 0) {
    return {
      run: true,
      reason: `新規・増加中のエラー ${errors.length} 件(${errors[0]?.stackHash})`,
    };
  }

  if (
    d7 !== undefined &&
    d7.crash_free !== null &&
    d7.sessions >= CRASH_FREE_MIN_SESSIONS &&
    d7.crash_free < CRASH_FREE_MIN
  ) {
    return { run: true, reason: `crash_free ${d7.crash_free} < ${CRASH_FREE_MIN}` };
  }

  const { lcp_p75: lcp, inp_p75: inp } = metrics.vitals;
  if (lcp !== null && lcp > LCP_MAX_MS)
    return { run: true, reason: `lcp_p75 ${lcp} ms > ${LCP_MAX_MS} ms` };
  if (inp !== null && inp > INP_MAX_MS)
    return { run: true, reason: `inp_p75 ${inp} ms > ${INP_MAX_MS} ms` };

  const sessions = d7?.sessions ?? 0;
  if (sessions >= minSessions) {
    return { run: true, reason: `直近 7 日の session ${sessions} ≥ ${minSessions}` };
  }

  return {
    run: false,
    reason: `直近 7 日の session ${sessions} < ${minSessions}、異常なし。改善しても効果を測れないので今日は動かさない`,
  };
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function main(argv: readonly string[]): number {
  const get = (name: string, fallback: string): string => {
    const i = argv.indexOf(name);
    return i >= 0 && argv[i + 1] !== undefined ? (argv[i + 1] as string) : fallback;
  };
  const dir = resolve(get("--metrics", "kaizen/metrics"));
  const date = get("--date", "");
  const minSessions = Number(get("--min-sessions", String(DEFAULT_MIN_SESSIONS)));
  if (date === "") {
    console.error("kaizen:should-run: --date が必要です");
    return 1;
  }
  let result: GateResult;
  try {
    const metrics = readJson<MetricsReport>(join(dir, `${date}.json`));
    let decision: DecisionJson | null = null;
    try {
      decision = readJson<DecisionJson>(join(dir, `${date}-decision.json`));
    } catch {
      /* 判定ファイルが無い日は none 扱い */
    }
    result = shouldRun({
      metrics,
      decision,
      minSessions: Number.isFinite(minSessions) ? minSessions : DEFAULT_MIN_SESSIONS,
    });
  } catch (e) {
    console.error(`kaizen:should-run: 指標を読めませんでした: ${(e as Error).message}`);
    return 1;
  }
  console.log(`kaizen:should-run: ${result.run ? "run" : "skip"} — ${result.reason}`);
  const out = process.env["GITHUB_OUTPUT"];
  if (out) appendFileSync(out, `run=${result.run}\nreason=${result.reason}\n`);
  return 0;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  process.exitCode = main(process.argv.slice(2));
}
