/**
 * ダイアログ(docs/03 §6)。`<dialog>` 要素、ESC / 背景クリックで閉じる。
 * 破壊的操作は赤ではなく**文言**で警告する。
 */
import { button } from "./button";
import { el } from "../dom";

export interface ConfirmOptions {
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel: string;
  testId?: string;
}

/** 確認ダイアログ。`true` = 実行する。 */
export function confirmDialog(opts: ConfirmOptions): Promise<boolean> {
  const dialog = el("dialog", { class: "dialog", "data-testid": opts.testId ?? "dialog" }, [
    el("div", { class: "dialog__title" }, [opts.title]),
    el("div", { class: "dialog__body" }, [opts.body]),
  ]);

  return new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (value: boolean): void => {
      if (settled) return;
      settled = true;
      resolve(value);
      dialog.close();
    };

    const actions = el("div", { class: "dialog__actions" }, [
      button({
        label: opts.confirmLabel,
        variant: "primary",
        testId: "dialog-confirm",
        onClick: () => finish(true),
      }),
      button({
        label: opts.cancelLabel,
        variant: "secondary",
        testId: "dialog-cancel",
        onClick: () => finish(false),
      }),
    ]);
    dialog.appendChild(actions);

    // 背景クリック(<dialog> 自身の領域 = backdrop)で閉じる。
    dialog.addEventListener("click", (ev) => {
      if (ev.target === dialog) finish(false);
    });
    // ESC。
    dialog.addEventListener("cancel", () => finish(false));
    dialog.addEventListener("close", () => {
      finish(false);
      dialog.remove();
    });

    document.body.appendChild(dialog);
    dialog.showModal();
  });
}
