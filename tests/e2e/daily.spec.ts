/**
 * docs/06 §5 の `daily` シナリオ。
 * デイリー開始 → 終了 → 結果カード → 共有 → ホームに「達成」。
 */
import { expect, test } from "@playwright/test";
import { almostDead, dragPiece, gotoState, makeState, telemetryEvents } from "./helpers";

const deadDaily = () =>
  makeState({
    mode: "daily",
    board: almostDead(),
    tray: [{ shapeId: "dot" }, { shapeId: "sq2" }, { shapeId: "sq2" }],
    score: 3000,
    linesCleared: 12,
    longestStreak: 3,
    round: 9,
    moves: 40,
  });

test("daily: ホームから開始できる", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("daily-state")).toBeVisible();
  await page.getByTestId("daily-play").click();
  await expect(page.getByTestId("board")).toBeVisible();
  await expect(page.getByTestId("modetag")).toContainText("#");

  const events = await telemetryEvents(page);
  const start = events.find((e) => e["event"] === "game_start");
  expect(start?.["mode"]).toBe("daily");
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
  await dragPiece(page, 0, 0, 0);

  const overlay = page.getByTestId("gameover");
  await expect(overlay).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId("final-score")).toHaveText("3,001");
  await overlay.getByTestId("share").click();

  const shared = await page.evaluate(() => (window as unknown as { __shared?: string }).__shared);
  expect(shared).toContain("HAMARU Daily #");
  expect(shared).toContain("3,001 pts · 12 lines");
  expect(shared).toMatch(/[▓░]{10}/);

  const events = await telemetryEvents(page);
  expect(events.some((e) => e["event"] === "daily_result")).toBe(true);
  expect(events.some((e) => e["event"] === "share" && e["method"] === "share")).toBe(true);

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
  await dragPiece(page, 0, 0, 0);
  const overlay = page.getByTestId("gameover");
  await expect(overlay).toBeVisible({ timeout: 10_000 });
  await overlay.getByTestId("share").click();

  await expect(page.getByTestId("toast")).toBeVisible();
  const copied = await page.evaluate(() => (window as unknown as { __copied?: string }).__copied);
  expect(copied).toContain("HAMARU Daily #");

  const events = await telemetryEvents(page);
  expect(events.some((e) => e["event"] === "share" && e["method"] === "copy")).toBe(true);
});

test("daily: 達成後は練習で再挑戦でき、記録は上書きしない", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: async () => undefined,
    });
  });
  await gotoState(page, deadDaily(), "/daily");
  await dragPiece(page, 0, 0, 0);
  const overlay = page.getByTestId("gameover");
  await expect(overlay).toBeVisible({ timeout: 10_000 });
  await overlay.getByTestId("practice").click();

  await expect(page.getByTestId("modetag")).toContainText("Practice");
  await expect(page.getByTestId("score")).toHaveText("0");

  // 練習は公式記録を書き換えない。
  const stored = await page.evaluate(() => localStorage.getItem("hamaru:v1:daily:results"));
  expect(stored).toContain('"score":3001');
});
