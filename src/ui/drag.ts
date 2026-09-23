/**
 * ポインタ入力(docs/01 §8.1)。**Pointer Events のみ**を使う。
 *
 * - 手持ちのかけらを `pointerdown` で掴み、`setPointerCapture` で 1 本目の指に固定する。
 * - タッチ時は指の `config.input.touchLiftOffset` px 上に持ち上げ、
 *   手持ち表示(0.7 倍)から盤のセルサイズへ 120ms で拡大する。マウスはオフセット 0。
 * - スナップ先は**かけらのバウンディングボックス左上に最も近い盤セル**(docs/01 §14 N-1)。
 * - 置けるならゴースト、さらに消える行 / 列をハイライト(`config.input.previewClears`)。
 * - 盤外 / 置けない位置でのドロップ、`pointercancel`、タブ非表示、画面回転はキャンセル。
 */
import type { Cell, Piece, ResolvedConfig } from "../core/types";
import type { BoardView } from "./board-view";
import type { HandView } from "./hand-view";
import { el } from "./dom";

export interface PlacementPreview {
  valid: boolean;
  cells: Array<[number, number]>;
  color: Cell;
  rows: number[];
  cols: number[];
}

/** ゲーム画面が提供する「置く」ための最小の窓口。drag と keyboard が共有する。 */
export interface PlacementHost {
  size: number;
  isPlaying(): boolean;
  /** いま手に持っているかけら(逆手は常に 1 個)。 */
  piece(): Piece | null;
  preview(x: number, y: number): PlacementPreview;
  commit(x: number, y: number, delta: { dx: number; dy: number }): void;
}

export interface DragOptions {
  boardView: BoardView;
  handView: HandView;
  host: PlacementHost;
  config: ResolvedConfig;
  reduced: () => boolean;
  previewClears: () => boolean;
}

export interface DragController {
  destroy(): void;
  /** ドラッグ中なら中断して手持ちへ戻す。 */
  cancel(): void;
  isDragging(): boolean;
}

interface DragState {
  pointerId: number;
  node: HTMLElement;
  inner: HTMLElement;
  width: number;
  height: number;
  lift: number;
  originSlot: HTMLElement;
  target: { x: number; y: number } | null;
  left: number;
  top: number;
}

