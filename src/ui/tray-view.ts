/**
 * トレイ(docs/01 §9.2、docs/03 §4)。3 等分、各スロットはピースを
 * 盤のセルの 0.6 倍で描く。スロットは `button`(docs/03 §9)。
 */
import { getShape } from "../core/shapes";
import type { Piece } from "../core/types";
import { t } from "../i18n";
import { el } from "./dom";

export const TRAY_SLOTS = 3;

export interface TrayView {
  root: HTMLElement;
  render(tray: ReadonlyArray<Piece | null>): void;
  slotEl(index: number): HTMLButtonElement | null;
  setDragging(index: number | null): void;
  setSelected(index: number | null): void;
  /** ゲームオーバー確定時、残ったピースを暗転させる(docs/03 §5)。 */
  markDead(): void;
  refreshLabels(): void;
}

export function createTrayView(): TrayView {
  const slots: HTMLButtonElement[] = [];
  const root = el("div", { class: "tray", "data-testid": "tray" });
  let currentTray: ReadonlyArray<Piece | null> = [null, null, null];

  for (let i = 0; i < TRAY_SLOTS; i++) {
    const slot = el("button", {
      type: "button",
      class: "slot",
      "data-slot": i,
      "data-testid": `slot-${i}`,
    });
    slots.push(slot);
    root.appendChild(slot);
  }

  function labelFor(index: number, piece: Piece | null): string {
    const shape = piece === null ? undefined : getShape(piece.shapeId);
    if (shape === undefined) return t("a11y.pieceEmpty", { n: index + 1 });
    return t("a11y.piece", {
      n: index + 1,
      w: shape.w,
      h: shape.h,
      cells: shape.cells.length,
    });
  }

  function paint(index: number, piece: Piece | null): void {
    const slot = slots[index];
    if (slot === undefined) return;
    slot.replaceChildren();
    slot.removeAttribute("data-dead");
    slot.setAttribute("aria-label", labelFor(index, piece));
    const shape = piece === null ? undefined : getShape(piece.shapeId);
    if (shape === undefined) {
      slot.disabled = true;
      slot.dataset["empty"] = "1";
      return;
    }
    slot.disabled = false;
    delete slot.dataset["empty"];

    const grid = el("div", { class: "slot__grid" });
    grid.style.gridTemplateColumns = `repeat(${shape.w}, calc(var(--unit) * 0.6))`;
    grid.style.gridTemplateRows = `repeat(${shape.h}, calc(var(--unit) * 0.6))`;
    const filled = new Set(shape.cells.map(([dx, dy]) => `${dx},${dy}`));
    for (let y = 0; y < shape.h; y++) {
      for (let x = 0; x < shape.w; x++) {
        grid.appendChild(
          el("div", {
            class: "cell",
            "data-c": filled.has(`${x},${y}`) ? String(shape.color) : "0",
          }),
        );
      }
    }
    slot.appendChild(grid);
  }

  return {
    root,

    render(tray) {
      currentTray = tray;
      for (let i = 0; i < TRAY_SLOTS; i++) paint(i, tray[i] ?? null);
    },

    slotEl: (index) => slots[index] ?? null,

    setDragging(index) {
      for (let i = 0; i < TRAY_SLOTS; i++) {
        const slot = slots[i];
        if (slot === undefined) continue;
        if (i === index) slot.dataset["dragging"] = "1";
        else delete slot.dataset["dragging"];
      }
    },

    setSelected(index) {
      for (let i = 0; i < TRAY_SLOTS; i++) {
        const slot = slots[i];
        if (slot === undefined) continue;
        if (i === index) slot.dataset["selected"] = "1";
        else delete slot.dataset["selected"];
      }
    },

    markDead() {
      for (let i = 0; i < TRAY_SLOTS; i++) {
        const slot = slots[i];
        if (slot === undefined || slot.dataset["empty"] === "1") continue;
        slot.dataset["dead"] = "1";
      }
    },

    refreshLabels() {
      for (let i = 0; i < TRAY_SLOTS; i++) {
        const slot = slots[i];
        if (slot === undefined) continue;
        slot.setAttribute("aria-label", labelFor(i, currentTray[i] ?? null));
      }
    },
  };
}
