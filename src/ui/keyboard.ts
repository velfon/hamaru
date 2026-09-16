/**
 * キーボード操作(docs/01 §8.2)。
 *
 * `1` `2` `3` でトレイ選択、矢印で盤上のカーソル移動(ピースの左上基準)、
 * `Enter` / `Space` で配置、`Esc` で選択解除。選択中はゴーストを出す。
 * 「置けません」は読み上げない(うるさいため)。配置成功と消去だけ `aria-live` で通知する。
 */
import { getShape } from "../core/shapes";
import type { BoardView } from "./board-view";
import type { PlacementHost } from "./drag";
import type { TrayView } from "./tray-view";

export interface KeyboardOptions {
  boardView: BoardView;
  trayView: TrayView;
  host: PlacementHost;
  previewClears: () => boolean;
  /** ドラッグ中はキーボード操作を無視する。 */
  isDragging: () => boolean;
}

export interface KeyboardController {
  destroy(): void;
  deselect(): void;
  selected(): number | null;
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA" || target.isContentEditable;
}

export function createKeyboard(opts: KeyboardOptions): KeyboardController {
  const { boardView, trayView, host } = opts;
  let selected: number | null = null;
  let cursor = { x: 0, y: 0 };

  function size(index: number): { w: number; h: number } | null {
    const piece = host.pieceAt(index);
    if (piece === null) return null;
    const shape = getShape(piece.shapeId);
    return shape === undefined ? null : { w: shape.w, h: shape.h };
  }

  function clearVisuals(): void {
    boardView.clearGhost();
    boardView.setClearPreview([], []);
    boardView.setCursor(null);
    trayView.setSelected(null);
  }

  function deselect(): void {
    selected = null;
    clearVisuals();
  }

  function draw(): void {
    if (selected === null) return;
    const preview = host.preview(selected, cursor.x, cursor.y);
    boardView.setCursor(cursor);
    trayView.setSelected(selected);
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

  function select(index: number): void {
    const dims = size(index);
    if (dims === null || !host.isPlaying()) return;
    selected = index;
    cursor = {
      x: Math.min(cursor.x, host.size - dims.w),
      y: Math.min(cursor.y, host.size - dims.h),
    };
    draw();
  }

  function moveCursor(dx: number, dy: number): void {
    if (selected === null) return;
    const dims = size(selected);
    if (dims === null) return;
    cursor = {
      x: Math.max(0, Math.min(host.size - dims.w, cursor.x + dx)),
      y: Math.max(0, Math.min(host.size - dims.h, cursor.y + dy)),
    };
    draw();
  }

  function place(): void {
    if (selected === null) return;
    const preview = host.preview(selected, cursor.x, cursor.y);
    if (!preview.valid) return;
    const index = selected;
    deselect();
    host.commit(index, cursor.x, cursor.y, { dx: 0, dy: 0 });
  }

  function onKeyDown(ev: KeyboardEvent): void {
    if (isTypingTarget(ev.target) || opts.isDragging()) return;
    if (!host.isPlaying()) return;
    switch (ev.key) {
      case "1":
      case "2":
      case "3":
        ev.preventDefault();
        select(Number(ev.key) - 1);
        return;
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
        if (selected === null) return;
        ev.preventDefault();
        place();
        return;
      case "Escape":
        if (selected === null) return;
        ev.preventDefault();
        deselect();
        return;
      default:
        return;
    }
  }

  /** スロットの「キーボードによる」クリック(detail === 0)だけを選択として扱う。 */
  function onTrayClick(ev: MouseEvent): void {
    if (ev.detail !== 0) return;
    const target = ev.target;
    if (!(target instanceof Element)) return;
    const slot = target.closest<HTMLElement>(".slot");
    if (slot === null) return;
    select(Number(slot.dataset["slot"]));
  }

  document.addEventListener("keydown", onKeyDown);
  trayView.root.addEventListener("click", onTrayClick);

  return {
    destroy() {
      document.removeEventListener("keydown", onKeyDown);
      trayView.root.removeEventListener("click", onTrayClick);
      clearVisuals();
    },
    deselect,
    selected: () => selected,
  };
}