export function createDrag(opts: DragOptions): DragController {
  const { boardView, handView, host, config } = opts;
  const layer = el("div", { class: "draglayer", "aria-hidden": "true" });
  document.body.appendChild(layer);

  let drag: DragState | null = null;

  function bounds(piece: Piece): { w: number; h: number } {
    let w = 0;
    let h = 0;
    for (const [x, y] of piece.cells) {
      if (x + 1 > w) w = x + 1;
      if (y + 1 > h) h = y + 1;
    }
    return { w, h };
  }

  function buildPiece(piece: Piece): { node: HTMLElement; inner: HTMLElement } {
    const shape = { ...bounds(piece), cells: piece.cells, color: piece.color };
    const inner = el("div", { class: "dragpiece__grid" });
    inner.style.gridTemplateColumns = `repeat(${shape.w}, var(--unit))`;
    inner.style.gridTemplateRows = `repeat(${shape.h}, var(--unit))`;
    const filled = new Set(shape.cells.map(([dx, dy]) => `${dx},${dy}`));
    for (let y = 0; y < shape.h; y++) {
      for (let x = 0; x < shape.w; x++) {
        inner.appendChild(
          el("div", {
            class: "cell",
            "data-c": filled.has(`${x},${y}`) ? String(shape.color) : "0",
          }),
        );
      }
    }
    const node = el("div", { class: "dragpiece", "data-testid": "dragpiece" }, [inner]);
    return { node, inner };
  }

  function updatePreview(): void {
    if (drag === null) return;
    const shape = heldBounds();
    if (shape === null) return;
    const cell = boardView.pointToCell(drag.left, drag.top);
    const inRange =
      cell.x >= 0 && cell.y >= 0 && cell.x + shape.w <= host.size && cell.y + shape.h <= host.size;
    const preview = inRange
      ? host.preview(cell.x, cell.y)
      : { valid: false, cells: [], color: 0 as Cell, rows: [], cols: [] };

    if (preview.valid) {
      drag.target = cell;
      boardView.setGhost(preview.cells, preview.color);
      boardView.setClearPreview(
        opts.previewClears() ? preview.rows : [],
        opts.previewClears() ? preview.cols : [],
      );
    } else {
      drag.target = null;
      boardView.clearGhost();
      boardView.setClearPreview([], []);
    }
  }

  function heldBounds(): { w: number; h: number } | null {
    const piece = host.piece();
    return piece === null ? null : bounds(piece);
  }

  function move(clientX: number, clientY: number): void {
    if (drag === null) return;
    drag.left = clientX - drag.width / 2;
    drag.top = clientY - drag.height / 2 - drag.lift;
    drag.node.style.transform = `translate(${drag.left}px, ${drag.top}px)`;
    updatePreview();
  }

  function cleanup(): void {
    if (drag === null) return;
    const current = drag;
    drag = null;
    boardView.clearGhost();
    boardView.setClearPreview([], []);
    handView.setDragging(false);
    current.node.remove();
  }

  /** 手元へ 180ms で戻す(docs/03 §5)。 */
  function returnToHand(): void {
    if (drag === null) return;
    const current = drag;
    const slotRect = current.originSlot.getBoundingClientRect();
    const endLeft = slotRect.left + slotRect.width / 2 - current.width / 2;
    const endTop = slotRect.top + slotRect.height / 2 - current.height / 2;
    drag = null;
    boardView.clearGhost();
    boardView.setClearPreview([], []);

    const finish = (): void => {
      current.node.remove();
      handView.setDragging(false);
    };

    if (opts.reduced() || typeof current.node.animate !== "function") {
      finish();
      return;
    }
    const anim = current.node.animate(
      [
        { transform: `translate(${current.left}px, ${current.top}px)` },
        { transform: `translate(${endLeft}px, ${endTop}px)` },
      ],
      { duration: 180, easing: "cubic-bezier(0.45, 0.05, 0.55, 0.95)" },
    );
    current.inner.animate([{ transform: "scale(1)" }, { transform: "scale(0.7)" }], {
      duration: 180,
      easing: "cubic-bezier(0.45, 0.05, 0.55, 0.95)",
    });
    anim.addEventListener("finish", finish);
    anim.addEventListener("cancel", finish);
  }

  function onPointerDown(ev: PointerEvent): void {
    if (drag !== null) return; // 二本目の指は無視(docs/01 §13)
    if (!host.isPlaying()) return;
    const target = ev.target;
    if (!(target instanceof Element)) return;
    const slot = target.closest<HTMLElement>(".slot");
    if (slot === null) return;
    const piece = host.piece();
    if (piece === null) return;
    const built = buildPiece(piece);

    ev.preventDefault();
    const shape = bounds(piece);
    const m = boardView.metrics();
    const width = shape.w * m.unit + (shape.w - 1) * (m.pitch - m.unit);
    const height = shape.h * m.unit + (shape.h - 1) * (m.pitch - m.unit);
    const lift = ev.pointerType === "touch" ? config.input.touchLiftOffset : 0;

    layer.appendChild(built.node);
    handView.setDragging(true);
    handView.setSelected(false);

    drag = {
      pointerId: ev.pointerId,
      node: built.node,
      inner: built.inner,
      width,
      height,
      lift,
      originSlot: slot,
      target: null,
      left: 0,
      top: 0,
    };

    try {
      slot.setPointerCapture(ev.pointerId);
    } catch {
      /* 捕捉できない環境でも document のリスナで拾える */
    }

    // 持ち上げ: 手元の縮尺 0.7 → 1.0(docs/03 §5)
    if (!opts.reduced() && typeof built.inner.animate === "function") {
      built.inner.animate([{ transform: "scale(0.7)" }, { transform: "scale(1)" }], {
        duration: 120,
        easing: "cubic-bezier(0.22, 0.61, 0.36, 1)",
      });
    }
    move(ev.clientX, ev.clientY);
  }

  function onPointerMove(ev: PointerEvent): void {
    if (drag === null || ev.pointerId !== drag.pointerId) return;
    ev.preventDefault();
    move(ev.clientX, ev.clientY);
  }

  function onPointerUp(ev: PointerEvent): void {
    if (drag === null || ev.pointerId !== drag.pointerId) return;
    const current = drag;
    const target = current.target;
    if (target === null) {
      returnToHand();
      return;
    }
    // 着地セルとのずれ(吸着演出用)。
    const offset = boardView.cellOffset(target.x, target.y);
    const rootRect = boardView.root.getBoundingClientRect();
    const delta = {
      dx: current.left - (rootRect.left + offset.left),
      dy: current.top - (rootRect.top + offset.top),
    };
    cleanup();
    host.commit(target.x, target.y, delta);
  }

  function onPointerCancel(ev: PointerEvent): void {
    if (drag === null || ev.pointerId !== drag.pointerId) return;
    returnToHand();
  }

  const onVisibility = (): void => {
    if (document.visibilityState === "hidden") returnToHand();
  };
  const onResize = (): void => returnToHand();

  handView.root.addEventListener("pointerdown", onPointerDown);
  document.addEventListener("pointermove", onPointerMove, { passive: false });
  document.addEventListener("pointerup", onPointerUp);
  document.addEventListener("pointercancel", onPointerCancel);
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("resize", onResize);
  window.addEventListener("orientationchange", onResize);

  return {
    destroy() {
      returnToHand();
      handView.root.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("pointerup", onPointerUp);
      document.removeEventListener("pointercancel", onPointerCancel);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
      layer.remove();
    },
    cancel: returnToHand,
    isDragging: () => drag !== null,
  };
}
