/**
 * E2E の共通処理。
 *
 * 状態の差し込みは `?state=<serialize(GameState) を URI エンコードしたもの>`
 * (開発ビルドのみ。docs/06 §5)。テスト側は core をそのまま import して作るので、
 * 「テスト用のダミー直列化」を二重に持たなくて済む。
 */
import { test as base, type BrowserContext, type Page } from "@playwright/test";
import { batchSchema } from "../../worker/schema";
import { serialize } from "../../src/core/game";
import type { GameState, Mode, Piece } from "../../src/core/types";

export interface StateOptions {
  mode?: Mode;
  board?: Uint8Array;
  tray?: Array<Piece | null>;
  score?: number;
  size?: number;
  streak?: number;
  longestStreak?: number;
  round?: number;
  moves?: number;
  linesCleared?: number;
}

export function makeState(options: StateOptions = {}): GameState {
  const size = options.size ?? 10;
  return {
    version: 1,
    mode: options.mode ?? "endless",
    seed: options.mode === "daily" ? "daily:test" : "endless:test:1",
    rng: 12345,
    size,
    board: options.board ?? new Uint8Array(size * size),
    tray: options.tray ?? [{ shapeId: "dot" }, { shapeId: "h3" }, { shapeId: "sq2" }],
    score: options.score ?? 0,
    streak: options.streak ?? 0,
    longestStreak: options.longestStreak ?? 0,
    round: options.round ?? 1,
    moves: options.moves ?? 0,
    linesCleared: options.linesCleared ?? 0,
    status: "playing",
    startedAt: 1_760_000_000_000,
  };
}

/**
 * 盤: 下段を 9 マス埋め、(9,9) に 1 マス置けば 1 列消える状態。
 * `leaveTile`(既定 true)で (0,0) に 1 マス残し、**全消しにはならない**ようにする
 * (全消しは +300 の別の演出なので、消去そのものの検証と分ける)。
 */
export function almostFullRow(size = 10, leaveTile = true): Uint8Array {
  const board = new Uint8Array(size * size);
  for (let x = 0; x < size - 1; x++) board[(size - 1) * size + x] = 2;
  if (leaveTile) board[0] = 4;
  return board;
}

/**
 * 盤: 各行 / 列に 2 マスずつ穴が空いた「あと 1 手で詰み」の状態。
 * 完成する行・列が無いので、dot を置いても消えずにゲームオーバーへ進む。
 */
export function almostDead(size = 10): Uint8Array {
  const board = new Uint8Array(size * size).fill(2);
  for (let y = 0; y < size; y++) {
    board[y * size + y] = 0;
    board[y * size + ((y + 1) % size)] = 0;
  }
  return board;
}

export function stateUrl(state: GameState, hash: string): string {
  return `/?state=${encodeURIComponent(serialize(state))}#${hash}`;
}

export async function gotoState(page: Page, state: GameState, hash: string): Promise<void> {
  await page.goto(stateUrl(state, hash));
  await page.getByTestId("board").waitFor();
}

/** スロットのピースのバウンディングボックス(セル数)。 */
async function pieceSize(page: Page, slot: number): Promise<{ w: number; h: number }> {
  return page.evaluate((index) => {
    const grid = document.querySelector(`[data-testid="slot-${index}"] .slot__grid`);
    if (grid === null) return { w: 0, h: 0 };
    const style = getComputedStyle(grid);
    return {
      w: style.gridTemplateColumns.split(" ").length,
      h: style.gridTemplateRows.split(" ").length,
    };
  }, slot);
}

/*
 * ドラッグ中のピースは「中心がポインタに追従する」ので、着地セル群の中心を狙う。
 * すべてのプロジェクトで `page.mouse` を使う(モバイル端末エミュレーションでも
 * Pointer Events は発火する。タッチ持ち上げオフセットは pointerType 依存なので
 * ここでは 0 のまま動く。docs/06 §9 N-8)。
 */

/** CSS / Web フォントが効いた実寸になるまで待つ(dev サーバの初回起動対策)。 */
export async function waitForBoardLayout(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const cell = document.querySelector("#c-0-0");
    return cell !== null && cell.getBoundingClientRect().width > 8;
  });
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
}

/**
 * ピースを掴んで (x, y) の上まで運ぶ。戻り値を呼ぶと離す。
 * 各段階で**アプリ側の状態**(ドラッグ中のピース / ゴースト)を待ってから次へ進むので、
 * 実行環境が遅くてもタイミングで落ちない。
 */
