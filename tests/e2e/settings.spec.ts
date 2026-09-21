/**
 * docs/06 §5 の `settings` シナリオ。
 * 言語切替で文言が変わる / テーマ切替 / データ削除で統計が 0。
 */
import { expect } from "@playwright/test";
import { dragPiece, grabPiece, test } from "./helpers";

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
  const drop = await grabPiece(page, 0, 4, 4);
  await expect(page.locator("[data-ghost]").first()).toBeVisible();
  await expect(page.locator('[data-preview="1"]')).toHaveCount(0);
  await drop();
});

test("BGM は既定 OFF。ゲーム画面のボタンで ON にでき、設定と同期する(docs/10 §4)", async ({
  page,
}) => {
  // 音が出ているかは自動では確かめられないので、AudioContext が作られて走り出すことまでを見る。
  await page.addInitScript(() => {
    const w = window as unknown as { AudioContext: new () => AudioContext; __ctx?: AudioContext };
    const Original = w.AudioContext;
    const patched = function (): AudioContext {
      const ctx = new Original();
      w.__ctx = ctx;
      return ctx;
    };
    patched.prototype = Original.prototype;
    w.AudioContext = patched as unknown as new () => AudioContext;
  });

  await page.goto("/#/play");
  const music = page.getByTestId("music");
  await expect(music).toHaveAttribute("aria-pressed", "false");
  expect(await page.evaluate(() => "__ctx" in window)).toBe(false); // OFF のうちは作らない

  await music.click();
  await expect(music).toHaveAttribute("aria-pressed", "true");
  await expect
    .poll(() =>
      page.evaluate(() => (window as unknown as { __ctx?: AudioContext }).__ctx?.state ?? null),
    )
    .toBe("running");

  await page.goto("/#/settings");
  await expect(page.getByTestId("setting-music")).toBeChecked();
  await page.getByTestId("setting-music").uncheck();

  await page.goto("/#/play");
  await expect(page.getByTestId("music")).toHaveAttribute("aria-pressed", "false");
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
