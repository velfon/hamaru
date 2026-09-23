/**
 * ランキング API(docs/08 §2〜§6)。
 *
 *   POST /api/daily/submit      手の列を再生して得点を確定し、D1 に記録する
 *   GET  /api/leaderboard       上位 50(daily / week / month / all)
 *   POST /api/leaderboard/me    自分の順位
 *   POST /api/profile           ニックネームの設定・解除
 *   POST /api/profile/delete    自分のランキングデータをすべて削除
 *
 * D1 には最小限のインターフェース(`Db`)だけで触れる。本物の D1Database はこれを満たすので、
 * Node のテストから wrangler の `getPlatformProxy` で本物の(ローカルの)D1 を渡して SQL ごと検証できる。
 */
import { DEFAULT_CONFIG, DEFAULT_EXPERIMENTS, resolveConfig } from "../src/config";
import { dailySeed, isoWeekKey, monthKey, parseUtcDate, utcDateString } from "../src/core/daily";
import { autoName, type AutoName } from "../src/core/names";
import { replay, type Move } from "../src/core/replay";
import { isSameOrigin } from "./events";
import { normalizeNickname } from "./nickname";
import {
  deleteSchema,
  meSchema,
  PERIODS,
  profileSchema,
  submitSchema,
  type Period,
} from "./schema";

/* ------------------------------------------------------------------ */
/* D1 の最小インターフェース                                             */
/* ------------------------------------------------------------------ */

export interface DbStatement {
  bind(...values: unknown[]): DbStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<{ meta: { changes: number } }>;
}

export interface Db {
  prepare(query: string): DbStatement;
  batch(statements: DbStatement[]): Promise<Array<{ meta: { changes: number } }>>;
}

export interface LeaderboardEnv {
  DB: Db;
  /** "off" なら書き込まない(PR プレビュー。docs/08 §6)。 */
  LEADERBOARD?: string;
}

/** 本文の上限(2000 手 × 約 8 バイト + 余白)。 */
export const MAX_SUBMIT_BYTES = 32 * 1024;
export const TOP_N = 50;
export const NICKNAME_COOLDOWN_MS = 60_000;
const DAY = 86_400_000;

/* ------------------------------------------------------------------ */
/* 共通                                                                 */
/* ------------------------------------------------------------------ */

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "x-content-type-options": "nosniff",
      "cache-control": "no-store",
      ...headers,
    },
  });
}

const problem = (status: number, error: string, extra: Record<string, unknown> = {}) =>
  json({ error, ...extra }, status);

export async function sha256Hex(s: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * POST の共通前処理: Origin 検査 → 本文の大きさ → JSON。
 * 大きさは **読む前に** Content-Length で弾く(巨大な本文をメモリに載せない。docs/02 §10)。
 */
async function readJson(request: Request, maxBytes: number): Promise<unknown | Response> {
  if (request.method !== "POST") return problem(405, "method");
  if (!isSameOrigin(request)) return problem(403, "origin");
  const declared = request.headers.get("content-length");
  if (declared !== null && Number(declared) > maxBytes) return problem(413, "too_large");
  const text = await request.text();
  if (new TextEncoder().encode(text).length > maxBytes) return problem(413, "too_large");
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return problem(400, "json");
  }
}

export type NameJson = { nickname: string } | { auto: AutoName };

export function nameFor(player: string, nickname: string | null | undefined): NameJson {
  if (typeof nickname === "string" && nickname !== "") return { nickname };
  return { auto: autoName(player) ?? [0, 0, 0] };
}

/** 期間のキー(docs/08 §4)。daily は日付そのもの。 */
export function periodKey(period: Period, date: string): string | null {
  switch (period) {
    case "daily":
      return parseUtcDate(date) === null ? null : date;
    case "week":
      return isoWeekKey(date);
    case "month":
      return monthKey(date);
    case "all":
      return "all";
  }
}

