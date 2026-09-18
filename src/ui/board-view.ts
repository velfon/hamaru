/**
 * 盤の描画と差分更新(docs/02 §5)。
 *
 * - セルは初期化時に size×size 個作り、以後は `data-c` 属性だけを書き換える。
 * - プレビュー(ゴースト・消去予告・キーボードカーソル)は同じセルの
 *   `data-ghost` / `data-preview` / `data-cursor` 属性で表す(2 レイヤ相当)。
 * - 幾何(セルの実寸)は CSS が決めるので、必要なときに DOM から測って返す。
 */
import type { Board, Cell } from "../core/types";
import { t } from "../i18n";
import { el } from "./dom";

export interface BoardMetrics {
  /** セル (0,0) の左上(ビューポート座標)。 */
  originX: number;
  originY: number;
  /** セルの一辺(px)。 */
  unit: number;
  /** セル間の中心距離(セル + 目地)。 */
  pitch: number;
}

export interface BoardView {
  /** 盤 + 演出レイヤを含む外側要素。 */
  root: HTMLElement;
  boardEl: HTMLElement;
  fxLayer: HTMLElement;
  size: number;
  render(board: Board): void;
  cellEl(x: number, y: number): HTMLElement | null;
  setGhost(cells: ReadonlyArray<readonly [number, number]>, color: Cell): void;
  clearGhost(): void;
  setClearPreview(rows: readonly number[], cols: readonly number[]): void;
  setCursor(pos: { x: number; y: number } | null): void;
  metrics(): BoardMetrics;
  /** boardwrap 内の相対座標(演出レイヤ用)。 */
  cellOffset(x: number, y: number): { left: number; top: number };
  /** 画面座標 → 盤座標(四捨五入。盤外でも返す)。 */
  pointToCell(clientX: number, clientY: number): { x: number; y: number };
  refreshLabels(): void;
}

export function createBoardView(size: number): BoardView {
  const cells: HTMLElement[] = [];
  const shadow = new Uint8Array(size * size).fill(255);

  const boardEl = el("div", {
    class: "board",
    role: "grid",
    "aria-label": t("a11y.board"),
    "data-testid": "board",
  });

  for (let y = 0; y < size; y++) {
    const row = el("div", { class: "board__row", role: "row" });
    for (let x = 0; x < size; x++) {
      const cell = el("div", {
        class: "cell",
        role: "gridcell",
        id: `c-${x}-${y}`,
        "data-c": "0",
        "data-x": x,
        "data-y": y,
      });
      cells.push(cell);
      row.appendChild(cell);
    }
    boardEl.appendChild(row);
  }

  const fxLayer = el("div", { class: "fxlayer", "aria-hidden": "true" });
  const root = el("div", { class: "boardwrap" }, [boardEl, fxLayer]);

  let ghostCells: HTMLElement[] = [];
  let previewCells: HTMLElement[] = [];
  let cursorCell: HTMLElement | null = null;

  function at(x: number, y: number): HTMLElement | null {
    if (x < 0 || y < 0 || x >= size || y >= size) return null;
    return cells[y * size + x] ?? null;
  }

  function label(x: number, y: number, value: number): string {
    return t("a11y.cell", {
      row: y + 1,
      col: x + 1,
      state:
        value === 0
          ? t("a11y.cell.empty")
          : value === 7
            ? t("a11y.cell.obstacle")
            : t("a11y.cell.filled"),
    });
  }

  function metrics(): BoardMetrics {
    const first = cells[0];
    const second = cells[1];
    if (first === undefined || second === undefined) {
      return { originX: 0, originY: 0, unit: 0, pitch: 0 };
    }
    const a = first.getBoundingClientRect();
    const b = second.getBoundingClientRect();
    const pitch = b.left - a.left;
    return { originX: a.left, originY: a.top, unit: a.width, pitch: pitch > 0 ? pitch : a.width };
  }

  return {
    root,
    boardEl,
    fxLayer,
    size,

    render(board) {
      for (let i = 0; i < cells.length; i++) {
        const value = (board[i] ?? 0) as number;
        if (shadow[i] === value) continue;
        shadow[i] = value;
        const cell = cells[i];
        if (cell === undefined) continue;
        cell.dataset["c"] = String(value);
        cell.setAttribute("aria-label", label(i % size, Math.floor(i / size), value));
      }
    },

    refreshLabels() {
      for (let i = 0; i < cells.length; i++) {
        const cell = cells[i];
        if (cell === undefined) continue;
        cell.setAttribute("aria-label", label(i % size, Math.floor(i / size), shadow[i] ?? 0));
      }
      boardEl.setAttribute("aria-label", t("a11y.board"));
    },

    cellEl: at,

    setGhost(cellsAt, color) {
      this.clearGhost();
      for (const [x, y] of cellsAt) {
        const cell = at(x, y);
        if (cell === null) continue;
        cell.dataset["ghost"] = String(color);
        ghostCells.push(cell);
      }
    },

    clearGhost() {
      for (const cell of ghostCells) delete cell.dataset["ghost"];
      ghostCells = [];
    },

    setClearPreview(rows, cols) {
      for (const cell of previewCells) delete cell.dataset["preview"];
      previewCells = [];
      const mark = (cell: HTMLElement | null): void => {
        if (cell === null) return;
        cell.dataset["preview"] = "1";
        previewCells.push(cell);
      };
      for (const y of rows) {
        for (let x = 0; x < size; x++) mark(at(x, y));
      }
      for (const x of cols) {
        for (let y = 0; y < size; y++) mark(at(x, y));
      }
    },

    setCursor(pos) {
      if (cursorCell !== null) delete cursorCell.dataset["cursor"];
      cursorCell = null;
      if (pos === null) {
        boardEl.removeAttribute("aria-activedescendant");
        return;
      }
      const cell = at(pos.x, pos.y);
      if (cell === null) return;
      cell.dataset["cursor"] = "1";
      cursorCell = cell;
      boardEl.setAttribute("aria-activedescendant", cell.id);
    },

    metrics,

    cellOffset(x, y) {
      const m = metrics();
      const rootRect = root.getBoundingClientRect();
      return {
        left: m.originX - rootRect.left + x * m.pitch,
        top: m.originY - rootRect.top + y * m.pitch,
      };
    },

    pointToCell(clientX, clientY) {
      const m = metrics();
      if (m.pitch === 0) return { x: 0, y: 0 };
      return {
        x: Math.round((clientX - m.originX) / m.pitch),
        y: Math.round((clientY - m.originY) / m.pitch),
      };
    },
  };
}
