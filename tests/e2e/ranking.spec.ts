/**
 * ランキング(docs/08 §7)。サーバは helpers.ts のフィクスチャが横取りする(既定の応答は MOCK_RANKS / MOCK_TOP)。
 * サーバ側の SQL と得点の検証は tests/unit/leaderboard.test.ts(本物のローカル D1)で見る。
 */
import { expect } from "@playwright/test";
import { almostDead, dragPiece, gotoState, leaderboardPosts, makeState, test } from "./helpers";

const deadDaily = () =>
  makeState({
    mode: "daily",
    board: almostDead(),
    tray: [{ shapeId: "dot" }, { shapeId: "sq2" }, { shapeId: "sq2" }],
    score: 3000,
    linesCleared: 12,
  });

test("デイリーの公式記録はゲームオーバーで送信し、順位を出す", async ({ page }) => {
  await gotoState(page, deadDaily(), "/daily");
  await dragPiece(page, 0, 0, 0);
  const overlay = page.getByTestId("gameover");
  await expect(overlay).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId("daily-rank")).toContainText("#12 of 348");
  await expect(page.getByTestId("daily-rank")).toContainText("This week: #3");

  const submit = leaderboardPosts(page).find((p) => p.path === "/api/daily/submit");
  expect(submit?.body["moves"]).toEqual([[0, 0, 0]]);
  expect(submit?.body["date"]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(submit?.body["installId"]).toMatch(/^[0-9a-f-]{36}$/);
  expect(Object.keys(submit?.body ?? {}).sort()).toEqual(["date", "installId", "moves", "version"]);

  await overlay.getByTestId("over-ranking").click();
  await expect(page.getByTestId("ranking-screen")).toBeVisible();
});

test("送信に失敗しても結果は出て、失敗を知らせる", async ({ page }) => {
  await page.route("**/api/daily/submit", (route) => route.fulfill({ status: 500 }));
  await gotoState(page, deadDaily(), "/daily");
  await dragPiece(page, 0, 0, 0);
  await expect(page.getByTestId("gameover")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId("final-score")).toHaveText("3,001");
  await expect(page.getByTestId("daily-rank")).toHaveText("Couldn't save to the leaderboard");
});

test("ランキング画面: 上位・自分の行・タブ", async ({ page }) => {
  await page.goto("/#/ranking");
  const rows = page.getByTestId("ranking-list").locator("li");
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(1)).toHaveAttribute("aria-current", "true");
  await expect(rows.nth(1)).toContainText("こはる");
  await expect(rows.nth(0)).toContainText("Persimmon Kiln keeper 1203");
  await expect(page.getByTestId("my-name")).toHaveText("Celadon Potter 0421");
  // デイリーは「その日のベスト」。挑戦回数も並ぶ(docs/08 §1)
  await expect(page.getByTestId("my-rank")).toHaveText("#2 of 348 · 1 tries");

  await page.getByTestId("tab-week").click();
  await expect(page.getByTestId("tab-week")).toHaveAttribute("aria-selected", "true");
  await expect(rows.nth(0)).toContainText("4 days");
  await expect(page).toHaveURL(/#\/ranking\?period=week$/);
});

test("ランキング画面: 名前を変える(成功・禁止語)", async ({ page }) => {
  await page.goto("/#/ranking");
  await expect(page.getByTestId("my-name")).toHaveText("Celadon Potter 0421");

  await page.getByTestId("rename").click();
  await page.getByTestId("name-input").fill("公式スタッフ");
  await page.getByTestId("name-save").click();
  await expect(page.getByTestId("name-error")).toHaveText("That name isn't allowed");

  await page.getByTestId("name-input").fill("ろくろ名人");
  await page.getByTestId("name-save").click();
  await expect(page.getByTestId("name-dialog")).toHaveCount(0);
  const profile = leaderboardPosts(page).filter((p) => p.path === "/api/profile");
  expect(profile.map((p) => p.body["nickname"])).toEqual(["公式スタッフ", "ろくろ名人"]);
});

test("ランキング画面: 読み込めないときは再試行できる", async ({ page }) => {
  let fail = true;
  await page.route("**/api/leaderboard?**", (route) =>
    fail
      ? route.fulfill({ status: 503 })
      : route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ period: "daily", key: "k", count: 0, top: [] }),
        }),
  );
  await page.goto("/#/ranking");
  await expect(page.getByTestId("ranking-error")).toBeVisible();
  fail = false;
  await page.getByTestId("ranking-retry").click();
  await expect(page.getByTestId("ranking-empty")).toBeVisible();
});

test("参加しない設定なら送信せず、ランキング画面にも出ない", async ({ page }) => {
  await page.goto("/#/settings");
  const toggle = page.getByTestId("setting-leaderboard");
  await expect(toggle).toBeChecked();
  await toggle.uncheck({ force: true });

  await gotoState(page, deadDaily(), "/daily");
  await dragPiece(page, 0, 0, 0);
  await expect(page.getByTestId("gameover")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId("daily-rank")).toHaveCount(0);
  expect(leaderboardPosts(page).some((p) => p.path === "/api/daily/submit")).toBe(false);

  await page.goto("/#/ranking");
  await expect(page.getByTestId("ranking-me")).toContainText("not on the leaderboard");
});

test("ランキングに記録したことがあれば、データ削除でサーバの記録も消す", async ({ page }) => {
  await gotoState(page, deadDaily(), "/daily");
  await dragPiece(page, 0, 0, 0);
  await expect(page.getByTestId("daily-rank")).toContainText("#12");

  await page.goto("/#/settings");
  await page.getByTestId("reset").click();
  await page.getByTestId("dialog-confirm").click();
  await expect
    .poll(() => leaderboardPosts(page).some((p) => p.path === "/api/profile/delete"))
    .toBe(true);
});

test("ホームのデイリーカードからランキングへ", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("ranking-link").click();
  await expect(page.getByTestId("ranking-screen")).toBeVisible();
});