const KEY_FORMAT: Record<Period, RegExp> = {
  daily: /^\d{4}-\d{2}-\d{2}$/,
  week: /^\d{4}-W\d{2}$/,
  month: /^\d{4}-\d{2}$/,
  all: /^all$/,
};

/* ------------------------------------------------------------------ */
/* 順位                                                                 */
/* ------------------------------------------------------------------ */

export interface RankJson {
  rank: number | null;
  /** デイリーはその日のベスト、週・月・全期間は合計。 */
  score: number | null;
  count: number;
  /** 週・月・全期間のみ: 記録のある日数。 */
  days?: number;
  /** デイリーのみ: その日の挑戦回数。 */
  attempts?: number;
}

const DAILY_RANK_SQL = `
SELECT d.score AS score,
  (SELECT COUNT(*) FROM daily_scores o
    WHERE o.date = d.date AND (o.score > d.score OR (o.score = d.score AND o.submitted_at < d.submitted_at))) + 1 AS rank,
  d.attempts AS attempts
FROM daily_scores d WHERE d.date = ?1 AND d.player = ?2`;

const DAILY_COUNT_SQL = `SELECT COUNT(*) AS n FROM daily_scores WHERE date = ?1`;

const TOTAL_RANK_SQL = `
SELECT t.total AS score, t.days AS days,
  (SELECT COUNT(*) FROM totals o
    WHERE o.period = t.period AND o.key = t.key
      AND (o.total > t.total OR (o.total = t.total AND o.updated_at < t.updated_at))) + 1 AS rank
FROM totals t WHERE t.period = ?1 AND t.key = ?2 AND t.player = ?3`;

const TOTAL_COUNT_SQL = `SELECT COUNT(*) AS n FROM totals WHERE period = ?1 AND key = ?2`;

export async function rankOf(
  db: Db,
  player: string,
  period: Period,
  key: string,
): Promise<RankJson> {
  if (period === "daily") {
    const [row, count] = await Promise.all([
      db
        .prepare(DAILY_RANK_SQL)
        .bind(key, player)
        .first<{ score: number; rank: number; attempts: number }>(),
      db.prepare(DAILY_COUNT_SQL).bind(key).first<{ n: number }>(),
    ]);
    return {
      rank: row?.rank ?? null,
      score: row?.score ?? null,
      count: count?.n ?? 0,
      ...(row ? { attempts: row.attempts } : {}),
    };
  }
  const [row, count] = await Promise.all([
    db
      .prepare(TOTAL_RANK_SQL)
      .bind(period, key, player)
      .first<{ score: number; rank: number; days: number }>(),
    db.prepare(TOTAL_COUNT_SQL).bind(period, key).first<{ n: number }>(),
  ]);
  return {
    rank: row?.rank ?? null,
    score: row?.score ?? null,
    count: count?.n ?? 0,
    ...(row ? { days: row.days } : {}),
  };
}

async function ranksFor(db: Db, player: string, date: string): Promise<Record<Period, RankJson>> {
  const entries = await Promise.all(
    PERIODS.map(
      async (p) => [p, await rankOf(db, player, p, periodKey(p, date) as string)] as const,
    ),
  );
  return Object.fromEntries(entries) as Record<Period, RankJson>;
}

/* ------------------------------------------------------------------ */
/* POST /api/daily/submit                                              */
/* ------------------------------------------------------------------ */

/** 1 日に受け付ける送信の上限(再生の CPU と書き込みを守る。docs/08 §2)。 */
export const MAX_ATTEMPTS_PER_DAY = 50;

