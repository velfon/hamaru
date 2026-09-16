/**
 * Analytics Engine SQL API への問い合わせ(docs/04 §6)。
 *
 * `SqlFetcher` を差し替えられるようにしてあり、単体テストは固定の応答で行う。
 * 本物の API は `POST https://api.cloudflare.com/client/v4/accounts/<id>/analytics_engine/sql`、
 * 本文に SQL、`Authorization: Bearer <token>`(Account Analytics: Read)。
 */
import {
  durationHistSql,
  firstSeenSql,
  latestVersionSql,
  paged,
  PAGE_SIZE,
  parseRows,
  scoreHistSql,
  sessionRowsSql,
  str,
  topErrorsSql,
  vitalsHistSql,
  num,
  type Range,
  type Row,
} from "./sql";
import {
  MS_PER_DAY,
  toErrorRow,
  toHistRow,
  toSessionRow,
  toVitalRow,
  type RawData,
} from "./aggregate";

export type SqlFetcher = (sql: string) => Promise<string>;

/** AE の保持期間(3 ヶ月)。installs_new の「初回」判定はここまで遡る。 */
export const LOOKBACK_DAYS = 90;

/** 1 クエリあたりの最大ページ数(暴走防止。10,000 行 × 50 = 50 万行)。 */
export const MAX_PAGES = 50;

export class SqlApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export function cloudflareFetcher(
  accountId: string,
  token: string,
  fetchImpl: typeof fetch = fetch,
): SqlFetcher {
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/analytics_engine/sql`;
  return async (sql) => {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "content-type": "text/plain" },
      body: sql,
    });
    const text = await res.text();
    if (!res.ok) {
      throw new SqlApiError(
        `Analytics Engine SQL API が ${res.status} を返しました: ${text.slice(0, 500)}`,
        res.status,
      );
    }
    return text;
  };
}

/** ORDER BY / LIMIT / OFFSET を付けて全ページを取得する。 */
export async function queryPaged(
  fetcher: SqlFetcher,
  sql: string,
  orderBy: string,
): Promise<Row[]> {
  const all: Row[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const rows = parseRows(await fetcher(paged(sql, orderBy, page)));
    all.push(...rows);
    if (rows.length < PAGE_SIZE) return all;
  }
  throw new Error(`行数が上限(${MAX_PAGES * PAGE_SIZE})を超えました。期間を短くしてください`);
}

export interface PullRange {
  /** 取得の開始(最長の窓の始まり、または実験開始日のうち早い方)。 */
  fromMs: number;
  /** 集計日の 00:00 UTC。 */
  toMs: number;
  /** 直近 1 日(topErrors の nRecent)。 */
  recentFromMs: number;
}

export async function pullRaw(fetcher: SqlFetcher, range: PullRange): Promise<RawData> {
  const r: Range = { fromMs: range.fromMs, toMs: range.toMs };
  const lookback: Range = { fromMs: range.toMs - LOOKBACK_DAYS * MS_PER_DAY, toMs: range.toMs };

  const sessions = await queryPaged(
    fetcher,
    sessionRowsSql(r),
    "install, session, day, platform, lang, exp, variant",
  );
  const firstSeen = await queryPaged(fetcher, firstSeenSql(lookback, range.fromMs), "install");
  const durations = await queryPaged(
    fetcher,
    durationHistSql(r),
    "day, platform, lang, exp, variant, bucket",
  );
  const scores = await queryPaged(
    fetcher,
    scoreHistSql(r),
    "day, platform, lang, exp, variant, bucket",
  );
  const vitals = await queryPaged(fetcher, vitalsHistSql(r), "day, platform, lang, name, bucket");
  const errors = parseRows(await fetcher(topErrorsSql(r, range.recentFromMs)));
  const latest = parseRows(
    await fetcher(latestVersionSql({ fromMs: range.recentFromMs, toMs: range.toMs })),
  );

  return {
    sessions: sessions.map(toSessionRow),
    firstSeen: new Map(firstSeen.map((row) => [str(row["install"]), num(row["first_ts"]) * 1000])),
    durations: durations.map(toHistRow),
    scores: scores.map(toHistRow),
    vitals: vitals.map(toVitalRow),
    errors: errors.map(toErrorRow),
    version: str(latest[0]?.["version"]),
  };
}
