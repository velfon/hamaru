/**
 * Worker `/api/events`(docs/02 §7、docs/04 §4 / §9)。
 * AE への詰め替えはゴールデン比較で位置を固定する。**位置の変更は追記のみ**。
 */
import { describe, expect, it } from "vitest";
import { handleEvents, toDataPoint, type DataPoint } from "../../worker/events";
import { MAX_BODY_BYTES } from "../../worker/schema";
import { INSTALL, SAMPLE_EVENTS } from "./telemetry-fixtures";

const ORIGIN = "https://hamaru.example.workers.dev";

function fakeEnv() {
  const points: DataPoint[] = [];
  return { points, env: { EVENTS: { writeDataPoint: (p: DataPoint) => void points.push(p) } } };
}

function post(body: string, headers: Record<string, string> = { origin: ORIGIN }): Request {
  return new Request(`${ORIGIN}/api/events`, { method: "POST", body, headers });
}

describe("toDataPoint(docs/04 §4 の位置)", () => {
  it("game_end", () => {
    expect(toDataPoint(SAMPLE_EVENTS.game_end, "JP")).toEqual({
      indexes: [INSTALL],
      blobs: [
        "game_end",
        "s-1",
        "a1b2c3d",
        "ja",
        "ios",
        "JP",
        "EXP-0003",
        "treatment",
        "endless",
        "over",
        "",
        "",
      ],
      doubles: [1240, 18, 71, 187_000, 24, 5, 0, 0, 0.63, 0, 0, 1_760_000_000_000],
    });
  });

  it("session_start は blob10 = ref", () => {
    const p = toDataPoint(SAMPLE_EVENTS.session_start, "US");
    expect(p.blobs[0]).toBe("session_start");
    expect(p.blobs[8]).toBe("");
    expect(p.blobs[9]).toBe("share");
    expect(p.doubles.slice(0, 11)).toEqual(Array(11).fill(0));
  });

  it("game_start は double7 = isPractice / double8 = resumed", () => {
    const p = toDataPoint(SAMPLE_EVENTS.game_start, "");
    expect(p.doubles[6]).toBe(0);
    expect(p.doubles[7]).toBe(1);
  });

  it("daily_result は double1/2/10", () => {
    const p = toDataPoint(SAMPLE_EVENTS.daily_result, "");
    expect([p.doubles[0], p.doubles[1], p.doubles[9]]).toEqual([4520, 18, 12]);
    expect(p.blobs[8]).toBe("daily");
  });

  it("share は blob10 = method", () => {
    expect(toDataPoint(SAMPLE_EVENTS.share, "").blobs[9]).toBe("copy");
  });

  it("error は blob10 = message / blob11 = stackHash / blob12 = kind", () => {
    const p = toDataPoint(SAMPLE_EVENTS.error, "");
    expect(p.blobs.slice(9)).toEqual(["TypeError: x is undefined", "3fa9c1e2b8d4a5f6", "promise"]);
  });

  it("vital は blob10 = name / double11 = value", () => {
    const p = toDataPoint(SAMPLE_EVENTS.vital, "");
    expect(p.blobs[9]).toBe("LCP");
    expect(p.doubles[10]).toBe(1180);
  });

  it("全イベントで blob 12・double 12・index 1(AE の上限 20/20/1 以内)", () => {
    for (const e of Object.values(SAMPLE_EVENTS)) {
      const p = toDataPoint(e, "JP");
      expect(p.blobs).toHaveLength(12);
      expect(p.doubles).toHaveLength(12);
      expect(p.indexes).toHaveLength(1);
      expect(new TextEncoder().encode(p.indexes[0]).length).toBeLessThanOrEqual(96);
    }
  });
});

describe("handleEvents", () => {
  const batch = JSON.stringify({ events: [SAMPLE_EVENTS.game_start, SAMPLE_EVENTS.game_end] });

  it("正常なバッチは 204 で件数分書く", async () => {
    const { env, points } = fakeEnv();
    const res = await handleEvents(post(batch), env, "JP");
    expect(res.status).toBe(204);
    expect(points).toHaveLength(2);
    expect(points[1]?.blobs[5]).toBe("JP");
  });

  it("Origin が別ホストなら 403、無ければ 403", async () => {
    const { env, points } = fakeEnv();
    expect(
      (await handleEvents(post(batch, { origin: "https://evil.example" }), env, "")).status,
    ).toBe(403);
    expect((await handleEvents(post(batch, {}), env, "")).status).toBe(403);
    expect(points).toHaveLength(0);
  });

  it("POST 以外は 405", async () => {
    const { env } = fakeEnv();
    const res = await handleEvents(
      new Request(`${ORIGIN}/api/events`, { headers: { origin: ORIGIN } }),
      env,
      "",
    );
    expect(res.status).toBe(405);
  });

  it("JSON でなければ 400", async () => {
    const { env } = fakeEnv();
    expect((await handleEvents(post("{nope"), env, "")).status).toBe(400);
  });

  it("1 件でも不正なら 400 で、1 件も書かない", async () => {
    const { env, points } = fakeEnv();
    const bad = JSON.stringify({
      events: [SAMPLE_EVENTS.game_start, { ...SAMPLE_EVENTS.share, method: "fax" }],
    });
    expect((await handleEvents(post(bad), env, "")).status).toBe(400);
    expect(points).toHaveLength(0);
  });

  it("21 件は 400", async () => {
    const { env } = fakeEnv();
    const many = JSON.stringify({ events: Array(21).fill(SAMPLE_EVENTS.share) });
    expect((await handleEvents(post(many), env, "")).status).toBe(400);
  });

  it("16 KB 超は 413", async () => {
    const { env } = fakeEnv();
    const big = JSON.stringify({ events: [SAMPLE_EVENTS.share], pad: "x".repeat(MAX_BODY_BYTES) });
    expect((await handleEvents(post(big), env, "")).status).toBe(413);
  });
});