export async function handleSubmit(
  request: Request,
  env: LeaderboardEnv,
  now: number = Date.now(),
): Promise<Response> {
  const body = await readJson(request, MAX_SUBMIT_BYTES);
  if (body instanceof Response) return body;
  const parsed = submitSchema.safeParse(body);
  if (!parsed.success) return problem(400, "invalid");
  const { installId, date, moves } = parsed.data;

  // 今日か昨日(UTC)だけ。日付をまたいで遊んだ人のための 1 日の猶予(docs/08 §2)。
  const today = utcDateString(now);
  const yesterday = utcDateString(now - DAY);
  if (date !== today && date !== yesterday) return problem(400, "date");

  const player = await sha256Hex(installId);

  // 再生(最大 2000 手)は CPU を使う。その日の上限に達していないかを**先に**見る
  // (上限に達した相手に再生をやらせない。docs/02 §10)。
  const previous =
    env.LEADERBOARD === "off"
      ? null
      : await env.DB.prepare(
          `SELECT score, attempts FROM daily_scores WHERE date = ?1 AND player = ?2`,
        )
          .bind(date, player)
          .first<{ score: number; attempts: number }>();
  if (previous !== null && previous.attempts >= MAX_ATTEMPTS_PER_DAY) {
    return problem(429, "too_many_attempts", { best: previous.score, attempts: previous.attempts });
  }

  const config = resolveConfig(DEFAULT_CONFIG, DEFAULT_EXPERIMENTS, installId, "daily");
  const result = replay(config, "daily", dailySeed(date), moves as Move[]);
  if (!result.ok) return problem(422, result.error, { at: result.at });
  const { state } = result;
  if (state.status !== "over") return problem(400, "not_finished");

  if (env.LEADERBOARD === "off") {
    return json({
      accepted: false,
      preview: true,
      improved: true,
      score: state.score,
      best: state.score,
      attempts: 1,
      lines: state.linesCleared,
      ranks: null,
    });
  }

  // 何度でも挑戦できる。送信のたびに attempts を数え、**より高い時だけ**記録を差し替える。
  // 合計(totals)は「今回の得点 − それまでのその日のベスト」だけ足す(docs/08 §2)。
  const submissionId = crypto.randomUUID();
  const periods = ["week", "month", "all"] as const;
  // 1. その日の初めての記録なら、合計に丸ごと足して日数を 1 増やす
  const firstOfDay = periods.map((period) =>
    env.DB.prepare(
      `INSERT INTO totals (period, key, player, total, days, updated_at)
       SELECT ?1, ?2, ?3, ?4, 1, ?5
       WHERE NOT EXISTS (SELECT 1 FROM daily_scores WHERE date = ?6 AND player = ?3)
       ON CONFLICT (period, key, player)
       DO UPDATE SET total = total + excluded.total, days = days + 1, updated_at = excluded.updated_at`,
    ).bind(period, periodKey(period, date), player, state.score, now, date),
  );
  // 2. すでに記録があって今回の方が高いなら、差分だけ足す(日数は増やさない)
  const improvement = periods.map((period) =>
    env.DB.prepare(
      `UPDATE totals
       SET total = total + ?4 - (SELECT score FROM daily_scores WHERE date = ?6 AND player = ?3),
           updated_at = ?5
       WHERE period = ?1 AND key = ?2 AND player = ?3
         AND EXISTS (SELECT 1 FROM daily_scores WHERE date = ?6 AND player = ?3 AND score < ?4)`,
    ).bind(period, periodKey(period, date), player, state.score, now, date),
  );
  // 3. その日の記録を更新する。**1・2 のあとに実行する**(上の SQL は更新前の値を読む)
  const upsert = env.DB.prepare(
    `INSERT INTO daily_scores (date, player, score, lines, moves, submission_id, submitted_at, attempts)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 1)
     ON CONFLICT (date, player) DO UPDATE SET
       attempts = daily_scores.attempts + 1,
       score = MAX(daily_scores.score, excluded.score),
       lines = CASE WHEN excluded.score > daily_scores.score THEN excluded.lines ELSE daily_scores.lines END,
       moves = CASE WHEN excluded.score > daily_scores.score THEN excluded.moves ELSE daily_scores.moves END,
       submission_id = CASE WHEN excluded.score > daily_scores.score THEN excluded.submission_id ELSE daily_scores.submission_id END,
       submitted_at = CASE WHEN excluded.score > daily_scores.score THEN excluded.submitted_at ELSE daily_scores.submitted_at END`,
  ).bind(date, player, state.score, state.linesCleared, state.moves, submissionId, now);

  await env.DB.batch([
    ...firstOfDay,
    ...improvement,
    upsert,
    env.DB.prepare(
      `INSERT INTO players (player, nickname, nickname_at, created_at) VALUES (?1, NULL, NULL, ?2)
       ON CONFLICT (player) DO NOTHING`,
    ).bind(player, now),
  ]);

  const improved = previous === null || state.score > previous.score;
  const ranks = await ranksFor(env.DB, player, date);
  return json({
    accepted: true,
    improved,
    score: state.score,
    best: improved ? state.score : previous.score,
    attempts: (previous?.attempts ?? 0) + 1,
    lines: state.linesCleared,
    ranks,
  });
}

