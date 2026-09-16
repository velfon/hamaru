/**
 * 設定(docs/01 §9.5)。
 * 言語 / テーマ / ハプティクス / アニメーション軽減 / 消去プレビュー / データの削除 /
 * バージョン / プライバシーへのリンク。
 */
import { t } from "../../i18n";
import { clearAll, DEFAULT_SETTINGS, DEFAULT_STATS, type Settings } from "../../storage/local";
import { button, iconButton, ICON_BACK } from "../components/button";
import { confirmDialog } from "../components/dialog";
import { toast } from "../components/toast";
import { el, svg } from "../dom";
import { navigate, type Screen } from "../router";
import { settingsStore, statsStore } from "../store";

const APP_VERSION = import.meta.env["VITE_APP_VERSION"] ?? "dev";

function row(label: string, control: Node, hint?: string): HTMLElement {
  return el("div", { class: "row" }, [
    el("div", {}, [
      el("span", { class: "row__label" }, [label]),
      hint === undefined ? null : el("span", { class: "row__hint" }, [hint]),
    ]),
    control,
  ]);
}

function select<K extends keyof Settings>(
  key: K,
  options: ReadonlyArray<{ value: Settings[K]; label: string }>,
  testId: string,
): HTMLSelectElement {
  const node = el("select", { "data-testid": testId, "aria-label": testId });
  for (const option of options) {
    const opt = el("option", { value: String(option.value) }, [option.label]);
    node.appendChild(opt);
  }
  node.value = String(settingsStore.get()[key]);
  node.addEventListener("change", () => {
    settingsStore.update((s) => ({ ...s, [key]: node.value as Settings[K] }));
  });
  return node;
}

function toggle(key: "haptics" | "previewClears", label: string, testId: string): HTMLElement {
  const input = el("input", {
    type: "checkbox",
    "data-testid": testId,
    "aria-label": label,
  });
  input.checked = settingsStore.get()[key];
  input.addEventListener("change", () => {
    settingsStore.update((s) => ({ ...s, [key]: input.checked }));
  });
  return el("span", { class: "switch" }, [input, el("span", { class: "switch__track" })]);
}

export function settingsScreen(container: HTMLElement): Screen {
  const langSelect = select(
    "lang",
    [
      { value: "auto", label: t("settings.language.auto") },
      { value: "ja", label: t("settings.language.ja") },
      { value: "en", label: t("settings.language.en") },
    ],
    "setting-lang",
  );
  // 言語を変えたら画面の文言も差し替える(この画面を組み直す)。
  langSelect.addEventListener("change", () => navigate("/settings"));

  const screen = el("div", { class: "screen", "data-testid": "settings-screen" }, [
    el("div", { class: "topbar" }, [
      iconButton({
        label: t("settings.back"),
        paths: ICON_BACK,
        testId: "back",
        onClick: () => navigate("/"),
      }),
      el("h1", { class: "topbar__title", style: "font-size:20px" }, [t("settings.title")]),
      el("div", { class: "topbar__spacer" }),
    ]),
    el("div", { class: "rows" }, [
      row(t("settings.language"), langSelect),
      row(
        t("settings.theme"),
        select(
          "theme",
          [
            { value: "auto", label: t("settings.theme.auto") },
            { value: "light", label: t("settings.theme.light") },
            { value: "dark", label: t("settings.theme.dark") },
          ],
          "setting-theme",
        ),
      ),
      row(t("settings.haptics"), toggle("haptics", t("settings.haptics"), "setting-haptics")),
      row(
        t("settings.motion"),
        select(
          "motion",
          [
            { value: "system", label: t("settings.motion.system") },
            { value: "always", label: t("settings.motion.always") },
          ],
          "setting-motion",
        ),
      ),
      row(t("settings.preview"), toggle("previewClears", t("settings.preview"), "setting-preview")),
    ]),
    el("div", { class: "rows" }, [
      el("a", { class: "row row--link", href: "#/about", "data-testid": "about-link" }, [
        el("span", { class: "row__label" }, [t("settings.privacy")]),
        svg(["M9 18l6-6-6-6"]),
      ]),
      row(t("settings.version"), el("span", { class: "card__date" }, [String(APP_VERSION)])),
    ]),
    button({
      label: t("settings.reset"),
      variant: "secondary",
      testId: "reset",
      onClick: () => void onReset(),
    }),
  ]);

  async function onReset(): Promise<void> {
    const ok = await confirmDialog({
      title: t("settings.reset"),
      body: t("settings.reset.confirm"),
      confirmLabel: t("settings.reset.ok"),
      cancelLabel: t("settings.reset.cancel"),
      testId: "reset-dialog",
    });
    if (!ok) return;
    clearAll();
    statsStore.set({ ...DEFAULT_STATS });
    settingsStore.set({ ...DEFAULT_SETTINGS });
    toast(t("toast.deleted"));
    navigate("/settings");
  }

  container.appendChild(screen);

  return {
    unmount() {
      /* 購読していないので何もしない */
    },
  };
}
