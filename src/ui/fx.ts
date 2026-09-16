/**
 * 演出(docs/03 §5)。CSS + Web Animations API。
 *
 * 原則: **状態遷移は演出に依存しない**。呼び出し側は先に状態を確定させ、
 * 盤は最終形を描いてから、その上の演出レイヤで「金継ぎ」を走らせる。
 * 演出を全部消しても最終 DOM は同じになる。
 *
 * 軽減時(`prefers-reduced-motion` または設定)は移動系 0ms、消去はフェード 120ms のみ。
 */
import type { Cell } from "../core/types";
import type { BoardView } from "./board-view";
import { el } from "./dom";

export interface FxOptions {
  reduced: boolean;
  /** docs/02 §4.1 `fx.clearDurationMs`(既定 320)。 */
  clearDurationMs: number;
  /** docs/02 §4.1 `fx.snapDurationMs`(既定 120)。 */
  snapDurationMs: number;
}

export const REDUCED_FADE_MS = 120;

function animate(
  node: Element,
  keyframes: Keyframe[],
  options: KeyframeAnimationOptions,
): Animation | null {
  if (typeof node.animate !== "function") return null;
  return node.animate(keyframes, options);
}

/**
 * 吸着(docs/03 §5「はまる」)。
 * ドロップ位置と着地セルのずれ `delta` から目標セルへ寄せ、1 度だけ 1.04 → 1.0 の沈みを入れる。
 */
export function dropFx(
  view: BoardView,
  cells: ReadonlyArray<readonly [number, number]>,
  delta: { dx: number; dy: number },
  opts: FxOptions,
): void {
  if (opts.reduced) return;
  const duration = Math.max(1, Math.round(opts.snapDurationMs * 0.75));
  for (const [x, y] of cells) {
    const node = view.cellEl(x, y);
    if (node === null) continue;
    animate(
      node,
      [
        { transform: `translate(${delta.dx}px, ${delta.dy}px) scale(1.04)` },
        { transform: "translate(0, 0) scale(1)" },
      ],
      { duration, easing: "cubic-bezier(0.22, 0.61, 0.36, 1)" },
    );
  }
}

export interface ClearedTile {
  x: number;
  y: number;
  color: Cell;
}

/**
 * 金継ぎ消去(docs/03 §5)。
 * ① 消える行 / 列に沿って金線が 1 方向へ走る ② 線通過後、各タイルがずれて縮小 + フェード。
 */
export function clearFx(
  view: BoardView,
  tiles: readonly ClearedTile[],
  rows: readonly number[],
  cols: readonly number[],
  opts: FxOptions,
): void {
  if (tiles.length === 0) return;
  const m = view.metrics();
  const layer = view.fxLayer;
  const half = Math.max(1, Math.round(opts.clearDurationMs / 2));
  const lineMs = opts.reduced ? 0 : half;
  const tileMs = opts.reduced ? REDUCED_FADE_MS : half;
  // 40ms ずつの遅延は 10 マスだと ② の予算(160ms)を超えるため、
  // 「予算内で等間隔」に丸める(docs/03 §10 実装ノート N-1)。
  const stagger = opts.reduced ? 0 : Math.min(40, half / Math.max(1, view.size - 1));

  const nodes: HTMLElement[] = [];

  if (!opts.reduced) {
    const thickness = Math.max(2, Math.round(m.unit * 0.12));
    for (const y of rows) {
      const pos = view.cellOffset(0, y);
      const line = el("div", { class: "kintsugi" });
      line.style.left = `${pos.left}px`;
      line.style.top = `${pos.top + m.unit / 2 - thickness / 2}px`;
      line.style.width = `${m.pitch * (view.size - 1) + m.unit}px`;
      line.style.height = `${thickness}px`;
      layer.appendChild(line);
      nodes.push(line);
      animate(
        line,
        [
          { clipPath: "inset(0 100% 0 0)", opacity: 1 },
          { clipPath: "inset(0 0 0 0)", opacity: 1, offset: 0.75 },
          { clipPath: "inset(0 0 0 0)", opacity: 0 },
        ],
        { duration: lineMs + tileMs, easing: "ease-out" },
      );
    }
    for (const x of cols) {
      const pos = view.cellOffset(x, 0);
      const line = el("div", { class: "kintsugi kintsugi--v" });
      line.style.left = `${pos.left + m.unit / 2 - thickness / 2}px`;
      line.style.top = `${pos.top}px`;
      line.style.width = `${thickness}px`;
      line.style.height = `${m.pitch * (view.size - 1) + m.unit}px`;
      layer.appendChild(line);
      nodes.push(line);
      animate(
        line,
        [
          { clipPath: "inset(0 0 100% 0)", opacity: 1 },
          { clipPath: "inset(0 0 0 0)", opacity: 1, offset: 0.75 },
          { clipPath: "inset(0 0 0 0)", opacity: 0 },
        ],
        { duration: lineMs + tileMs, easing: "ease-out" },
      );
    }
  }

  for (const tile of tiles) {
    const pos = view.cellOffset(tile.x, tile.y);
    const node = el("div", { class: "fxtile", "data-c": String(tile.color) });
    node.style.left = `${pos.left}px`;
    node.style.top = `${pos.top}px`;
    node.style.width = `${m.unit}px`;
    node.style.height = `${m.unit}px`;
    layer.appendChild(node);
    nodes.push(node);
    const delay = lineMs + (tile.x + tile.y) * stagger;
    animate(
      node,
      [
        { transform: "scale(1)", opacity: 1 },
        { transform: "scale(0.2)", opacity: 0 },
      ],
      {
        duration: tileMs,
        delay,
        easing: "ease-in",
        fill: "forwards",
      },
    );
  }

  const total = opts.reduced ? tileMs : lineMs + tileMs + stagger * view.size * 2;
  window.setTimeout(() => {
    for (const node of nodes) node.remove();
  }, total + 40);
}

