/**
 * docs/06 §5 の `telemetry` シナリオ。
 *
 * 実装ノート: M3 の `track()` は**メモリ内キューだけ**で、送信(`POST /api/events`)は
 * M4 の担当(docs/07 §1)。そこで M3 では「イベントが正しい瞬間に、docs/04 §2 の
 * 共通フィールド付きで積まれること」を検証する。M4 で輸送を実装したら、この spec に
 * リクエスト捕捉を足す(検証対象のイベント名・フィールドは変わらない)。
 */
import { expect, test } from "@playwright/test";
import { almostDead, dragPiece, gotoState, makeState, telemetryEvents } from "./helpers";

const COMMON = [
  "event",
  "installId",
  "sessionId",
  "ts",
  "version",
  "lang",
  "platform",
  "exp",
  "variant",
  "mode",
];

test("起動で session_start、ゲームで game_start → game_end が積まれる", async ({ page }) => {
  await page.goto("/");
  let events = await telemetryEvents(page);
  expect(events.map((e) => e["event"])).toContain("session_start");
  for (const key of COMMON) expect(events[0]).toHaveProperty(key);

  await gotoState(
    page,
    makeState({
      board: almostDead(),
      tray: [{ shapeId: "dot" }, { shapeId: "sq2" }, { shapeId: "sq2" }],
      score: 500,
      moves: 20,
      round: 6,
      linesCleared: 4,
    }),
    "/play",
  );
  await dragPiece(page, 0, 0, 0);
  await expect(page.getByTestId("gameover")).toBeVisible({ timeout: 10_000 });

  events = await telemetryEvents(page);
  const names = events.map((e) => e["event"]);
  expect(names).toContain("game_start");
  expect(names).toContain("game_end");

  const start = events.find((e) => e["event"] === "game_start");
  expect(start?.["mode"]).toBe("endless");
  expect(start?.["resumed"]).toBe(0);
  expect(start?.["isPractice"]).toBe(0);

  const end = events.find((e) => e["event"] === "game_end");
  expect(end?.["reason"]).toBe("over");
  expect(end?.["score"]).toBe(501);
  expect(end?.["moves"]).toBe(21);
  expect(typeof end?.["durationMs"]).toBe("number");
  expect(typeof end?.["fillRatioAtEnd"]).toBe("number");
  for (const key of COMMON) expect(end).toHaveProperty(key);
});

test("「はじめから」で途中のゲームを捨てると game_end(abandon)が積まれる", async ({ page }) => {
  // `?state=` は 1 回だけ効くので、ここで積んだ「途中のゲーム」が保存される。
  await gotoState(page, makeState({ score: 120, moves: 12, round: 5 }), "/play");
  await expect(page.getByTestId("score")).toHaveText("120");
  await page.goto("/");
  await page.getByTestId("endless-restart").click();
  await expect(page.getByTestId("score")).toHaveText("0");

  const events = await telemetryEvents(page);
  expect(events.some((e) => e["event"] === "game_end" && e["reason"] === "abandon")).toBe(true);
});

test("ゲームを離れても game_end は積まれない(離脱 = 一時停止)", async ({ page }) => {
  await gotoState(page, makeState({ score: 120, moves: 12, round: 5 }), "/play");
  // 画面内の「戻る」で離脱する(リロードしないのでキューは残る)。
  await page.getByTestId("back").click();
  await expect(page.getByTestId("home-screen")).toBeVisible();

  const events = await telemetryEvents(page);
  expect(events.some((e) => e["event"] === "game_start")).toBe(true);
  expect(events.some((e) => e["event"] === "game_end")).toBe(false);
});
