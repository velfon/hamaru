/**
 * About / プライバシー(docs/01 §9.6)。文言の要点は docs/04 §8。
 * 「何を送っているか」を平易に、謝らずに書く。
 */
import { t } from "../../i18n";
import { iconButton, ICON_BACK } from "../components/button";
import { el } from "../dom";
import { navigate, type Screen } from "../router";

export function aboutScreen(container: HTMLElement): Screen {
  const items = ["about.item1", "about.item2", "about.item3", "about.item4", "about.item5"];

  const screen = el("div", { class: "screen", "data-testid": "about-screen" }, [
    el("div", { class: "topbar" }, [
      iconButton({
        label: t("about.back"),
        paths: ICON_BACK,
        testId: "back",
        onClick: () => navigate("/settings"),
      }),
      el("h1", { class: "topbar__title", style: "font-size:20px" }, [t("about.title")]),
      el("div", { class: "topbar__spacer" }),
    ]),
    el("div", { class: "prose" }, [
      el("p", {}, [t("about.intro")]),
      el(
        "ul",
        {},
        items.map((key) => el("li", {}, [t(key)])),
      ),
      el("p", { class: "muted" }, ["HAMARU · MIT License"]),
    ]),
  ]);

  container.appendChild(screen);

  return {
    unmount() {
      /* 何も購読していない */
    },
  };
}
