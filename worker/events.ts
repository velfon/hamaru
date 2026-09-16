/**
 * `/api/events`: 検証 → Analytics Engine への書き込み(docs/02 §7、docs/04 §4)。
 *
 * blob / double の位置は docs/04 §4 の表で固定されている。**変更は追記のみ**。
 * 未使用の位置は `""` / `0` で埋める(AE は順序付き配列なので詰めてはいけない)。
 *
 * 実行環境依存(`request.cf` / `Env`)は `worker/index.ts` 側に閉じ込め、
 * ここは Request / Response と「writeDataPoint を持つ何か」だけに依存する。
 * そのおかげで Node の vitest からそのまま呼べる(docs/04 §9 のゴールデン比較)。
 */
import { MAX_BODY_BYTES, MAX_EVENTS, parseBatch, type WorkerEvent } from "./schema";

/** AE の 1 データポイント。`AnalyticsEngineDataset.writeDataPoint` と構造的に一致する。 */
export interface DataPoint {
  indexes: string[];
  blobs: string[];
  doubles: number[];
}

export interface EventsEnv {
  EVENTS: { writeDataPoint(point: DataPoint): void };
}

/** イベント固有の文字列 1(docs/04 §4 の blob10)。 */
function blob10(e: WorkerEvent): string {
  switch (e.event) {
    case "session_start":
      return e.ref;
    case "game_end":
      return e.reason;
    case "share":
      return e.method;
    case "error":
      return e.message;
    case "vital":
      return e.name;
    default:
      return "";
  }
}

/** イベント固有の文字列 2(docs/04 §4 の blob11)。 */
function blob11(e: WorkerEvent): string {
  return e.event === "error" ? e.stackHash : "";
}

/**
 * イベント固有の文字列 3(blob12)。
 * docs/04 §4 の表は blob11 に `stackHash` / `kind` の両方を割り当てているが、
 * `error` は**両方を同時に持つ**ので 1 列では足りない。表の既存位置は動かさず、
 * 「追記のみ」の原則(docs/04 §1-4)に従って blob12 を足した(docs/04 §10 N-1)。
 */
function blob12(e: WorkerEvent): string {
  return e.event === "error" ? e.kind : "";
}

function num(e: WorkerEvent, key: string): number {
  const v = (e as unknown as Record<string, unknown>)[key];
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/** 1 イベント → 1 データポイント(docs/04 §4 の表そのまま)。 */
export function toDataPoint(e: WorkerEvent, country: string): DataPoint {
  return {
    indexes: [e.installId],
    blobs: [
      e.event, // blob1
      e.sessionId, // blob2
      e.version, // blob3
      e.lang, // blob4
      e.platform, // blob5
      country, // blob6
      e.exp, // blob7
      e.variant, // blob8
      e.mode, // blob9
      blob10(e), // blob10
      blob11(e), // blob11
      blob12(e), // blob12
    ],
    doubles: [
      num(e, "score"), // double1
      num(e, "lines"), // double2
      num(e, "moves"), // double3
      num(e, "durationMs"), // double4
      num(e, "round"), // double5
      num(e, "longestStreak"), // double6
      num(e, "isPractice"), // double7
      num(e, "resumed"), // double8
      num(e, "fillRatioAtEnd"), // double9
      num(e, "dailyNo"), // double10
      num(e, "value"), // double11
      e.ts, // double12
    ],
  };
}

function problem(status: number, message: string): Response {
  return new Response(JSON.stringify({ ok: false, error: message }), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "x-content-type-options": "nosniff",
    },
  });
}

/** 同一オリジンからの POST か(docs/02 §7 / §10「API は同一オリジンのみ」)。 */
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (origin === null) return false;
  return origin === new URL(request.url).origin;
}

/**
 * `/api/events` の本体。成功は 204(本文なし)。
 *
 * - `Origin` が自ホストでなければ 403
 * - 本文 16 KB 超は 413
 * - JSON でない / スキーマ違反 / 21 件以上は 400
 */
export async function handleEvents(
  request: Request,
  env: EventsEnv,
  country: string,
): Promise<Response> {
  if (request.method !== "POST") return problem(405, "POST only");
  if (!isSameOrigin(request)) return problem(403, "forbidden origin");

  const declared = request.headers.get("content-length");
  if (declared !== null && Number(declared) > MAX_BODY_BYTES) {
    return problem(413, `body too large (max ${MAX_BODY_BYTES} bytes)`);
  }

  const text = await request.text();
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) {
    return problem(413, `body too large (max ${MAX_BODY_BYTES} bytes)`);
  }

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return problem(400, "invalid JSON");
  }

  const parsed = parseBatch(json);
  if (!parsed.ok) return problem(400, `invalid batch (max ${MAX_EVENTS} events): ${parsed.error}`);

  for (const event of parsed.batch.events) {
    env.EVENTS.writeDataPoint(toDataPoint(event, country));
  }

  return new Response(null, {
    status: 204,
    headers: { "x-content-type-options": "nosniff" },
  });
}
