/**
 * Analytics Engine SQL の組み立てと応答の解析(docs/04 §4〜§6)。
 *
 * 方言は Cloudflare の SQL リファレンス(2026-09 時点)で確認した範囲だけを使う(docs/04 §6、§10 N-3):
 * - 1 クエリ 1 テーブル。**JOIN / UNION / CTE は使えない** → 結合は TS 側(aggregate.ts)で行う
 * - 分位は `quantileExactWeighted(q)(col, w)` があるが、窓・内訳ごとにクエリが増えるので使わず、
 *   **重み付きヒストグラム**を取って TS 側で分位を求める
 * - 条件は小文字の `if()` / `countIf()` / `sumIf()`、丸めは `floor()`
 * - 日付は `toStartOfDay()` を `toUnixTimestamp()` で数値にして受け取る(応答の日時書式に依存しない)
 * - 出力は `FORMAT JSONEachRow`。数値が文字列で返っても読めるよう、解析側で数値化する
 */

export const DATASET = "hamaru_events";

/** ページングの 1 ページ行数。 */
export const PAGE_SIZE = 10_000;

/** ヒストグラムの刻み(中央値・p75 の精度はこの刻みの半分)。 */
export const BUCKET = {
  durationMs: 5_000,
  score: 50,
  lcpMs: 50,
  inpMs: 8,
  cls: 0.005,
} as const;

/**
 * 数値リテラルを浮動小数として書く(`8` → `8.0`)。
 * AE の `if()` は 2 つの分岐の型が一致しないと 422 になる(Double と Integer の混在。2026-09-17 に実データで確認)。
 */
export function float(n: number): string {
  return Number.isInteger(n) ? `${n}.0` : String(n);
}

/** epoch ms → `toDateTime('YYYY-MM-DD HH:MM:SS')`(UTC)。 */
export function dt(ms: number): string {
  const iso = new Date(ms).toISOString();
  return `toDateTime('${iso.slice(0, 10)} ${iso.slice(11, 19)}')`;
}

export interface Range {
  fromMs: number;
  toMs: number;
}

function between(r: Range): string {
  return `timestamp >= ${dt(r.fromMs)} AND timestamp < ${dt(r.toMs)}`;
}

const DAY = "toUnixTimestamp(toStartOfDay(timestamp))";

/**
 * セッション単位の行(docs/04 §5 の大半の指標の材料)。
 * 日付・platform・lang・実験で GROUP BY しているので、日をまたいだセッション等は複数行になる。
 * aggregate.ts が (install, session) で束ねる。ORDER BY / LIMIT / OFFSET は runner が付ける。
 */
export function sessionRowsSql(r: Range): string {
  return `SELECT
  index1 AS install,
  blob2 AS session,
  ${DAY} AS day,
  blob5 AS platform,
  blob4 AS lang,
  blob7 AS exp,
  blob8 AS variant,
  max(_sample_interval) AS w,
  countIf(blob1 = 'session_start') AS starts,
  countIf(blob1 = 'game_end' AND double7 = 0) AS games,
  countIf(blob1 = 'game_end' AND double7 = 0 AND blob10 = 'abandon') AS abandons,
  sumIf(double4, blob1 = 'game_end') AS game_ms,
  countIf(blob1 = 'error') AS errors,
  countIf(blob1 = 'game_start' AND blob9 = 'daily' AND double7 = 0) AS daily_starts,
  countIf(blob1 = 'daily_result') AS daily_results,
  countIf(blob1 = 'share') AS shares
FROM ${DATASET}
WHERE ${between(r)}
GROUP BY install, session, day, platform, lang, exp, variant`;
}

/**
 * 期間内が初回 session_start の install(installs_new / d1_return の材料)。
 * 「初回」は AE の保持期間いっぱい(90 日)を遡って判定する(docs/04 §5)。
 */
export function firstSeenSql(lookback: Range, windowFromMs: number): string {
  return `SELECT
  index1 AS install,
  min(toUnixTimestamp(timestamp)) AS first_ts
FROM ${DATASET}
WHERE blob1 = 'session_start' AND ${between(lookback)}
GROUP BY install
HAVING first_ts >= ${Math.floor(windowFromMs / 1000)}`;
}

