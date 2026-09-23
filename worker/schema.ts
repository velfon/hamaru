/**
 * `/api/events` が受け取るイベントの zod スキーマ(docs/02 §7、docs/04 §2〜§3)。
 *
 * ここは `src/telemetry/events.ts` の型と **1:1** で対応する。
 * ずれた瞬間に `tests/unit/telemetry-contract.test.ts` の型レベル検査が落ちる(docs/04 §9)。
 * 1 件でも不正なら 400 を返す(クライアントのバグを早期に露見させる)。
 */
import * as z from "zod";

/** docs/02 §7: 1 リクエスト 20 件まで。 */
export const MAX_EVENTS = 20;
/** docs/02 §7: 本文 16 KB まで(= AE の blob 合計上限と同じ数字)。 */
export const MAX_BODY_BYTES = 16 * 1024;

/** 文字列フィールドの上限。AE の blob 合計 16 KB を 1 件で使い切らせない。 */
const SHORT = 64;

/** docs/04 §2 の共通フィールド。 */
const common = {
  installId: z.uuid(),
  sessionId: z.string().min(1).max(SHORT),
  ts: z.number().int().nonnegative(),
  version: z.string().max(SHORT),
  lang: z.enum(["ja", "en"]),
  platform: z.enum(["ios", "android", "desktop", "other"]),
  exp: z.string().max(SHORT),
  variant: z.string().max(SHORT),
  mode: z.enum(["endless", "daily", "level", ""]),
};

const bit = z.union([z.literal(0), z.literal(1)]);
const count = z.number().nonnegative().finite();

export const eventSchema = z.discriminatedUnion("event", [
  z.strictObject({
    ...common,
    event: z.literal("session_start"),
    ref: z.enum(["direct", "share", "pwa", "other"]),
  }),
  z.strictObject({
    ...common,
    event: z.literal("game_start"),
    resumed: bit,
    isPractice: bit,
  }),
  z.strictObject({
    ...common,
    event: z.literal("game_end"),
    reason: z.enum(["over", "abandon", "clear"]),
    score: count,
    lines: count,
    moves: count,
    durationMs: count,
    round: count,
    longestStreak: count,
    isPractice: bit,
    fillRatioAtEnd: z.number().min(0).max(1),
  }),
  z.strictObject({
    ...common,
    event: z.literal("daily_result"),
    // epoch より前の日(公開前・端末時計が過去)は 0 以下になる(src/core/daily.ts)。
    // 弾くとバッチごと失われ daily_completion が欠けるので、整数なら受け取る(docs/04 §10 N-2)。
    dailyNo: z.number().int(),
    score: count,
    lines: count,
  }),
  z.strictObject({
    ...common,
    event: z.literal("share"),
    method: z.enum(["share", "copy"]),
  }),
  z.strictObject({
    ...common,
    event: z.literal("error"),
    message: z.string().max(200),
    stackHash: z.string().max(SHORT),
    kind: z.enum(["js", "promise", "config"]),
  }),
  z.strictObject({
    ...common,
    event: z.literal("vital"),
    name: z.enum(["LCP", "INP", "CLS"]),
    value: z.number().finite(),
  }),
]);

export type WorkerEvent = z.infer<typeof eventSchema>;

export const batchSchema = z.strictObject({
  events: z.array(eventSchema).min(1).max(MAX_EVENTS),
});

export type Batch = z.infer<typeof batchSchema>;

export function parseBatch(
  input: unknown,
): { ok: true; batch: Batch } | { ok: false; error: string } {
  const r = batchSchema.safeParse(input);
  return r.success ? { ok: true, batch: r.data } : { ok: false, error: z.prettifyError(r.error) };
}

/* ------------------------------------------------------------------ */
/* ランキング(docs/08 §6)                                              */
/* ------------------------------------------------------------------ */

export const PERIODS = ["daily", "week", "month", "all"] as const;
export type Period = (typeof PERIODS)[number];

/** 1 手 = [x, y](逆手は手持ちが 1 個)。盤は最大 12×12(config の上限)なので座標は 0〜11。 */
const move = z.tuple([z.number().int().min(0).max(11), z.number().int().min(0).max(11)]);

export const submitSchema = z.strictObject({
  installId: z.uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  moves: z.array(move).min(1).max(2000),
  version: z.string().max(SHORT),
});

export const meSchema = z.strictObject({
  installId: z.uuid(),
  period: z.enum(PERIODS),
  key: z.string().max(16).optional(),
});

export const profileSchema = z.strictObject({
  installId: z.uuid(),
  nickname: z.string().max(64).nullable(),
});

export const deleteSchema = z.strictObject({
  installId: z.uuid(),
});
