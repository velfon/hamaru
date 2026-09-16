/**
 * `npm run canary` — デプロイ後のエラー率を判定する(docs/05 §7.3)。
 *
 *   npm run canary -- --since <デプロイ時刻 ISO> [--window-minutes 30] [--baseline-hours 24]
 *
 * 規則(決定的):
 *   - 直近(デプロイ以降)に session が無い → skip(テレメトリが届いていない。判定しない)
 *   - エラーのあった session が 20 以上 かつ エラー session 率が基準(直前 24 時間)の 3 倍超 → rollback
 *   - それ以外 → ok
 * 基準の率が 0 のときは 0.001 を下限として 3 倍を計算する(ゼロ除算と過敏な判定を避ける)。
 *
 * 結果は標準出力と `GITHUB_OUTPUT`(`decision=ok|rollback|skip`)。exit は常に 0(判定の失敗=API エラーのみ 1)。
 */
import { appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { cloudflareFetcher, queryPaged, type SqlFetcher } from "./metrics/runner";
import { DATASET, dt, num } from "./metrics/sql";

export const MIN_ERROR_SESSIONS = 20;
export const RATIO = 3;
export const BASELINE_RATE_FLOOR = 0.001;

export interface CanaryWindow {
  /** デプロイ時刻(epoch ms)。これ以降が「直近」。 */
  sinceMs: number;
  /** 直近の窓の長さ。 */
  windowMs: number;
  /** 基準の窓の長さ(デプロイ前)。 */
  baselineMs: number;
}

export function canarySql(w: CanaryWindow): string {
  return `SELECT
  blob2 AS session,
  max(_sample_interval) AS w,
  countIf(blob1 = 'error') AS errors,
  min(toUnixTimestamp(timestamp)) AS first_ts
FROM ${DATASET}
WHERE timestamp >= ${dt(w.sinceMs - w.baselineMs)} AND timestamp < ${dt(w.sinceMs + w.windowMs)}
GROUP BY session`;
}

export interface Tally {
  sessions: number;
  errorSessions: number;
  rate: number | null;
}

export interface CanaryResult {
  decision: "ok" | "rollback" | "skip";
  reason: string;
  recent: Tally;
  baseline: Tally;
}

const tally = (sessions: number, errorSessions: number): Tally => ({
  sessions,
  errorSessions,
  rate: sessions > 0 ? errorSessions / sessions : null,
});

export function judge(
  rows: ReadonlyArray<{ w: number; errors: number; firstMs: number }>,
  w: CanaryWindow,
): CanaryResult {
  let rS = 0;
  let rE = 0;
  let bS = 0;
  let bE = 0;
  for (const r of rows) {
    if (r.firstMs >= w.sinceMs) {
      rS += r.w;
      if (r.errors > 0) rE += r.w;
    } else {
      bS += r.w;
      if (r.errors > 0) bE += r.w;
    }
  }
  const recent = tally(rS, rE);
  const baseline = tally(bS, bE);
  const fmt = (t: Tally) =>
    `${t.errorSessions}/${t.sessions} (${t.rate === null ? "-" : (t.rate * 100).toFixed(2) + "%"})`;
  const text = `recent ${fmt(recent)} vs baseline ${fmt(baseline)}`;

  if (recent.rate === null) {
    return { decision: "skip", reason: `直近に session がありません。${text}`, recent, baseline };
  }
  const threshold = RATIO * Math.max(baseline.rate ?? 0, BASELINE_RATE_FLOOR);
  if (recent.errorSessions >= MIN_ERROR_SESSIONS && recent.rate > threshold) {
    return {
      decision: "rollback",
      reason: `${text}: エラー session ≥ ${MIN_ERROR_SESSIONS} かつ率が基準の ${RATIO} 倍超`,
      recent,
      baseline,
    };
  }
  return { decision: "ok", reason: text, recent, baseline };
}

export async function runCanary(fetcher: SqlFetcher, w: CanaryWindow): Promise<CanaryResult> {
  const rows = await queryPaged(fetcher, canarySql(w), "session");
  return judge(
    rows.map((r) => ({
      w: Math.max(1, num(r["w"])),
      errors: num(r["errors"]),
      firstMs: num(r["first_ts"]) * 1000,
    })),
    w,
  );
}

function arg(argv: readonly string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const since = Date.parse(arg(argv, "--since") ?? "");
  if (Number.isNaN(since)) {
    console.error("canary: --since <ISO 8601> が必要です");
    return 1;
  }
  const w: CanaryWindow = {
    sinceMs: since,
    windowMs: Number(arg(argv, "--window-minutes") ?? 30) * 60_000,
    baselineMs: Number(arg(argv, "--baseline-hours") ?? 24) * 3_600_000,
  };
  const token = process.env["CLOUDFLARE_API_TOKEN"];
  const account = process.env["CLOUDFLARE_ACCOUNT_ID"];
  if (!token || !account) {
    console.error("canary: CLOUDFLARE_API_TOKEN と CLOUDFLARE_ACCOUNT_ID が必要です");
    return 1;
  }
  try {
    const result = await runCanary(cloudflareFetcher(account, token), w);
    console.log(`canary: ${result.decision} — ${result.reason}`);
    const out = process.env["GITHUB_OUTPUT"];
    if (out) appendFileSync(out, `decision=${result.decision}\nreason=${result.reason}\n`);
    return 0;
  } catch (e) {
    console.error(`canary: 判定に失敗しました: ${(e as Error).message}`);
    return 1;
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  process.exitCode = await main();
}