/* ------------------------------------------------------------------ */
/* GET /api/leaderboard                                                */
/* ------------------------------------------------------------------ */

interface TopRow {
  player: string;
  score: number;
  days?: number;
  /** デイリーのみ: その日の挑戦回数(docs/08 §1)。 */
  attempts?: number;
  nickname: string | null;
}

export async function handleTop(
  request: Request,
  env: LeaderboardEnv,
  now: number = Date.now(),
): Promise<Response> {
  if (request.method !== "GET") return problem(405, "method");
  const url = new URL(request.url);
  const period = url.searchParams.get("period") ?? "daily";
  if (!(PERIODS as readonly string[]).includes(period)) return problem(400, "period");
  const p = period as Period;
  const key = url.searchParams.get("key") ?? (periodKey(p, utcDateString(now)) as string);
  if (!KEY_FORMAT[p].test(key)) return problem(400, "key");

  let rows: TopRow[];
  let count: number;
  if (p === "daily") {
    const [top, c] = await Promise.all([
      env.DB.prepare(
        `SELECT d.player AS player, d.score AS score, d.attempts AS attempts, p.nickname AS nickname
         FROM daily_scores d LEFT JOIN players p ON p.player = d.player
         WHERE d.date = ?1 ORDER BY d.score DESC, d.submitted_at ASC LIMIT ${TOP_N}`,
      )
        .bind(key)
        .all<TopRow>(),
      env.DB.prepare(DAILY_COUNT_SQL).bind(key).first<{ n: number }>(),
    ]);
    rows = top.results;
    count = c?.n ?? 0;
  } else {
    const [top, c] = await Promise.all([
      env.DB.prepare(
        `SELECT t.player AS player, t.total AS score, t.days AS days, p.nickname AS nickname
         FROM totals t LEFT JOIN players p ON p.player = t.player
         WHERE t.period = ?1 AND t.key = ?2 ORDER BY t.total DESC, t.updated_at ASC LIMIT ${TOP_N}`,
      )
        .bind(p, key)
        .all<TopRow>(),
      env.DB.prepare(TOTAL_COUNT_SQL).bind(p, key).first<{ n: number }>(),
    ]);
    rows = top.results;
    count = c?.n ?? 0;
  }

  return json(
    {
      period: p,
      key,
      count,
      top: rows.map((r, i) => ({
        rank: i + 1,
        name: nameFor(r.player, r.nickname),
        score: r.score,
        ...(r.days !== undefined ? { days: r.days } : {}),
        ...(r.attempts !== undefined ? { attempts: r.attempts } : {}),
      })),
    },
    200,
    { "cache-control": "public, max-age=30" },
  );
}

/* ------------------------------------------------------------------ */
/* POST /api/leaderboard/me                                            */
/* ------------------------------------------------------------------ */

async function playerName(db: Db, player: string): Promise<NameJson> {
  const row = await db
    .prepare(`SELECT nickname FROM players WHERE player = ?1`)
    .bind(player)
    .first<{ nickname: string | null }>();
  return nameFor(player, row?.nickname);
}