/** 全消し(docs/03 §5)。盤全体が一瞬 --kintsugi の縁光り + ラベル。 */
export function boardClearFx(view: BoardView, label: string, opts: FxOptions): void {
  const duration = opts.reduced ? REDUCED_FADE_MS : 500;
  const flash = el("div", { class: "boardflash" });
  const text = el("div", { class: "fxlabel", "data-testid": "boardclear" }, [label]);
  view.fxLayer.append(flash, text);
  animate(flash, [{ opacity: 0 }, { opacity: 1, offset: 0.25 }, { opacity: 0 }], { duration });
  animate(
    text,
    opts.reduced
      ? [{ opacity: 1 }, { opacity: 0 }]
      : [
          { opacity: 0, transform: "translate(-50%, -40%) scale(0.9)" },
          { opacity: 1, transform: "translate(-50%, -50%) scale(1)", offset: 0.25 },
          { opacity: 1, transform: "translate(-50%, -50%) scale(1)", offset: 0.7 },
          { opacity: 0, transform: "translate(-50%, -60%) scale(1)" },
        ],
    { duration },
  );
  window.setTimeout(() => {
    flash.remove();
    text.remove();
  }, duration + 40);
}

/** ゲームオーバー前の暗転(docs/03 §5)。600ms 待ってから解決する。 */
export function gameOverDelay(opts: FxOptions): Promise<void> {
  const ms = opts.reduced ? 0 : 600;
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

/**
 * スコアの更新(docs/03 §3)。変化した桁だけ 1 マス分下から滑り込む。
 * 軽減時は即時更新。
 */
export function renderNumber(host: HTMLElement, text: string, opts: FxOptions): void {
  const previous = host.dataset["value"] ?? "";
  if (previous === text) return;
  host.dataset["value"] = text;
  const chars = [...text];
  const prevChars = [...previous];
  const offset = chars.length - prevChars.length;
  host.replaceChildren();
  chars.forEach((ch, i) => {
    const span = el("span", { class: "digit" }, [ch]);
    host.appendChild(span);
    const before = prevChars[i - offset];
    if (opts.reduced || before === ch) return;
    animate(
      span,
      [
        { transform: "translateY(100%)", opacity: 0 },
        { transform: "translateY(0)", opacity: 1 },
      ],
      {
        duration: 180,
        easing: "cubic-bezier(0.22, 0.61, 0.36, 1)",
      },
    );
  });
}

/** ハプティクス(docs/01 §8.3)。非対応環境では無視。 */
export function vibrate(pattern: number | number[], enabled: boolean): void {
  if (!enabled) return;
  if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") return;
  try {
    navigator.vibrate(pattern);
  } catch {
    /* 端末が拒否しても無視 */
  }
}
