/**
 * docs/06 §5 の `daily` シナリオ。
 * デイリー開始 → 終了 → 結果カード → 共有 → ホームに「達成」。
 */
import { expect } from "@playwright/test";
import { almostDead, dragPiece, expectEvent, gotoState, makeState, test } from "./helpers";

const deadDaily = () =>
  makeState({
    mode: "daily",
    board: almostDead(),
    piece: { cells: [[0, 0]], color: 2 },
    heat: 2, // 次のかけらは 2 マス → 飛び飛びの空きには置けない = この 1 手で終わる
    score: 3000,
    linesCleared: 12,
    longestStreak: 3,
    moves: 40,
  });

test("daily: ホームから開始できる", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("daily-state")).toBeVisible();
  await page.getByTestId("daily-play").click();
  await expect(page.getByTestId("board")).toBeVisible();
  // 通算番号は epoch(2026-10-01)より前の日は出ない(docs/01 §14 N-8)ので、ラベルだけを見る。
  await expect(page.getByTestId("modetag")).toContainText("Today's challenge");

  const start = await expectEvent(page, (e) => e["event"] === "game_start");
  expect(start["mode"]).toBe("daily");
});

test("daily: 終了 → 共有(share)→ ホームに達成が出る", async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { __shared?: string };
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: async (data: { text?: string }) => {
        w.__shared = data.text ?? "";
      },
    });
  });

  await gotoState(page, deadDaily(), "/daily");
  await dragPiece(page, 5, 5);

  const overlay = page.getByTestId("gameover");
  await expect(overlay).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId("final-score")).toHaveText("3,001");
  await overlay.getByTestId("share").click();

  const shared = await page.evaluate(() => (window as unknown as { __shared?: string }).__shared);
  expect(shared).toMatch(/^HAMARU Daily( #\d+)? \(\d{4}-\d{2}-\d{2}\)/);
  expect(shared).toContain("3,001 pts · 12 lines");
  expect(shared).toMatch(/[▓░]{10}/);

  await expectEvent(page, (e) => e["event"] === "daily_result");
  await expectEvent(page, (e) => e["event"] === "share" && e["method"] === "share");

  await overlay.getByTestId("over-home").click();
  await expect(page.getByTestId("daily-state")).toHaveText(/3,001/);
  await expect(page.getByTestId("daily-streak")).toBeVisible();
});

test("daily: navigator.share が無ければクリップボードにコピーしてトーストを出す", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const w = window as unknown as { __copied?: string };
    Object.defineProperty(navigator, "share", { configurable: true, value: undefined });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          w.__copied = text;
        },
      },
    });
  });

  await gotoState(page, deadDaily(), "/daily");
  await dragPiece(page, 5, 5);
  const overlay = page.getByTestId("gameover");
  await expect(overlay).toBeVisible({ timeout: 10_000 });
  await overlay.getByTestId("share").click();

  await expect(page.getByTestId("toast")).toBeVisible();
  const copied = await page.evaluate(() => (window as unknown as { __copied?: string }).__copied);
  expect(copied).toMatch(/^HAMARU Daily( #\d+)? \(\d{4}-\d{2}-\d{2}\)/);

  await expectEvent(page, (e) => e["event"] === "share" && e["method"] === "copy");
});

test("daily: 達成後も何度でも挑戦でき、記録はその日のベストになる(docs/08 §1)", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: async () => undefined,
    });
  });
  await gotoState(page, deadDaily(), "/daily");
  await dragPiece(page, 5, 5);
  const overlay = page.getByTestId("gameover");
  await expect(overlay).toBeVisible({ timeout: 10_000 });

  // 3001 点で 1 回目。ベストと挑戦回数が出る
  await expect(overlay.getByTestId("daily-best")).toContainText("1");
  const first = await page.evaluate(() => localStorage.getItem("hamaru:v1:daily:results"));
  expect(first).toContain('"score":3001');
  expect(first).toContain('"attempts":1');

  // もう一度挑戦する。練習ではなく、これも公式
  await overlay.getByTestId("retry-daily").click();
  await expect(page.getByTestId("modetag")).not.toContainText("Practice");
  await expect(page.getByTestId("score")).toHaveText("0");

  // 遊び直しても、その日のベストは残っている(更新は saveDailyResult の単体テスト)
  await dragPiece(page, 5, 5);
  const stored = await page.evaluate(() => localStorage.getItem("hamaru:v1:daily:results"));
  expect(stored).toContain('"score":3001');
});
