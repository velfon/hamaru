/**
 * トースト(docs/03 §6)。画面下部、2.4 秒、`aria-live="polite"`。
 */
import { el } from "../dom";

export const TOAST_MS = 2400;

let container: HTMLElement | null = null;

function ensureContainer(): HTMLElement {
  if (container !== null && container.isConnected) return container;
  container = el("div", { class: "toasts", role: "status", "aria-live": "polite" });
  document.body.appendChild(container);
  return container;
}

export function toast(message: string, ms: number = TOAST_MS): void {
  const host = ensureContainer();
  const node = el("div", { class: "toast", "data-testid": "toast" }, [message]);
  host.appendChild(node);
  window.setTimeout(() => node.remove(), ms);
}

/** 盤の操作結果を読み上げる領域(docs/01 §8.2)。画面には出さない。 */
let live: HTMLElement | null = null;

export function announce(message: string): void {
  if (live === null || !live.isConnected) {
    live = el("div", { class: "visually-hidden", "aria-live": "polite", "data-testid": "live" });
    document.body.appendChild(live);
  }
  live.textContent = message;
}
