/**
 * テレメトリクライアント(docs/02 §6)。
 *
 * - `track()` で共通フィールドを付けてキューへ積む(UI が呼ぶのはこれだけ)。
 * - フラッシュ条件: `game_end` 直後 / `visibilitychange → hidden` / キュー 20 件 / 30 秒。
 * - 送信は `navigator.sendBeacon`。不可なら `fetch(..., { keepalive: true })`。
 * - 送信に失敗した分は localStorage に退避し、次回起動時に再送する(最大 200 件、古い順に破棄)。
 * - `navigator.globalPrivacyControl === true` なら**何も積まず・何も送らない**。
 */
import { KEYS, readKey, remove as removeKey, writeKey } from "../storage/local";
import type { CommonFields, EventFields, TelemetryEvent } from "./events";

/** キューの上限(docs/02 §6 の「最大 200 件、古いものから破棄」)。 */
export const MAX_QUEUE = 200;
/** 1 リクエストの最大イベント数(docs/02 §7 の `/api/events` 上限と同じ)。 */
export const BATCH_SIZE = 20;
/** 定期フラッシュの間隔(ms)。 */
export const FLUSH_INTERVAL_MS = 30_000;
/** 送信先(同一オリジン)。 */
export const ENDPOINT = "/api/events";

export type Context = Omit<CommonFields, "event" | "ts">;

/**
 * 輸送層。本文(JSON 文字列)を送り、成功したら true を返す。
 * テストと E2E のために差し替えられるようにしてある。
 */
export type Transport = (body: string) => boolean | Promise<boolean>;

export interface TelemetryOptions {
  transport?: Transport;
  /** `visibilitychange` / 定期フラッシュを仕掛けるか(既定 true。テストでは false)。 */
  auto?: boolean;
}

const queue: TelemetryEvent[] = [];

let context: Context | null = null;
let globalPrivacyControl = false;
let transport: Transport = defaultTransport;
let timer: ReturnType<typeof setInterval> | null = null;
let listening = false;

/**
 * 既定の輸送: sendBeacon → だめなら fetch(keepalive)。
 * `sendBeacon` はページ遷移中でも送れるが、キュー溢れ等で false を返すことがある。
 */
function defaultTransport(body: string): boolean | Promise<boolean> {
  if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
    try {
      const blob = new Blob([body], { type: "application/json" });
      if (navigator.sendBeacon(ENDPOINT, blob)) return true;
    } catch {
      /* fetch にフォールバックする */
    }
  }
  if (typeof fetch !== "function") return false;
  return fetch(ENDPOINT, {
    method: "POST",
    body,
    keepalive: true,
    headers: { "content-type": "application/json" },
  })
    .then((res) => res.ok)
    .catch(() => false);
}

export function initTelemetry(ctx: Context, gpc = false, options: TelemetryOptions = {}): void {
  context = ctx;
  globalPrivacyControl = gpc;
  transport = options.transport ?? defaultTransport;
  if (gpc) return;

  // 前回の未送信分を拾って先頭に戻す(拾った時点で保存は消す)。
  const pending = loadPending();
  if (pending.length > 0) {
    removeKey(KEYS.telemetryQueue);
    queue.unshift(...pending);
    trim();
  }

  if (options.auto === false) return;
  if (timer === null && typeof setInterval === "function") {
    timer = setInterval(() => void flush(), FLUSH_INTERVAL_MS);
  }
  if (!listening && typeof document !== "undefined") {
    listening = true;
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") void flush();
    });
    // iOS Safari は hidden を挟まずに破棄されることがあるので pagehide でも送る。
    window.addEventListener("pagehide", () => void flush());
  }
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
 * イベントを積む。`game_end` とキュー 20 件はその場でフラッシュする(docs/02 §6)。
 * Global Privacy Control が有効なブラウザでは**何も積まない**。
 */
export function track(fields: EventFields, now: number = Date.now()): void {
  if (globalPrivacyControl) return;
  if (context === null) return;
  const event: TelemetryEvent = { ...context, ...fields, ts: now };
  queue.push(event);
  trim();
  if (fields.event === "game_end" || queue.length >= BATCH_SIZE) void flush();
}

function trim(): void {
  while (queue.length > MAX_QUEUE) queue.shift();
}

/** 現在のキュー(未送信分)。E2E とテストで読む。 */
export function getQueue(): readonly TelemetryEvent[] {
  return queue;
}

/** キューを空にして中身を返す。 */
export function drainQueue(): TelemetryEvent[] {
  return queue.splice(0, queue.length);
}

/**
 * キューを 20 件ずつに切って送る。失敗した分は localStorage へ退避する。
 * 送信そのものを待ちたいテストのために Promise を返す。
 */
export async function flush(): Promise<void> {
  if (globalPrivacyControl) return;
  while (queue.length > 0) {
    const batch = queue.splice(0, BATCH_SIZE);
    const body = JSON.stringify({ events: batch });
    let ok = false;
    try {
      ok = await transport(body);
    } catch {
      ok = false;
    }
    if (!ok) {
      persist(batch);
      // 1 回失敗したら残りは次の機会に回す(オフラインで全部溶かさない)。
      if (queue.length > 0) {
        persist(queue.splice(0, queue.length));
      }
      return;
    }
  }
}

/* ------------------------------------------------------------------ */
/* 再送キュー(localStorage)                                           */
/* ------------------------------------------------------------------ */

function isEventLike(v: unknown): v is TelemetryEvent {
  return typeof v === "object" && v !== null && typeof (v as TelemetryEvent).event === "string";
}

/** 退避済みイベントを読む(壊れていれば空)。 */
export function loadPending(): TelemetryEvent[] {
  const v = readKey<TelemetryEvent[]>(KEYS.telemetryQueue, (data) => {
    if (!Array.isArray(data)) return null;
    return data.filter(isEventLike);
  });
  return v ?? [];
}

/** 送れなかった分を退避する。合計 200 件を超えたら**古いものから**捨てる。 */
function persist(batch: readonly TelemetryEvent[]): void {
  if (batch.length === 0) return;
  const all = [...loadPending(), ...batch];
  const kept = all.slice(Math.max(0, all.length - MAX_QUEUE));
  writeKey(KEYS.telemetryQueue, kept);
}

/** UA からの粗い platform 判定(docs/04 §2)。 */
export function detectPlatform(ua: string): CommonFields["platform"] {
  if (/iPhone|iPad|iPod/i.test(ua)) return "ios";
  if (/Android/i.test(ua)) return "android";
  if (/Windows|Macintosh|X11|Linux/i.test(ua)) return "desktop";
  return "other";
}

/** テスト用: モジュール内の状態を初期化する。 */
export function resetTelemetry(): void {
  queue.length = 0;
  context = null;
  globalPrivacyControl = false;
  transport = defaultTransport;
  if (timer !== null) {
    clearInterval(timer);
    timer = null;
  }
}
