/**
 * テレメトリクライアント(docs/02 §6、docs/04 §9)。
 * - 20 件ずつに分割して送る / game_end と 20 件で即フラッシュ
 * - 失敗時は localStorage(ここではメモリ backend)へ退避し、次回起動で再送
 * - 退避は最大 200 件、古いものから捨てる
 * - GPC 有効なら何も積まない
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetBackend } from "../../src/storage/local";
import {
  BATCH_SIZE,
  flush,
  getQueue,
  initTelemetry,
  loadPending,
  MAX_QUEUE,
  resetTelemetry,
  track,
  type Context,
} from "../../src/telemetry/client";
import { roundVital } from "../../src/telemetry/vitals";
import { batchSchema } from "../../worker/schema";
import { INSTALL } from "./telemetry-fixtures";

const CTX: Context = {
  installId: INSTALL,
  sessionId: "s-1",
  version: "dev",
  lang: "en",
  platform: "desktop",
  exp: "",
  variant: "",
  mode: "",
};

function recorder(ok: boolean | (() => boolean) = true) {
  const bodies: Array<{ events: Array<Record<string, unknown>> }> = [];
  const transport = (body: string) => {
    bodies.push(JSON.parse(body));
    return typeof ok === "function" ? ok() : ok;
  };
  return { bodies, transport };
}

const share = { event: "share", method: "copy" } as const;

beforeEach(() => {
  resetBackend();
  resetTelemetry();
});
afterEach(() => resetTelemetry());

describe("track / flush", () => {
  it("共通フィールドと ts を付けて積む", () => {
    initTelemetry(CTX, false, { transport: () => true, auto: false });
    track({ event: "session_start", ref: "direct" }, 42);
    expect(getQueue()).toEqual([{ ...CTX, event: "session_start", ref: "direct", ts: 42 }]);
  });

  it("送る本文は Worker のバッチスキーマを通る", async () => {
    const { bodies, transport } = recorder();
    initTelemetry(CTX, false, { transport, auto: false });
    track({ event: "session_start", ref: "direct" }, 1);
    track({ event: "game_start", resumed: 0, isPractice: 0 }, 2);
    await flush();
    expect(bodies).toHaveLength(1);
    expect(batchSchema.safeParse(bodies[0]).success).toBe(true);
  });

  it("45 件は 20 / 20 / 5 に分けて送る", async () => {
    const { bodies, transport } = recorder();
    initTelemetry(CTX, false, { transport, auto: false });
    // 20 件目で自動フラッシュが走るので、同期で積んだ分は 20 件ずつ送られる。
    for (let i = 0; i < 45; i++) track(share, i);
    await flush();
    expect(bodies.map((b) => b.events.length)).toEqual([BATCH_SIZE, BATCH_SIZE, 5]);
    expect(getQueue()).toHaveLength(0);
  });

  it("game_end は即フラッシュする", async () => {
    const { bodies, transport } = recorder();
    initTelemetry(CTX, false, { transport, auto: false });
    track(share, 1);
    track(
      {
        event: "game_end",
        reason: "over",
        score: 1,
        lines: 0,
        moves: 1,
        durationMs: 10,
        round: 1,
        longestStreak: 0,
        isPractice: 0,
        fillRatioAtEnd: 0.01,
      },
      2,
    );
    await Promise.resolve();
    expect(bodies).toHaveLength(1);
    expect(bodies[0]?.events.map((e) => e["event"])).toEqual(["share", "game_end"]);
  });

  it("送信失敗は退避し、次回起動で先頭に戻して再送する", async () => {
    initTelemetry(CTX, false, { transport: () => false, auto: false });
    track(share, 1);
    track(share, 2);
    await flush();
    expect(getQueue()).toHaveLength(0);
    expect(loadPending().map((e) => e.ts)).toEqual([1, 2]);

    resetTelemetry();
    const { bodies, transport } = recorder();
    initTelemetry(CTX, false, { transport, auto: false });
    track(share, 3);
    await flush();
    expect(bodies[0]?.events.map((e) => e["ts"])).toEqual([1, 2, 3]);
    expect(loadPending()).toHaveLength(0);
  });

  it("transport が例外を投げても退避する", async () => {
    initTelemetry(CTX, false, {
      transport: () => {
        throw new Error("offline");
      },
      auto: false,
    });
    track(share, 1);
    await flush();
    expect(loadPending()).toHaveLength(1);
  });

  it("退避は最大 200 件で、古いものから捨てる", async () => {
    initTelemetry(CTX, false, { transport: () => false, auto: false });
    for (let i = 0; i < 230; i++) track(share, i);
    await flush();
    const pending = loadPending();
    expect(pending).toHaveLength(MAX_QUEUE);
    expect(pending[0]?.ts).toBe(30);
    expect(pending.at(-1)?.ts).toBe(229);
  });

  it("Global Privacy Control が有効なら何も積まず、何も送らない", async () => {
    const { bodies, transport } = recorder();
    initTelemetry(CTX, true, { transport, auto: false });
    track(share, 1);
    await flush();
    expect(getQueue()).toHaveLength(0);
    expect(bodies).toHaveLength(0);
  });

  it("init 前の track は無視する", () => {
    track(share, 1);
    expect(getQueue()).toHaveLength(0);
  });
});

describe("roundVital", () => {
  it("LCP / INP は整数、CLS は小数 4 桁", () => {
    expect(roundVital("LCP", 1180.6)).toBe(1181);
    expect(roundVital("INP", 63.2)).toBe(63);
    expect(roundVital("CLS", 0.012345)).toBe(0.0123);
  });
});
