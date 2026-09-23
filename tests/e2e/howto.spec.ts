/**
 * 遊び方(docs/01 §9.7)。説明ではなく**実際に 1 手動く**ことが要件なので、
 * 文言ではなく「置いたら盤と手持ちが変わる」ことを見る。
 */
import { expect } from "@playwright/test";
import { firstRun, test } from "./helpers";

const filled = (page: import("@playwright/test").Page, sel: string) =>
  page.locator(`${sel} .cell:not([data-c="0"])`);

test("ホームから開き、1 手置くと盤とかけらが変わる", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("howto-link").click();
  await expect(page.getByTestId("howto-screen")).toBeVisible();

  const board = page.locator(".howto__board");
  const hand = page.getByTestId("howto-hand");
  await expect(filled(page, ".howto__board")).toHaveCount(8); // START の 8 マス
  await expect(filled(page, '[data-testid="howto-hand"]')).toHaveCount(1); // 最初は 1 マス

  await board.locator('.cell[data-x="4"][data-y="0"]').click();

  // 置いた分だけ盤が増え、まわりの形が返ってくるので手持ちが 2 マスになる(熱 1 → 2)。
  await expect(filled(page, ".howto__board")).toHaveCount(9);
  await expect(filled(page, '[data-testid="howto-hand"]')).toHaveCount(2);
  await expect(page.getByTestId("howto-caption")).not.toHaveText("");
  await expect(hand).toBeVisible();
});

test("おまかせで 1 手 / はじめから(キーボードでも同じことができる)", async ({ page }) => {
  await page.goto("/#/howto");
  await expect(page.getByTestId("howto-screen")).toBeVisible();
  const before = await page.getByTestId("howto-caption").textContent();

  await page.getByTestId("howto-auto").click();
  await expect(page.getByTestId("howto-caption")).not.toHaveText(before ?? "");
  await expect(filled(page, ".howto__board")).toHaveCount(9);

  await page.getByTestId("howto-reset").click();
  await expect(filled(page, ".howto__board")).toHaveCount(8);
  await expect(page.getByTestId("howto-caption")).toHaveText(before ?? "");
});

test("いちばん最初にゲームへ入るときだけ、遊び方を挟む(押した先へ戻る)", async ({ page }) => {
  await firstRun(page);
  await page.goto("/");
  // 今日の挑戦を押しても遊び方へ寄り道し、「はじめる」でその行き先へ戻る。
  await page.getByTestId("daily-play").click();
  await expect(page.getByTestId("howto-screen")).toBeVisible();
  expect(page.url()).toContain("next=");

  await page.getByTestId("howto-start").click();
  await expect(page.getByTestId("board")).toBeVisible();
  await expect(page.getByTestId("modetag")).toContainText("challenge");

  // 2 回目からは挟まらない(firstRun の init script は読み込みのたびに印を消すので、
  // ここはリロードせずアプリ内の遷移で戻る)。
  await page.getByTestId("back").click();
  await expect(page.getByTestId("home-screen")).toBeVisible();
  await page.getByTestId("endless-play").click();
  await expect(page.getByTestId("board")).toBeVisible();
});

test("`#/play` を直接開いた人は素通しする(ゲーム画面の表示速度を測れるように)", async ({
  page,
}) => {
  await firstRun(page);
  await page.goto("/#/play");
  await expect(page.getByTestId("board")).toBeVisible();
  await expect(page.getByTestId("howto-screen")).toHaveCount(0);
});