export async function grabPiece(
  page: Page,
  slot: number,
  x: number,
  y: number,
): Promise<() => Promise<void>> {
  await waitForBoardLayout(page);
  const { w, h } = await pieceSize(page, slot);
  const from = await page.getByTestId(`slot-${slot}`).boundingBox();
  const first = await page.locator(`#c-${x}-${y}`).boundingBox();
  const last = await page.locator(`#c-${x + w - 1}-${y + h - 1}`).boundingBox();
  if (from === null || first === null || last === null) {
    throw new Error(`ドラッグ対象が見つかりません: slot=${slot} (${x},${y})`);
  }
  const target = {
    x: (first.x + last.x + last.width) / 2,
    y: (first.y + last.y + last.height) / 2,
  };
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  // 掴めたこと(ドラッグ中のピースが出たこと)を確認してから運ぶ。
  await page.locator(".dragpiece").waitFor({ state: "attached" });
  await page.mouse.move(target.x, target.y, { steps: 8 });
  // 置ける位置だとアプリが判断した(= ゴーストが出た)ことを確認する。
  await page.locator("[data-ghost]").first().waitFor({ state: "attached" });

  return async () => {
    await page.mouse.up();
    await page.locator(".dragpiece").waitFor({ state: "detached" });
  };
}

/**
 * トレイのピースを盤の (x, y)(= バウンディングボックスの左上)へドラッグして置く。
 */
export async function dragPiece(page: Page, slot: number, x: number, y: number): Promise<void> {
  const drop = await grabPiece(page, slot, x, y);
  await drop();
}

/*
 * テレメトリの捕捉(docs/06 §5 `telemetry`、docs/04 §9)。
 *
 * すべてのテストで `POST /api/events` を横取りし、本文を **Worker と同じ zod スキーマ**で
 * 検証してから 204 を返す。1 件でもスキーマ違反があればそのテストを失敗させる。
 * dev サーバには Worker が無いので、横取りしないと送信失敗 → localStorage 退避になり、
 * テストごとに状態が変わってしまう。
 */
interface Captured {
  events: Array<Record<string, unknown>>;
  invalid: string[];
}

const captured = new WeakMap<BrowserContext, Captured>();

export const test = base.extend<{ telemetryCapture: Captured }>({
  telemetryCapture: [
    async ({ context, browserName }, use) => {
      const box: Captured = { events: [], invalid: [] };
      captured.set(context, box);
      if (browserName === "webkit") {
        // WebKit では sendBeacon の Blob 本文を Playwright が読めない(postData() が null)。
        // WebKit だけ sendBeacon を「使えない」扱いにし、fetch(keepalive)経路で送らせる。
        // Chromium は sendBeacon 経路のまま検証する(docs/06 §9 N-9)。
        await context.addInitScript(() => {
          Object.defineProperty(navigator, "sendBeacon", {
            configurable: true,
            value: () => false,
          });
        });
      }
      await context.route("**/api/events", async (route) => {
        const request = route.request();
        let body: unknown = null;
        try {
          body = JSON.parse(request.postData() ?? "");
        } catch {
          box.invalid.push("JSON ではない本文");
        }
        const parsed = batchSchema.safeParse(body);
        if (parsed.success) {
          box.events.push(...(parsed.data.events as Array<Record<string, unknown>>));
          await route.fulfill({ status: 204 });
        } else {
          box.invalid.push(parsed.error.message);
          await route.fulfill({ status: 400 });
        }
      });
      await use(box);
      if (box.invalid.length > 0) {
        throw new Error(`/api/events にスキーマ違反の送信がありました:\n${box.invalid.join("\n")}`);
      }
    },
    { auto: true },
  ],
});

/** 送信済み(捕捉したもの)+ 未送信のメモリ内キュー。 */
export async function telemetryEvents(page: Page): Promise<Array<Record<string, unknown>>> {
  const queued = await page.evaluate(() => {
    const api = (window as unknown as { __hamaru?: { telemetry: () => unknown[] } }).__hamaru;
    return (api?.telemetry() ?? []) as Array<Record<string, unknown>>;
  });
  return [...(captured.get(page.context())?.events ?? []), ...queued];
}

/** 送信済みのイベント(`/api/events` に実際に届いたもの)だけ。 */
export function sentEvents(page: Page): Array<Record<string, unknown>> {
  return captured.get(page.context())?.events ?? [];
}

/** 条件を満たすイベントが(送信は非同期なので)現れるまで待つ。 */
export async function expectEvent(
  page: Page,
  predicate: (e: Record<string, unknown>) => boolean,
): Promise<Record<string, unknown>> {
  await base.expect.poll(async () => (await telemetryEvents(page)).some(predicate)).toBe(true);
  const found = (await telemetryEvents(page)).find(predicate);
  if (found === undefined) throw new Error("unreachable");
  return found;
}
