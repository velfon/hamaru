/**
 * イベント定義(docs/04 §2 共通フィールド / §3 イベント一覧)。
 * M4 の `worker/schema.ts` と 1:1 で対応させる(契約テストは M4)。
 */

export type EventName =
  "session_start" | "game_start" | "game_end" | "daily_result" | "share" | "error" | "vital";

/** 起動経路(URL の `?r=` と `display-mode`)。 */
export type Ref = "direct" | "share" | "pwa" | "other";

export interface CommonFields {
  event: EventName;
  installId: string;
  sessionId: string;
  ts: number;
  version: string;
  lang: "ja" | "en";
  platform: "ios" | "android" | "desktop" | "other";
  exp: string;
  variant: string;
  mode: "endless" | "daily" | "";
}

export interface SessionStartFields {
  ref: Ref;
}

export interface GameStartFields {
  resumed: 0 | 1;
  isPractice: 0 | 1;
}

export interface GameEndFields {
  reason: "over" | "abandon";
  score: number;
  lines: number;
  moves: number;
  /** アクティブ時間のみ(非表示中は止める)。 */
  durationMs: number;
  round: number;
  longestStreak: number;
  isPractice: 0 | 1;
  fillRatioAtEnd: number;
}

export interface DailyResultFields {
  dailyNo: number;
  score: number;
  lines: number;
}

export interface ShareFields {
  method: "share" | "copy";
}

export interface ErrorFields {
  /** 先頭 200 文字。 */
  message: string;
  /** cyrb53 の 16 進。 */
  stackHash: string;
  kind: "js" | "promise" | "config";
}

export interface VitalFields {
  name: "LCP" | "INP" | "CLS";
  value: number;
}

export type EventFields =
  | ({ event: "session_start" } & SessionStartFields)
  | ({ event: "game_start" } & GameStartFields)
  | ({ event: "game_end" } & GameEndFields)
  | ({ event: "daily_result" } & DailyResultFields)
  | ({ event: "share" } & ShareFields)
  | ({ event: "error" } & ErrorFields)
  | ({ event: "vital" } & VitalFields);

export type TelemetryEvent = CommonFields & Record<string, unknown>;
