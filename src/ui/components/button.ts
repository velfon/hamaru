/**
 * ボタン(docs/03 §6)。
 * 主: --ink 背景 / --kiln 文字、高さ 52px、角丸 14px、Unbounded 700 14px。
 * 副: 透明 + 1px --ink-muted 枠。フォーカスリングは共通の 3px --kintsugi。
 */
import { el, svg } from "../dom";

export type ButtonVariant = "primary" | "secondary" | "ghost";

export interface ButtonOptions {
  label: string;
  variant?: ButtonVariant;
  onClick?: (ev: MouseEvent) => void;
  block?: boolean;
  ariaLabel?: string;
  testId?: string;
  type?: "button" | "submit";
}

export function button(opts: ButtonOptions): HTMLButtonElement {
  const node = el(
    "button",
    {
      type: opts.type ?? "button",
      class: `btn btn--${opts.variant ?? "primary"}${opts.block === false ? "" : " btn--block"}`,
      "aria-label": opts.ariaLabel,
      "data-testid": opts.testId,
    },
    [opts.label],
  );
  if (opts.onClick) node.addEventListener("click", opts.onClick);
  return node;
}

export interface IconButtonOptions {
  label: string;
  paths: readonly string[];
  onClick?: (ev: MouseEvent) => void;
  testId?: string;
}

export function iconButton(opts: IconButtonOptions): HTMLButtonElement {
  const node = el("button", {
    type: "button",
    class: "iconbtn",
    "aria-label": opts.label,
    title: opts.label,
    "data-testid": opts.testId,
  });
  node.appendChild(svg(opts.paths));
  if (opts.onClick) node.addEventListener("click", opts.onClick);
  return node;
}

/** 設定(歯車)。 */
export const ICON_SETTINGS = [
  "M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z",
  "M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6h.09A1.65 1.65 0 0 0 10 3.09V3a2 2 0 1 1 4 0v.09A1.65 1.65 0 0 0 15 4.6a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9v.09a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z",
];

/** 戻る。 */
export const ICON_BACK = ["M15 18l-6-6 6-6"];
