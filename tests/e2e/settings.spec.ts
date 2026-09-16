/**
 * docs/06 §5 の `settings` シナリオ。
 * 言語切替で文言が変わる / テーマ切替 / データ削除で統計が 0。
 */
import { expect, test } from "@playwright/test";
import { dragPiece } from "./helpers";

test("言語を切り替えると文言が変わり、再読み込みしても残る", async ({ page }) => {
  await page.goto("/#/settings");
  await expect(page.getByTestId("settings-screen")).toBeVisible();

  await page.getByTestId("setting-lang").selectOption("ja");
  await expect(page.getByTestId("settings-screen")).toContainText("言語");

  await page.goto("/");
  await expect(page.getByTestId("endless-play")).toHaveText("エンドレス");

  await page.reload();
  await expect(page.getByTestId("endless-play")).toHaveText("エンドレス");

  await page.goto("/#/settings");
  await page.getByTestId("setting-lang").selectOption("en");
  await page.goto("/");
  await expect(page.getByTestId("endless-play")).toHaveText("Play endless");
});

test("テーマを切り替えると data-theme と theme-color が変わる", async ({ page }) => {
  await page.goto("/#/settings");
  await page.getByTestId("setting-theme").selectOption("light");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  const light = await page.locator('meta[name="theme-color"]').getAttribute("content");

  await page.getByTestId("setting-theme").selectOption("dark");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  const dark = await page.locator('meta[name="theme-color"]').getAttribute("content");
  expect(light).not.toBe(dark);
});

test("アニメーション軽減を常時にすると data-motion が変わる", async ({ page }) => {
  await page.goto("/#/settings");
  await page.getByTestId("setting-motion").selectOption("always");
  await expect(page.locator("html")).toHaveAttribute("data-motion", "reduced");
});

test("消去プレビューを OFF にするとハイライトが出ない", async ({ page }) => {
  await page.goto("/#/settings");
  await page.getByTestId("setting-preview").uncheck();

  await page.goto("/#/play");
  const slot = await page.getByTestId("slot-0").boundingBox();
  const cell = await page.locator("#c-4-4").boundingBox();
  if (slot === null || cell === null) throw new Error("要素が見つかりません");
  await page.mouse.move(slot.x + slot.width / 2, slot.y + slot.height / 2);
  await page.mouse.down();
  await page.mouse.move(cell.x + cell.width / 2, cell.y + cell.height / 2, { steps: 6 });
  await expect(page.locator("[data-ghost]").first()).toBeVisible();
  await expect(page.locator('[data-preview="1"]')).toHaveCount(0);
  await page.mouse.up();
});

test("データを削除すると統計が 0 に戻る", async ({ page }) => {
  // 1 ゲーム分の記録を作る。
  await page.goto("/#/play");
  await dragPiece(page, 0, 0, 0);
  await page.goto("/");
  await expect(page.getByTestId("endless-restart")).toBeVisible();

  await page.goto("/#/settings");
  await page.getByTestId("reset").click();
  await expect(page.getByTestId("reset-dialog")).toBeVisible();
  await page.getByTestId("dialog-cancel").click();
  await expect(page.getByTestId("reset-dialog")).toBeHidden();

  await page.getByTestId("reset").click();
  await page.getByTestId("dialog-confirm").click();
  await expect(page.getByTestId("toast")).toBeVisible();

  // 途中のゲームとデイリー記録は消える(設定と install は既定値で書き直される)。
  const keys = await page.evaluate(() =>
    Object.keys(localStorage).filter((k) => k.startsWith("hamaru:v1:")),
  );
  expect(keys).not.toContain("hamaru:v1:game:endless");
  expect(keys).not.toContain("hamaru:v1:daily:results");
  const stats = await page.evaluate(() => localStorage.getItem("hamaru:v1:stats"));
  expect(stats === null || stats.includes('"bestScore":0')).toBe(true);

  await page.goto("/");
  await expect(page.getByTestId("stats")).toContainText("first game");
  await expect(page.getByTestId("endless-restart")).toBeHidden();
});

test("プライバシー画面に送信内容が書いてある(docs/04 §8)", async ({ page }) => {
  await page.goto("/#/settings");
  await page.getByTestId("about-link").click();
  await expect(page.getByTestId("about-screen")).toBeVisible();
  await expect(page.getByTestId("about-screen")).toContainText("Global Privacy Control");
  await expect(page.getByTestId("about-screen")).toContainText("IP");
});
