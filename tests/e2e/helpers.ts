/**
 * E2E の共通処理。
 *
 * 状態の差し込みは `?state=<serialize(GameState) を URI エンコードしたもの>`
 * (開発ビルドのみ。docs/06 §5)。テスト側は core をそのまま import して作るので、
 * 「テスト用のダミー直列化」を二重に持たなくて済む。
 */
import type { Page } from "@playwright/test";
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

/**
 * トレイのピースを盤の (x, y)(= バウンディングボックスの左上)へドラッグする。
 * ドラッグ中のピースは「中心がポインタに追従する」ので、着地セル群の中心を狙う。
 *
 * すべてのプロジェクトで `page.mouse` を使う(モバイル端末エミュレーションでも
 * Pointer Events は発火する。タッチ持ち上げオフセットは pointerType 依存なので
 * ここでは 0 のまま動く)。
 */
export async function dragPiece(page: Page, slot: number, x: number, y: number): Promise<void> {
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
  await page.mouse.move(target.x, target.y, { steps: 8 });
  await page.mouse.up();
}

/** テレメトリのメモリ内キュー(開発ビルドのみ公開。M4 で送信になる)。 */
export async function telemetryEvents(page: Page): Promise<Array<Record<string, unknown>>> {
  return page.evaluate(() => {
    const api = (window as unknown as { __hamaru?: { telemetry: () => unknown[] } }).__hamaru;
    return (api?.telemetry() ?? []) as Array<Record<string, unknown>>;
  });
}
