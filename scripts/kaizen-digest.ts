/**
 * `npm run kaizen:digest` — 週次レトロの草稿 `kaizen/retro/<ISO 週>.draft.md` を作る(docs/05 §7.2)。
 *
 *   npm run kaizen:digest -- [--date YYYY-MM-DD] [--metrics kaizen/metrics] [--changelog kaizen/CHANGELOG.md]
 *                            [--out kaizen/retro]
 *
 * 数字は決定的にここで作り、Claude(kaizen/prompts/weekly.md)は解釈と来週の狙いだけを書く。
 * - 指標表: 集計日の metrics(d7)と、7 日前の metrics(d7)を並べる。7 日前が無ければ「—」
 * - 今週の出荷: CHANGELOG の日付が直近 7 日の行
 * - 実験: 集計日の metrics の experiment と、あれば decision
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { isoWeekKey, parseUtcDate, utcDateString } from "../src/core/daily";
import type { Metrics } from "./metrics/aggregate";
import type { MetricsReport } from "./metrics/report";
import type { DecisionJson } from "./experiment/decide";

const DAY = 86_400_000;

/** ISO 8601 の週番号(例 2026-W42)。実装は core と共用(ランキングの週と同じ定義)。 */
export function isoWeek(date: string): string {
  const key = isoWeekKey(date);
  if (key === null) throw new Error(`日付が不正です: ${date}`);
  return key;
}

export const DIGEST_METRICS: ReadonlyArray<
  [key: keyof Metrics, label: string, kind: "count" | "ratio" | "number" | "ms"]
> = [
  ["games", "games(北極星)", "count"],
  ["sessions", "sessions", "count"],
  ["installs_new", "installs_new", "count"],
  ["games_per_session", "games_per_session", "number"],
  ["median_game_seconds", "median_game_seconds", "number"],
  ["abandon_rate", "abandon_rate", "ratio"],
  ["d1_return", "d1_return", "ratio"],
  ["daily_completion", "daily_completion", "ratio"],
  ["share_rate", "share_rate", "ratio"],
  ["crash_free", "crash_free", "ratio"],
  ["lcp_p75", "lcp_p75", "ms"],
];

function fmt(v: number | null | undefined, kind: "count" | "ratio" | "number" | "ms"): string {
  if (v === null || v === undefined) return "—";
  if (kind === "ratio") return `${(v * 100).toFixed(1)}%`;
  if (kind === "ms") return `${Math.round(v)} ms`;
  if (kind === "count") return new Intl.NumberFormat("en-US").format(Math.round(v));
  return v.toFixed(2);
}

