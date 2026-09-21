/**
 * docs/06 §5 の E2E シナリオ: smoke / clear / gameover / resume / keyboard / reduced-motion。
 */
import { expect } from "@playwright/test";
import {
  almostDead,
  almostFullRow,
  dragPiece,
  expectEvent,
  gotoState,
  grabPiece,
  makeState,
  test,
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

  await expectEvent(page, (e) => e["event"] === "game_end" && e["reason"] === "over");

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

test("効果音: 置いた時と消えた時に音が出る(docs/10 §6)", async ({ page }) => {
  // 音そのものは聞けないので、Web Audio のノードが作られた数を数える。
  // BGM は OFF にしておく(鳴っていると数が増え続けて効果音と区別できない)。
  await page.addInitScript(() => {
    localStorage.setItem(
      "hamaru:v1:settings",
      JSON.stringify({
        schemaVersion: 1,
        data: {
          lang: "auto",
          theme: "auto",
          haptics: true,
          motion: "system",
          previewClears: true,
          music: false,
          sfx: true,
          leaderboard: false,
        },
      }),
    );
    const w = window as unknown as { __nodes?: number; __ctx?: AudioContext };
    w.__nodes = 0;
    const proto = AudioContext.prototype;
    const osc = proto.createOscillator;
    const buf = proto.createBufferSource;
    proto.createOscillator = function (this: AudioContext) {
      w.__nodes = (w.__nodes ?? 0) + 1;
      w.__ctx = this;
      return osc.call(this);
    };
    proto.createBufferSource = function (this: AudioContext) {
      w.__nodes = (w.__nodes ?? 0) + 1;
      w.__ctx = this;
      return buf.call(this);
    };
  });

  const nodes = (): Promise<number> =>
    page.evaluate(() => (window as unknown as { __nodes?: number }).__nodes ?? 0);
  const reset = (): Promise<void> =>
    page.evaluate(() => {
      (window as unknown as { __nodes: number }).__nodes = 0;
    });

  // (9,9) に 1 マス置くと「行 + 列」の 2 本が消える盤。(0,0) の 1 マスで全消しにはしない
  // (全消しは別の音なので、消える音そのものを見たい)。
  const board = almostFullRow();
  for (let y = 0; y < 9; y++) board[y * 10 + 9] = 2;
  const dot = { shapeId: "dot" };
  await gotoState(page, makeState({ board, tray: [dot, dot, dot] }), "/play");
  await waitForBoardLayout(page);
  await expect(page.getByTestId("sound")).toHaveAttribute("aria-pressed", "true");

  // 1 手目は「最初の操作」。ブラウザはここで初めて音を許すので、鳴らずに終わってよい。
  await dragPiece(page, 0, 0, 5);
  await expect
    .poll(
      () =>
        page.evaluate(() => (window as unknown as { __ctx?: AudioContext }).__ctx?.state ?? null),
      { timeout: 15_000 },
    )
    .toBe("running");

  // 消えない場所に置く → 置く音(短い単発)
  await reset();
  await dragPiece(page, 1, 2, 5);
  await expect.poll(nodes, { timeout: 15_000 }).toBeGreaterThan(0);
  const place = await nodes();

  // 行と列が同時に消える → 消える音は 2 音。置く音より音数が多い
  await reset();
  await dragPiece(page, 2, 9, 9);
  await expect(page.locator("#c-9-9")).toHaveAttribute("data-c", "0");
  await expect.poll(nodes, { timeout: 15_000 }).toBeGreaterThan(place);
});
