/**
 * キーボード操作(docs/01 §8.2)。
 *
 * 逆手は手持ちが 1 個なので、**選ぶ操作が要らない**。
 * 矢印でカーソルを動かし、`Enter` / `Space` で置く。`Esc` でゴーストを消す。
 * 「置けません」は読み上げない(うるさいため)。配置成功と消去だけ `aria-live` で通知する。
 */
import type { Piece } from "../core/types";
import type { BoardView } from "./board-view";
import type { PlacementHost } from "./drag";
import type { HandView } from "./hand-view";

export interface KeyboardOptions {
  boardView: BoardView;
  handView: HandView;
  host: PlacementHost;
  previewClears: () => boolean;
  /** ドラッグ中はキーボード操作を無視する。 */
  isDragging: () => boolean;
}

export interface KeyboardController {
  destroy(): void;
  deselect(): void;
  /** カーソルを出しているか。 */
  active(): boolean;
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA" || target.isContentEditable;
}

function bounds(piece: Piece): { w: number; h: number } {
  let w = 0;
  let h = 0;
  for (const [x, y] of piece.cells) {
    if (x + 1 > w) w = x + 1;
    if (y + 1 > h) h = y + 1;
  }
  return { w, h };
}

export function createKeyboard(opts: KeyboardOptions): KeyboardController {
  const { boardView, handView, host } = opts;
  let active = false;
  let cursor = { x: 0, y: 0 };

  function held(): { w: number; h: number } | null {
    const piece = host.piece();
    return piece === null ? null : bounds(piece);
  }

  function clearVisuals(): void {
    boardView.clearGhost();
    boardView.setClearPreview([], []);
    boardView.setCursor(null);
    handView.setSelected(false);
  }

  function deselect(): void {
    active = false;
    clearVisuals();
  }

  function draw(): void {
    if (!active) return;
    const preview = host.preview(cursor.x, cursor.y);
    boardView.setCursor(cursor);
    handView.setSelected(true);
    if (preview.valid) {
      boardView.setGhost(preview.cells, preview.color);
      boardView.setClearPreview(
        opts.previewClears() ? preview.rows : [],
        opts.previewClears() ? preview.cols : [],
      );
    } else {
      boardView.clearGhost();
      boardView.setClearPreview([], []);
    }
  }

  /** カーソルを出す(最初の矢印キー / 手持ちのキーボードクリック)。 */
  function activate(): void {
    const dims = held();
    if (dims === null || !host.isPlaying()) return;
    active = true;
    cursor = {
      x: Math.max(0, Math.min(host.size - dims.w, cursor.x)),
      y: Math.max(0, Math.min(host.size - dims.h, cursor.y)),
    };
    draw();
  }

  function moveCursor(dx: number, dy: number): void {
    if (!active) {
      activate();
      return;
    }
    const dims = held();
    if (dims === null) return;
    cursor = {
      x: Math.max(0, Math.min(host.size - dims.w, cursor.x + dx)),
      y: Math.max(0, Math.min(host.size - dims.h, cursor.y + dy)),
    };
    draw();
  }

  function place(): void {
    if (!active) {
      activate();
      return;
    }
    const preview = host.preview(cursor.x, cursor.y);
    if (!preview.valid) return;
    deselect();
    host.commit(cursor.x, cursor.y, { dx: 0, dy: 0 });
  }

  function onKeyDown(ev: KeyboardEvent): void {
    if (isTypingTarget(ev.target) || opts.isDragging()) return;
    if (!host.isPlaying()) return;
    switch (ev.key) {
      case "ArrowLeft":
        ev.preventDefault();
        moveCursor(-1, 0);
        return;
      case "ArrowRight":
        ev.preventDefault();
        moveCursor(1, 0);
        return;
      case "ArrowUp":
        ev.preventDefault();
        moveCursor(0, -1);
        return;
      case "ArrowDown":
        ev.preventDefault();
        moveCursor(0, 1);
        return;
      case "Enter":
      case " ":
        ev.preventDefault();
        place();
        return;
      case "Escape":
        if (!active) return;
        ev.preventDefault();
        deselect();
        return;
      default:
        return;
    }
  }

  /** 手持ちの「キーボードによる」クリック(detail === 0)でカーソルを出す。 */
  function onHandClick(ev: MouseEvent): void {
    if (ev.detail !== 0) return;
    activate();
  }

  document.addEventListener("keydown", onKeyDown);
  handView.root.addEventListener("click", onHandClick);

  return {
    destroy() {
      document.removeEventListener("keydown", onKeyDown);
      handView.root.removeEventListener("click", onHandClick);
      clearVisuals();
    },
    deselect,
    active: () => active,
  };
}
