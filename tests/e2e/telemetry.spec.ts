/**
 * docs/06 §5 の `telemetry` シナリオ。
 *
 * M4: `POST /api/events` は `helpers.ts` の自動フィクスチャが全テストで横取りし、
 * 本文を Worker と同じ zod スキーマで検証する(違反があればテスト失敗)。
 * ここでは「正しい瞬間に積まれ、game_end で実際に送信されること」を見る。
 */
import { expect } from "@playwright/test";
import {
  almostDead,
  dragPiece,
  expectEvent,
  gotoState,
  makeState,
  sentEvents,
  telemetryEvents,
  test,
} from "./helpers";

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
      piece: { cells: [[0, 0]], color: 2 },
      heat: 2, // 次のかけらは 2 マス → 飛び飛びの空きには置けない = この 1 手で終わる
      score: 500,
      moves: 20,
      linesCleared: 4,
    }),
    "/play",
  );
  await dragPiece(page, 0, 0);
  await expect(page.getByTestId("gameover")).toBeVisible({ timeout: 10_000 });

  // game_end は即フラッシュされる(docs/02 §6)ので、Worker に届いた分だけを見る。
  await expect
    .poll(() => sentEvents(page).map((e) => e["event"]))
    .toEqual(expect.arrayContaining(["session_start", "game_start", "game_end"]));
  events = sentEvents(page);

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
  await gotoState(page, makeState({ score: 120, moves: 12 }), "/play");
  await expect(page.getByTestId("score")).toHaveText("120");
  await page.goto("/");
  await page.getByTestId("endless-restart").click();
  await expect(page.getByTestId("score")).toHaveText("0");

  await expectEvent(page, (e) => e["event"] === "game_end" && e["reason"] === "abandon");
});

test("ゲームを離れても game_end は積まれない(離脱 = 一時停止)", async ({ page }) => {
  await gotoState(page, makeState({ score: 120, moves: 12 }), "/play");
  // 画面内の「戻る」で離脱する(リロードしないのでキューは残る)。
  await page.getByTestId("back").click();
  await expect(page.getByTestId("home-screen")).toBeVisible();

  const events = await telemetryEvents(page);
  expect(events.some((e) => e["event"] === "game_start")).toBe(true);
  expect(events.some((e) => e["event"] === "game_end")).toBe(false);
});

test("タブが非表示になると未送信分を送る(visibilitychange → hidden)", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("home-screen")).toBeVisible();
  expect(sentEvents(page).some((e) => e["event"] === "session_start")).toBe(false);

  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect.poll(() => sentEvents(page).some((e) => e["event"] === "session_start")).toBe(true);
});