function change(
  cur: number | null | undefined,
  prev: number | null | undefined,
  kind: string,
): string {
  if (cur === null || cur === undefined || prev === null || prev === undefined) return "—";
  if (kind === "ratio") return `${cur - prev >= 0 ? "+" : ""}${((cur - prev) * 100).toFixed(1)}pt`;
  if (prev === 0) return "—";
  const pct = ((cur - prev) / prev) * 100;
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`;
}

export interface DigestInput {
  date: string;
  current: MetricsReport | null;
  previous: MetricsReport | null;
  decision: DecisionJson | null;
  changelog: string;
}

export function buildDigest(input: DigestInput): string {
  const week = isoWeek(input.date);
  const cur = input.current?.overall["d7"];
  const prev = input.previous?.overall["d7"];
  const to = parseUtcDate(input.date) as number;
  const from = utcDateString(to - 7 * DAY);

  const lines: string[] = [
    `# Weekly digest ${week}(草稿)`,
    "",
    `集計: ${from} 〜 ${utcDateString(to - DAY)}(UTC)。数字は scripts/kaizen-digest.ts が作成。`,
    "",
    "## 指標(直近 7 日 vs 前の 7 日)",
    "",
    "| 指標 | 直近 7 日 | 前の 7 日 | 変化 |",
    "|---|---|---|---|",
  ];
  if (cur === undefined) {
    lines.push("| (集計日の metrics がありません) | — | — | — |");
  } else {
    for (const [key, label, kind] of DIGEST_METRICS) {
      lines.push(
        `| ${label} | ${fmt(cur[key], kind)} | ${fmt(prev?.[key], kind)} | ${change(cur[key], prev?.[key], kind)} |`,
      );
    }
  }

  lines.push("", "## 今週出荷したもの(kaizen/CHANGELOG.md)", "");
  const shipped = input.changelog
    .split("\n")
    .filter((l) => /^\d{4}-\d{2}-\d{2} \|/.test(l))
    .filter((l) => {
      const d = l.slice(0, 10);
      return d >= from && d < input.date;
    });
  lines.push(...(shipped.length > 0 ? shipped.map((l) => `- ${l}`) : ["- なし"]));

  lines.push("", "## 実験", "");
  const exp = input.current?.experiment;
  if (exp === null || exp === undefined) {
    lines.push("- 稼働中の実験はありません");
  } else {
    lines.push(
      `- ${exp.id}(${exp.days} 日目 / 最大 ${exp.maxDays} 日、主要指標 ${exp.primaryMetric})`,
    );
    for (const [variant, arm] of Object.entries(exp.arms)) {
      lines.push(
        `  - ${variant}: installs ${arm.installs}, games_per_session ${fmt(arm.games_per_session.mean, "number")}, crash_free ${fmt(arm.crash_free, "ratio")}`,
      );
    }
    if (input.decision !== null && input.decision.experiment === exp.id) {
      lines.push(`  - 判定: **${input.decision.decision}** — ${input.decision.reason}`);
    }
  }

  const errors = input.current?.topErrors.filter((e) => e.rising || e.isNew) ?? [];
  lines.push("", "## 注意(新規・増加中のエラー)", "");
  lines.push(
    ...(errors.length > 0
      ? errors.map(
          (e) =>
            `- \`${e.stackHash}\` ${e.message}(${e.n} 件、直近 1 日 ${e.nRecent}${e.isNew ? "、新規" : ""})`,
        )
      : ["- なし"]),
  );

  lines.push(
    "",
    "## 以下は weekly エージェントが書く",
    "",
    "- 効いた / 効かなかった / 不明(出荷したものごと)",
    "- 学んだこと(3 つ以内)",
    "- 来週の狙い(種類のローテーション)",
    "- 人間に判断を仰ぎたいこと",
    "",
  );
  return lines.join("\n");
}

function readJson<T>(path: string): T | null {
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as T) : null;
}

function main(argv: readonly string[]): number {
  const get = (name: string, fallback: string): string => {
    const i = argv.indexOf(name);
    return i >= 0 && argv[i + 1] !== undefined ? (argv[i + 1] as string) : fallback;
  };
  const date = get("--date", utcDateString(Date.now()));
  const metrics = resolve(get("--metrics", "kaizen/metrics"));
  const out = resolve(get("--out", "kaizen/retro"));
  const changelogPath = resolve(get("--changelog", "kaizen/CHANGELOG.md"));
  const to = parseUtcDate(date);
  if (to === null) {
    console.error(`kaizen:digest: 日付が不正です: ${date}`);
    return 1;
  }
  const text = buildDigest({
    date,
    current: readJson<MetricsReport>(join(metrics, `${date}.json`)),
    previous: readJson<MetricsReport>(join(metrics, `${utcDateString(to - 7 * DAY)}.json`)),
    decision: readJson<DecisionJson>(join(metrics, `${date}-decision.json`)),
    changelog: existsSync(changelogPath) ? readFileSync(changelogPath, "utf8") : "",
  });
  mkdirSync(out, { recursive: true });
  const path = join(out, `${isoWeek(date)}.draft.md`);
  writeFileSync(path, text, "utf8");
  console.log(`kaizen:digest: wrote ${path}`);
  const gh = process.env["GITHUB_OUTPUT"];
  if (gh) writeFileSync(gh, `week=${isoWeek(date)}\n`, { flag: "a" });
  return 0;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  process.exitCode = main(process.argv.slice(2));
}