/** 終了したゲーム(reason=over、練習除く)の所要時間ヒストグラム。 */
export function durationHistSql(r: Range): string {
  return `SELECT
  ${DAY} AS day,
  blob5 AS platform,
  blob4 AS lang,
  blob7 AS exp,
  blob8 AS variant,
  floor(double4 / ${BUCKET.durationMs}) AS bucket,
  sum(_sample_interval) AS n
FROM ${DATASET}
WHERE blob1 = 'game_end' AND double7 = 0 AND blob10 = 'over' AND ${between(r)}
GROUP BY day, platform, lang, exp, variant, bucket`;
}

/** 同じ条件のスコアヒストグラム。 */
export function scoreHistSql(r: Range): string {
  return `SELECT
  ${DAY} AS day,
  blob5 AS platform,
  blob4 AS lang,
  blob7 AS exp,
  blob8 AS variant,
  floor(double1 / ${BUCKET.score}) AS bucket,
  sum(_sample_interval) AS n
FROM ${DATASET}
WHERE blob1 = 'game_end' AND double7 = 0 AND blob10 = 'over' AND ${between(r)}
GROUP BY day, platform, lang, exp, variant, bucket`;
}

/** Web Vitals のヒストグラム(名前ごとに刻みが違う)。 */
export function vitalsHistSql(r: Range): string {
  return `SELECT
  ${DAY} AS day,
  blob5 AS platform,
  blob4 AS lang,
  blob10 AS name,
  floor(double11 / if(blob10 = 'CLS', ${float(BUCKET.cls)}, if(blob10 = 'INP', ${float(BUCKET.inpMs)}, ${float(BUCKET.lcpMs)}))) AS bucket,
  sum(_sample_interval) AS n
FROM ${DATASET}
WHERE blob1 = 'vital' AND ${between(r)}
GROUP BY day, platform, lang, name, bucket`;
}

/** エラーの上位(stackHash 単位)。`n_recent` は直近 1 日分。 */
export function topErrorsSql(r: Range, recentFromMs: number, limit = 20): string {
  return `SELECT
  blob11 AS stack_hash,
  argMin(blob10, timestamp) AS message,
  argMin(blob3, timestamp) AS first_version,
  sum(_sample_interval) AS n,
  sumIf(_sample_interval, timestamp >= ${dt(recentFromMs)}) AS n_recent
FROM ${DATASET}
WHERE blob1 = 'error' AND ${between(r)}
GROUP BY stack_hash
ORDER BY n DESC
LIMIT ${limit}
FORMAT JSONEachRow`;
}

/** 直近で最も新しいイベントのバージョン(= いま配信中のビルド)。 */
export function latestVersionSql(r: Range): string {
  return `SELECT argMax(blob3, timestamp) AS version, count() AS rows
FROM ${DATASET}
WHERE ${between(r)}
FORMAT JSONEachRow`;
}

/** ページング付きのクエリ本文。ORDER BY は全列で安定させる。 */
export function paged(sql: string, orderBy: string, page: number): string {
  return `${sql}
ORDER BY ${orderBy}
LIMIT ${PAGE_SIZE} OFFSET ${page * PAGE_SIZE}
FORMAT JSONEachRow`;
}

export type Row = Record<string, unknown>;

/**
 * 応答本文 → 行の配列。
 * JSONEachRow(1 行 1 JSON)を基本に、`{ data: [...] }` 形式(FORMAT JSON)も受け付ける。
 */
export function parseRows(text: string): Row[] {
  const body = text.trim();
  if (body === "") return [];
  if (body.startsWith("{") && !body.includes("\n")) {
    const one = JSON.parse(body) as unknown;
    if (isObject(one) && Array.isArray(one["data"])) return one["data"].filter(isObject);
    return isObject(one) ? [one] : [];
  }
  if (body.startsWith("{") && body.includes('"data"')) {
    try {
      const whole = JSON.parse(body) as unknown;
      if (isObject(whole) && Array.isArray(whole["data"])) return whole["data"].filter(isObject);
    } catch {
      /* JSONEachRow として読む */
    }
  }
  return body
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line) as unknown)
    .filter(isObject);
}

function isObject(v: unknown): v is Row {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** 数値化(ClickHouse 系は UInt64 を文字列で返すことがある)。数値でなければ 0。 */
export function num(v: unknown): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : 0;
}

export function str(v: unknown): string {
  return typeof v === "string" ? v : v === null || v === undefined ? "" : String(v);
}