export async function handleMe(
  request: Request,
  env: LeaderboardEnv,
  now: number = Date.now(),
): Promise<Response> {
  const body = await readJson(request, 1024);
  if (body instanceof Response) return body;
  const parsed = meSchema.safeParse(body);
  if (!parsed.success) return problem(400, "invalid");
  const { installId, period } = parsed.data;
  const key = parsed.data.key ?? (periodKey(period, utcDateString(now)) as string);
  if (!KEY_FORMAT[period].test(key)) return problem(400, "key");
  const player = await sha256Hex(installId);
  const [rank, name] = await Promise.all([
    rankOf(env.DB, player, period, key),
    playerName(env.DB, player),
  ]);
  return json({ period, key, ...rank, name });
}

/* ------------------------------------------------------------------ */
/* POST /api/profile                                                   */
/* ------------------------------------------------------------------ */

export async function handleProfile(
  request: Request,
  env: LeaderboardEnv,
  now: number = Date.now(),
): Promise<Response> {
  const body = await readJson(request, 1024);
  if (body instanceof Response) return body;
  const parsed = profileSchema.safeParse(body);
  if (!parsed.success) return problem(400, "invalid");
  const { installId } = parsed.data;
  const player = await sha256Hex(installId);

  let nickname: string | null = null;
  if (parsed.data.nickname !== null) {
    const r = normalizeNickname(parsed.data.nickname);
    if (!r.ok) return problem(400, r.error);
    nickname = r.value;
  }
  if (env.LEADERBOARD === "off") return json({ preview: true, name: nameFor(player, nickname) });

  const row = await env.DB.prepare(`SELECT nickname_at FROM players WHERE player = ?1`)
    .bind(player)
    .first<{ nickname_at: number | null }>();
  if (row?.nickname_at != null && now - row.nickname_at < NICKNAME_COOLDOWN_MS) {
    return problem(429, "cooldown", {
      retryAfterMs: NICKNAME_COOLDOWN_MS - (now - row.nickname_at),
    });
  }
  await env.DB.prepare(
    `INSERT INTO players (player, nickname, nickname_at, created_at) VALUES (?1, ?2, ?3, ?3)
     ON CONFLICT (player) DO UPDATE SET nickname = excluded.nickname, nickname_at = excluded.nickname_at`,
  )
    .bind(player, nickname, now)
    .run();
  return json({ name: nameFor(player, nickname) });
}

/* ------------------------------------------------------------------ */
/* POST /api/profile/delete                                            */
/* ------------------------------------------------------------------ */

export async function handleDelete(request: Request, env: LeaderboardEnv): Promise<Response> {
  const body = await readJson(request, 1024);
  if (body instanceof Response) return body;
  const parsed = deleteSchema.safeParse(body);
  if (!parsed.success) return problem(400, "invalid");
  if (env.LEADERBOARD === "off") return new Response(null, { status: 204 });
  const player = await sha256Hex(parsed.data.installId);
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM daily_scores WHERE player = ?1`).bind(player),
    env.DB.prepare(`DELETE FROM totals WHERE player = ?1`).bind(player),
    env.DB.prepare(`DELETE FROM players WHERE player = ?1`).bind(player),
  ]);
  return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
}

/** `/api/...` のうちランキングの経路なら Response、それ以外は null。 */
export async function routeLeaderboard(
  request: Request,
  env: LeaderboardEnv,
): Promise<Response | null> {
  const { pathname } = new URL(request.url);
  switch (pathname) {
    case "/api/daily/submit":
      return handleSubmit(request, env);
    case "/api/leaderboard":
      return handleTop(request, env);
    case "/api/leaderboard/me":
      return handleMe(request, env);
    case "/api/profile":
      return handleProfile(request, env);
    case "/api/profile/delete":
      return handleDelete(request, env);
    default:
      return null;
  }
}
