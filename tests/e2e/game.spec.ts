/**
 * docs/06 §5 の E2E シナリオ: smoke / clear / gameover / resume / keyboard / reduced-motion。
 */
import { expect, test } from "@playwright/test";
import {
  almostDead,
  almostFullRow,
  dragPiece,
  gotoState,
  grabPiece,
  makeState,
  telemetryEvents,
  waitForBoardLayout,
} from "./helpers";

test("smoke: ホーム → エンドレス → ピースを置くとスコアが増える", async ({ page }, info) => {
  await page.goto("/");
  await expect(page.getByTestId("home-screen")).toBeVisible();
  await expect(page.getByTestId("daily-card")).toBeVisible();
  await page.screenshot({ path: `test-results/screens/home-${info.project.name}.png` });

  await page.getByTestId("endless-play").click();
  await expect(page.getByTestId("board")).toBeVisible();
  await expect(page.getByTestId("score")).toHaveText("0");

  await dragPiece(page, 0, 0, 0);
  await expect(page.getByTestId("score")).not.toHaveText("0");
  await page.screenshot({ path: `test-results/screens/game-${info.project.name}.png` });

  // 盤にタイルが増えている(形状によってはバウンディングボックスの原点は空セル。docs/01 §14 N-1)。
  expect(await page.locator('.board .cell:not([data-c="0"])').count()).toBeGreaterThan(0);
});

test("clear: 1 列そろうと消えて空セルに戻る", async ({ page }) => {
  await gotoState(
    page,
    makeState({ board: almostFullRow(), tray: [{ shapeId: "dot" }, null, null], score: 100 }),
    "/play",
  );

  await dragPiece(page, 0, 9, 9);

  // 状態遷移は演出に依存しない: 置いた直後に消えている。
  await expect(page.locator("#c-0-9")).toHaveAttribute("data-c", "0");
  await expect(page.locator("#c-9-9")).toHaveAttribute("data-c", "0");
  // 100 + 1(セル)+ 10(1 列)= 111。(0,0) のタイルは残るので全消しにはならない。
  await expect(page.getByTestId("score")).toHaveText("111");
  await expect(page.locator("#c-0-0")).not.toHaveAttribute("data-c", "0");
  await expect(page.getByTestId("live")).toContainText("1");
});

test("全消し: 盤が空になると +300 とラベルが出る(docs/01 §6)", async ({ page }) => {
  await gotoState(
    page,
    makeState({
      board: almostFullRow(10, false),
      tray: [{ shapeId: "dot" }, null, null],
      score: 100,
    }),
    "/play",
  );

  await dragPiece(page, 0, 9, 9);
  // 100 + 1 + 10 + 300
  await expect(page.getByTestId("score")).toHaveText("411");
  await expect(page.getByTestId("boardclear")).toBeVisible();
});

test("gameover: 詰みの盤で置くとオーバーレイ → もう一度で新しいゲーム", async ({ page }) => {
  await gotoState(
    page,
    makeState({
      board: almostDead(),
      tray: [{ shapeId: "dot" }, { shapeId: "sq2" }, { shapeId: "sq2" }],
      score: 4200,
      linesCleared: 18,
      longestStreak: 5,
      round: 14,
      moves: 52,
    }),
    "/play",
  );

  await dragPiece(page, 0, 0, 0);

  const overlay = page.getByTestId("gameover");
  await expect(overlay).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId("final-score")).toHaveText("4,201");
  await expect(overlay.getByTestId("retry")).toBeVisible();

  const events = await telemetryEvents(page);
  expect(events.some((e) => e["event"] === "game_end" && e["reason"] === "over")).toBe(true);

  await overlay.getByTestId("retry").click();
  await expect(overlay).toBeHidden();
  await expect(page.getByTestId("score")).toHaveText("0");
});

test("resume: 数手置いてリロード → 続きから で盤が復元する", async ({ page }) => {
  await page.goto("/#/play");
  await dragPiece(page, 0, 0, 0);
  await expect(page.getByTestId("score")).not.toHaveText("0");
  const score = await page.getByTestId("score").textContent();

  await page.goto("/");
  await page.reload();

  await expect(page.getByTestId("endless-restart")).toBeVisible();
  await page.getByTestId("endless-play").click();
  await expect(page.getByTestId("score")).toHaveText(score ?? "");
  expect(await page.locator('.board .cell:not([data-c="0"])').count()).toBeGreaterThan(0);
});

test("keyboard: キーボードだけで 1 ピース置ける(docs/01 §8.2)", async ({ page }) => {
  await gotoState(page, makeState({ tray: [{ shapeId: "dot" }, null, null] }), "/play");

  await page.keyboard.press("1");
  await expect(page.locator("#c-0-0")).toHaveAttribute("data-cursor", "1");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  await expect(page.locator("#c-1-2")).toHaveAttribute("data-cursor", "1");
  await page.keyboard.press("Enter");

  await expect(page.locator("#c-1-2")).not.toHaveAttribute("data-c", "0");
  await expect(page.getByTestId("score")).toHaveText("1");
  await expect(page.getByTestId("live")).toContainText("1");
});

test("keyboard: Esc で選択解除するとゴーストが消える", async ({ page }) => {
  await gotoState(page, makeState({ tray: [{ shapeId: "sq2" }, null, null] }), "/play");
  await page.keyboard.press("1");
  await expect(page.locator("[data-ghost]").first()).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("[data-ghost]")).toHaveCount(0);
});

test.describe("reduced-motion", () => {
  test.use({ reducedMotion: "reduce" });

  test("軽減設定では配置・消去が即時に反映される", async ({ page }) => {
    await gotoState(
      page,
      makeState({ board: almostFullRow(), tray: [{ shapeId: "dot" }, null, null] }),
      "/play",
    );
    await dragPiece(page, 0, 9, 9);

    // 待たずに(= 演出の完了を待たずに)最終状態になっている。
    expect(await page.locator("#c-5-9").getAttribute("data-c")).toBe("0");
    expect(await page.getByTestId("score").textContent()).toBe("11");
  });
});

test("盤外にドロップするとキャンセルされる(docs/01 §8.1)", async ({ page }) => {
  await gotoState(page, makeState({ tray: [{ shapeId: "dot" }, null, null] }), "/play");
  await waitForBoardLayout(page);
  const slot = await page.getByTestId("slot-0").boundingBox();
  if (slot === null) throw new Error("slot が見つかりません");

  await page.mouse.move(slot.x + slot.width / 2, slot.y + slot.height / 2);
  await page.mouse.down();
  await page.locator(".dragpiece").waitFor({ state: "attached" });
  await page.mouse.move(5, 5, { steps: 6 });
  await expect(page.locator("[data-ghost]")).toHaveCount(0);
  await page.mouse.up();

  await expect(page.getByTestId("score")).toHaveText("0");
  await expect(page.getByTestId("slot-0")).toBeEnabled();
});

test("消去プレビュー: 置くと消える行が下塗りされる(docs/01 §8.1)", async ({ page }) => {
  await gotoState(
    page,
    makeState({ board: almostFullRow(), tray: [{ shapeId: "dot" }, null, null] }),
    "/play",
  );
  const drop = await grabPiece(page, 0, 9, 9);
  await expect(page.locator('[data-preview="1"]')).toHaveCount(10);
  await drop();
  await expect(page.locator('[data-preview="1"]')).toHaveCount(0);
});
