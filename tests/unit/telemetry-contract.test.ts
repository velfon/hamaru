/**
 * 契約テスト(docs/04 §9): クライアントのイベント型と Worker の zod スキーマが一致する。
 *
 * 型レベル: `Expect<Equal<ClientEvent, WorkerEvent>>` が `npm run typecheck` で検査される。
 * 実行時: 全イベント種別のサンプルがスキーマを通り、余計なフィールドは弾かれる。
 */
import { describe, expect, it } from "vitest";
import type { ClientEvent } from "../../src/telemetry/events";
import { batchSchema, eventSchema, type WorkerEvent } from "../../worker/schema";
import { ALL_SAMPLE_EVENTS, SAMPLE_EVENTS } from "./telemetry-fixtures";

/** 交差型を平らなオブジェクト型に直す(union には分配)。 */
type Flatten<T> = T extends unknown ? { [K in keyof T]: T[K] } : never;
type Equal<X, Y> =
  (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2 ? true : false;
type Expect<T extends true> = T;

// どちらかの型を変えるとここが typecheck で落ちる。
export type _ContractClientToWorker = Expect<Equal<Flatten<ClientEvent>, Flatten<WorkerEvent>>>;

describe("telemetry contract", () => {
  it("全イベント種別のサンプルがスキーマを通る", () => {
    expect(ALL_SAMPLE_EVENTS).toHaveLength(7);
    for (const e of ALL_SAMPLE_EVENTS) {
      const r = eventSchema.safeParse(e);
      expect(r.success, `${e.event}: ${r.success ? "" : r.error.message}`).toBe(true);
    }
  });

  it("未定義のフィールドは弾く(strict)", () => {
    expect(eventSchema.safeParse({ ...SAMPLE_EVENTS.share, extra: 1 }).success).toBe(false);
  });

  it("別イベントのフィールドを混ぜると弾く", () => {
    expect(eventSchema.safeParse({ ...SAMPLE_EVENTS.share, score: 10 }).success).toBe(false);
  });

  it("installId が UUID でなければ弾く", () => {
    expect(eventSchema.safeParse({ ...SAMPLE_EVENTS.share, installId: "not-a-uuid" }).success).toBe(
      false,
    );
  });

  it("daily_result の dailyNo は epoch 前の 0 以下も受け取る(整数のみ)", () => {
    expect(eventSchema.safeParse({ ...SAMPLE_EVENTS.daily_result, dailyNo: -13 }).success).toBe(
      true,
    );
    expect(eventSchema.safeParse({ ...SAMPLE_EVENTS.daily_result, dailyNo: 1.5 }).success).toBe(
      false,
    );
  });

  it("バッチは 1〜20 件", () => {
    const one = SAMPLE_EVENTS.share;
    expect(batchSchema.safeParse({ events: [] }).success).toBe(false);
    expect(batchSchema.safeParse({ events: Array(20).fill(one) }).success).toBe(true);
    expect(batchSchema.safeParse({ events: Array(21).fill(one) }).success).toBe(false);
  });
});
