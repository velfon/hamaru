/**
 * テレメトリクライアント(M3 ではメモリ内キューのみ)。
 *
 * docs/02 §6 が定める送信(sendBeacon / バッチ / 再送)は **M4** で実装する。
 * M3 の責務は「docs/04 §3 のイベントを正しい瞬間に、共通フィールド付きで積むこと」だけ。
 * そのため UI からは `track()` だけを呼び、輸送層の差し替えが UI に波及しないようにする。
 */
import type { CommonFields, EventFields, TelemetryEvent } from "./events";

/** キューの上限(docs/02 §6 の「最大 200 件、古いものから破棄」に合わせる)。 */
export const MAX_QUEUE = 200;

export type Context = Omit<CommonFields, "event" | "ts">;

const queue: TelemetryEvent[] = [];

let context: Context | null = null;
let globalPrivacyControl = false;

export function initTelemetry(ctx: Context, gpc = false): void {
  context = ctx;
  globalPrivacyControl = gpc;
}

/** 言語やモードなど、途中で変わる共通フィールドを更新する。 */
export function updateContext(patch: Partial<Context>): void {
  if (context === null) return;
  context = { ...context, ...patch };
}

export function getContext(): Context | null {
  return context;
}

/**
 * イベントを積む。
 * Global Privacy Control が有効なブラウザでは**何も積まない**(docs/02 §6)。
 */
export function track(fields: EventFields, now: number = Date.now()): void {
  if (globalPrivacyControl) return;
  if (context === null) return;
  const event: TelemetryEvent = { ...context, ...fields, ts: now };
  queue.push(event);
  while (queue.length > MAX_QUEUE) queue.shift();
}

/** 現在のキュー(M4 の送信と、E2E の検証で読む)。 */
export function getQueue(): readonly TelemetryEvent[] {
  return queue;
}

/** キューを空にして中身を返す(M4 の送信処理が使う)。 */
export function drainQueue(): TelemetryEvent[] {
  return queue.splice(0, queue.length);
}

/** UA からの粗い platform 判定(docs/04 §2)。 */
export function detectPlatform(ua: string): CommonFields["platform"] {
  if (/iPhone|iPad|iPod/i.test(ua)) return "ios";
  if (/Android/i.test(ua)) return "android";
  if (/Windows|Macintosh|X11|Linux/i.test(ua)) return "desktop";
  return "other";
}
