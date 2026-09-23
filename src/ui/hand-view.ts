/**
 * 手持ち(docs/01 §9.2、docs/03 §4)。逆手の手持ちは**常に 1 個**。
 *
 * かけらの下に「熱」を出す。熱は最後に消してからの手数で、これが上がると
 * 次のかけらが大きくなる。プレイヤーが**今まさに何を作っているか**を見せる器。
 */
import type { Piece } from "../core/types";
import { t } from "../i18n";
import { el } from "./dom";

export interface HandView {
  root: HTMLElement;
  /** 手持ちのかけらと、次の大きさ(熱から決まる)を描く。 */
  render(piece: Piece, nextSize: number): void;
  slotEl(): HTMLButtonElement;
  setDragging(on: boolean): void;
  setSelected(on: boolean): void;
  /** ゲームオーバー確定時に暗転させる(docs/03 §5)。 */
  markDead(): void;
  refreshLabels(): void;
}

function pieceBounds(piece: Piece): { w: number; h: number } {
  let w = 0;
  let h = 0;
  for (const [x, y] of piece.cells) {
    if (x + 1 > w) w = x + 1;
    if (y + 1 > h) h = y + 1;
  }
  return { w, h };
}

export function createHandView(): HandView {
  const slot = el("button", { type: "button", class: "slot", "data-testid": "hand" });
  const gauge = el("div", { class: "heat", "data-testid": "heat" });
  const root = el("div", { class: "hand" }, [slot, gauge]);
  let current: Piece = { cells: [[0, 0]], color: 1 };
  let currentNext = 1;

  const label = (piece: Piece): string => {
    const { w, h } = pieceBounds(piece);
    return t("a11y.piece", { w, h, cells: piece.cells.length });
  };

  function paint(piece: Piece, nextSize: number): void {
    const { w, h } = pieceBounds(piece);
    slot.replaceChildren();
    slot.removeAttribute("data-dead");
    slot.setAttribute("aria-label", label(piece));
    const grid = el("div", { class: "slot__grid" });
    grid.style.gridTemplateColumns = `repeat(${w}, calc(var(--unit) * 0.7))`;
    grid.style.gridTemplateRows = `repeat(${h}, calc(var(--unit) * 0.7))`;
    const filled = new Set(piece.cells.map(([dx, dy]) => `${dx},${dy}`));
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        grid.appendChild(
          el("div", {
            class: "cell",
            "data-c": filled.has(`${x},${y}`) ? String(piece.color) : "0",
          }),
        );
      }
    }
    slot.appendChild(grid);

    // 次のかけらの大きさ(= 熱)。消すと 1 に戻る。
    gauge.replaceChildren(
      el("span", { class: "heat__label" }, [t("game.next")]),
      ...Array.from({ length: Math.max(1, nextSize) }, () => el("span", { class: "heat__pip" })),
    );
    gauge.setAttribute("aria-label", t("a11y.next", { n: nextSize }));
  }

  return {
    root,
    render(piece, nextSize) {
      current = piece;
      currentNext = nextSize;
      paint(piece, nextSize);
    },
    slotEl: () => slot,
    setDragging(on) {
      if (on) slot.dataset["dragging"] = "1";
      else delete slot.dataset["dragging"];
    },
    setSelected(on) {
      if (on) slot.dataset["selected"] = "1";
      else delete slot.dataset["selected"];
    },
    markDead() {
      slot.dataset["dead"] = "1";
    },
    refreshLabels() {
      paint(current, currentNext);
    },
  };
}
