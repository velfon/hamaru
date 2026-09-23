/**
 * レベルモード(docs/09 §5)。規則そのものは tests/unit/levels.test.ts で見る。
 */
import { expect } from "@playwright/test";
import { almostFullRow, dragPiece, gotoState, makeState, test } from "./helpers";

test("ホーム → レベル一覧: 1 が次に遊ぶ面、2 は未解放", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("levels-link")).toContainText("Level 1");
  await page.getByTestId("levels-link").click();
  await expect(page.getByTestId("levels-screen")).toBeVisible();
  await expect(page.getByTestId("level-1")).toHaveClass(/levels__tile--next/);
  await expect(page.getByTestId("level-2")).toBeDisabled();
  await page.getByTestId("level-1").click();
  await expect(page.getByTestId("level-screen")).toBeVisible();
  await expect(page.getByTestId("modetag")).toHaveText("Lv.1");
  await expect(page.getByTestId("goal")).toHaveText("0/3");
  await expect(page.getByTestId("trays")).toHaveText("42");
});

test("目標に達するとクリア: 星・進捗の保存・次のレベルへ", async ({ page }) => {
  const state = makeState({
    mode: "level",
    board: almostFullRow(10, false),
    piece: { cells: [[0, 0]], color: 2 },
    linesCleared: 2,
    level: { no: 1, goal: 3, moveLimit: 6 },
  });
  await gotoState(page, state, "/level?n=1");
  await expect(page.getByTestId("goal")).toHaveText("2/3");
  await dragPiece(page, 9, 9);
  const overlay = page.getByTestId("level-clear");
  await expect(overlay).toBeVisible({ timeout: 10_000 });
  await expect(overlay.getByTestId("level-stars")).toHaveAttribute("data-stars", "3");

  await overlay.getByTestId("level-next").click();
  await expect(page.getByTestId("modetag")).toHaveText("Lv.2");

  await page.goto("/#/levels");
  await expect(page.getByTestId("level-1")).toContainText("★★★");
  await expect(page.getByTestId("level-2")).toHaveClass(/levels__tile--next/);
  await expect(page.getByTestId("levels-summary")).toContainText("level 2");
});

test("手数を使い切ると失敗し、理由を出してやり直せる", async ({ page }) => {
  const state = makeState({
    mode: "level",
    piece: { cells: [[0, 0]], color: 2 },
    moves: 5,
    level: { no: 1, goal: 3, moveLimit: 6 },
  });
  await gotoState(page, state, "/level?n=1");
  await expect(page.getByTestId("trays")).toHaveText("1");
  await dragPiece(page, 0, 0);
  const overlay = page.getByTestId("gameover");
  await expect(overlay).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId("level-fail-reason")).toHaveText("Out of moves");
  await overlay.getByTestId("level-retry").click();
  await expect(overlay).toBeHidden();
  await expect(page.getByTestId("goal")).toHaveText("0/3");
  await expect(page.getByTestId("trays")).toHaveText("42");
});

test("素焼きの欠片を描き、読み上げでも区別する", async ({ page }) => {
  const board = new Uint8Array(100);
  board[0] = 7;
  const state = makeState({ mode: "level", board, level: { no: 1, goal: 3, moveLimit: 6 } });
  await gotoState(page, state, "/level?n=1");
  await expect(page.locator("#c-0-0")).toHaveAttribute("data-c", "7");
});
