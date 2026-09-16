/**
 * `npm run metrics:pull` — Analytics Engine から指標を取得して `kaizen/metrics/<date>.json` を書く
 * (docs/04 §6〜§7、docs/05 §4.1)。
 *
 *   npm run metrics:pull -- [--days 14] [--out kaizen/metrics] [--date YYYY-MM-DD]
 *                           [--experiments src/config/experiments.json] [--dry-run]
 *
 * - 集計日(既定: 今日 UTC)の 00:00 UTC までを集計する(当日分は含まない)。
 * - 稼働中の実験があれば `<date>-installs.json`(install 単位の行)も書く。
 * - `GITHUB_OUTPUT` があれば `date=<YYYY-MM-DD>` を書く。
 * - 認証情報が無い / API が失敗した / 最長の窓で session が 0 件 → メッセージを出して exit 1
 *   (kaizen-daily はここで止まり、Claude を起動しない)。
 * - `--dry-run` は発行する SQL を表示するだけ(認証不要)。
 */
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { DEFAULT_EXPERIMENTS_PATH, loadExperiments } from "../src/config/load";
import { runningExperiment } from "../src/config/resolve";
import { utcDateString } from "../src/core/daily";
import { MS_PER_DAY } from "./metrics/aggregate";
import { buildReport, dayStartMs, experimentSinceMs } from "./metrics/report";
import { cloudflareFetcher, pullRaw, type SqlFetcher } from "./metrics/runner";

export interface PullOptions {
  days: number;
  out: string;
  date: string;
  experimentsPath: string;
  dryRun: boolean;
}

export function parseArgs(argv: readonly string[], nowMs: number): PullOptions {
  const opts: PullOptions = {
    days: 14,
    out: "kaizen/metrics",
    date: utcDateString(nowMs),
    experimentsPath: DEFAULT_EXPERIMENTS_PATH,
    dryRun: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = (): string => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${arg} に値がありません`);
      return v;
    };
    if (arg === "--days") opts.days = Number(value());
    else if (arg === "--out") opts.out = value();
    else if (arg === "--date") opts.date = value();
    else if (arg === "--experiments") opts.experimentsPath = value();
    else if (arg === "--dry-run") opts.dryRun = true;
    else throw new Error(`不明な引数: ${arg}`);
  }
  if (!Number.isInteger(opts.days) || opts.days < 7 || opts.days > 90) {
    throw new Error("--days は 7〜90 の整数");
  }
  dayStartMs(opts.date); // 形式チェック
  return opts;
}

export interface PullResult {
  code: number;
  message: string;
  written: string[];
}

/** 本体。fetcher と時刻を差し替えられるので、単体テストで端から端まで動かせる。 */
export async function runPull(
  opts: PullOptions,
  fetcher: SqlFetcher,
  nowMs: number,
): Promise<PullResult> {
  const experiments = loadExperiments(opts.experimentsPath);
  const exp = runningExperiment(experiments);
  const toMs = dayStartMs(opts.date);
  const windowFrom = toMs - opts.days * MS_PER_DAY;
  const fromMs = exp === null ? windowFrom : Math.min(windowFrom, experimentSinceMs(exp));

  const raw = await pullRaw(fetcher, { fromMs, toMs, recentFromMs: toMs - MS_PER_DAY });
  const { report, installs } = buildReport(raw, {
    date: opts.date,
    days: opts.days,
    nowMs,
    experiment: exp,
  });

  const longest = report.overall[`d${opts.days}`];
  if (longest === undefined || longest.sessions <= 0) {
    return {
      code: 1,
      message: `直近 ${opts.days} 日の session が 0 件です(${opts.date} 集計)。テレメトリが届いていない可能性があります。`,
      written: [],
    };
  }

  const out = resolve(opts.out);
  mkdirSync(out, { recursive: true });
  const written: string[] = [];
  const write = (name: string, value: unknown): void => {
    const path = join(out, name);
    writeFileSync(path, JSON.stringify(value, null, 2) + "\n", "utf8");
    written.push(path);
  };
  write(`${opts.date}.json`, report);
  if (installs !== null) write(`${opts.date}-installs.json`, installs);

  const d1 = report.overall["d1"];
  return {
    code: 0,
    message: `metrics OK: ${opts.date} sessions(d${opts.days})=${longest.sessions} games(d1)=${d1?.games ?? 0} experiment=${report.experiment?.id ?? "none"}`,
    written,
  };
}

async function main(): Promise<number> {
  const nowMs = Date.now();
  let opts: PullOptions;
  try {
    opts = parseArgs(process.argv.slice(2), nowMs);
  } catch (e) {
    console.error(`metrics:pull: ${(e as Error).message}`);
    return 1;
  }

  if (opts.dryRun) {
    const printing: SqlFetcher = async (sql) => {
      console.log(`${sql}\n;\n`);
      return "";
    };
    const toMs = dayStartMs(opts.date);
    await pullRaw(printing, {
      fromMs: toMs - opts.days * MS_PER_DAY,
      toMs,
      recentFromMs: toMs - MS_PER_DAY,
    });
    return 0;
  }

  const token = process.env["CLOUDFLARE_API_TOKEN"];
  const accountId = process.env["CLOUDFLARE_ACCOUNT_ID"];
  if (token === undefined || token === "" || accountId === undefined || accountId === "") {
    console.error(
      "metrics:pull: CLOUDFLARE_API_TOKEN と CLOUDFLARE_ACCOUNT_ID が必要です(Account Analytics: Read 権限)。",
    );
    return 1;
  }

  try {
    const result = await runPull(opts, cloudflareFetcher(accountId, token), nowMs);
    (result.code === 0 ? console.log : console.error)(`metrics:pull: ${result.message}`);
    for (const path of result.written) console.log(`  wrote ${path}`);
    const ghOutput = process.env["GITHUB_OUTPUT"];
    if (result.code === 0 && ghOutput !== undefined && ghOutput !== "") {
      appendFileSync(ghOutput, `date=${opts.date}\n`);
    }
    return result.code;
  } catch (e) {
    console.error(`metrics:pull: 取得に失敗しました: ${(e as Error).message}`);
    return 1;
  }
}

// テストから import されたときは実行しない。
if (process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  process.exitCode = await main();
}
