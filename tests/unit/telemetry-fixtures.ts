/**
 * テレメトリのテスト用イベント(docs/04 §3 の全イベント種別を 1 件ずつ)。
 * クライアントの型(`ClientEvent`)で作るので、型がずれるとここがコンパイルエラーになる。
 */
import type { ClientEvent } from "../../src/telemetry/events";

export const INSTALL = "3b241101-e2bb-4255-8caf-4136c566a962";

const common = {
  installId: INSTALL,
  sessionId: "s-1",
  ts: 1_760_000_000_000,
  version: "a1b2c3d",
  lang: "ja",
  platform: "ios",
  exp: "EXP-0003",
  variant: "treatment",
  mode: "endless",
} as const;

export const SAMPLE_EVENTS = {
  session_start: { ...common, mode: "", event: "session_start", ref: "share" },
  game_start: { ...common, event: "game_start", resumed: 1, isPractice: 0 },
  game_end: {
    ...common,
    event: "game_end",
    reason: "over",
    score: 1240,
    lines: 18,
    moves: 71,
    durationMs: 187_000,
    round: 24,
    longestStreak: 5,
    isPractice: 0,
    fillRatioAtEnd: 0.63,
  },
  daily_result: {
    ...common,
    mode: "daily",
    event: "daily_result",
    dailyNo: 12,
    score: 4520,
    lines: 18,
  },
  share: { ...common, mode: "daily", event: "share", method: "copy" },
  error: {
    ...common,
    event: "error",
    message: "TypeError: x is undefined",
    stackHash: "3fa9c1e2b8d4a5f6",
    kind: "promise",
  },
  vital: { ...common, mode: "", event: "vital", name: "LCP", value: 1180 },
} satisfies Record<ClientEvent["event"], ClientEvent>;

export const ALL_SAMPLE_EVENTS: ClientEvent[] = Object.values(SAMPLE_EVENTS);
