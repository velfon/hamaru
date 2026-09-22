/**
 * このゲームについて / 送っているデータ(docs/01 §9.6)。文言の要点は docs/04 §8。
 *
 * 版面は「窯に並べたタイル」。節の頭に釉薬の色見本(チップ)を 1 枚置き、
 * 節の区切り線には金継ぎの継ぎ目を短く走らせる(docs/03 §10 N-8)。
 * 「何を送っているか」は平易に、謝らずに書く。
 */
import { t } from "../../i18n";
import { iconButton, ICON_BACK } from "../components/button";
import { el } from "../dom";
import { navigate, type Screen } from "../router";

const REPO = "https://github.com/velfon/hamaru";

/** 節: ラテンの小見出し(両言語共通)+ 見出し + 本文。 */
interface Section {
  /** 釉薬の色(1〜6)。 */
  glaze: number;
  eyebrow: string;
  title: string;
  body: Node[];
}

function paragraph(key: string): HTMLElement {
  return el("p", {}, [t(key)]);
}

/** 「名前 — 説明」の行。モードの一覧に使う。 */
function entry(nameKey: string, textKey: string): HTMLElement {
  return el("li", {}, [el("b", {}, [t(nameKey)]), " — ", t(textKey)]);
}

export function aboutScreen(container: HTMLElement): Screen {
  const sections: Section[] = [
    {
      glaze: 2,
      eyebrow: "About",
      title: t("about.what.title"),
      body: [paragraph("about.what.body")],
    },
    {
      glaze: 4,
      eyebrow: "Modes",
      title: t("about.modes.title"),
      body: [
        el("ul", { class: "about__list" }, [
          entry("about.modes.endless", "about.modes.endless.body"),
          entry("about.modes.daily", "about.modes.daily.body"),
          entry("about.modes.levels", "about.modes.levels.body"),
          entry("about.modes.ranking", "about.modes.ranking.body"),
        ]),
      ],
    },
    {
      glaze: 1,
      eyebrow: "Made",
      title: t("about.made.title"),
      body: [paragraph("about.made.body"), paragraph("about.made.sound")],
    },
    {
      glaze: 6,
      eyebrow: "Kaizen",
      title: t("about.kaizen.title"),
      body: [
        paragraph("about.kaizen.body"),
        el("p", {}, [
          el("a", { class: "link", href: REPO, target: "_blank", rel: "noreferrer noopener" }, [
            t("about.kaizen.repo"),
          ]),
        ]),
      ],
    },
    {
      glaze: 3,
      eyebrow: "Data",
      title: t("about.data.title"),
      body: [
        paragraph("about.intro"),
        el("ul", {}, [
          el("li", {}, [t("about.item1")]),
          el("li", {}, [t("about.item2")]),
          el("li", {}, [t("about.item3")]),
          el("li", {}, [t("about.item4")]),
          el("li", {}, [t("about.item5")]),
          el("li", {}, [t("about.item6")]),
        ]),
      ],
    },
    {
      glaze: 5,
      eyebrow: "Licence",
      title: t("about.licence.title"),
      body: [paragraph("about.licence.body"), paragraph("about.licence.yours")],
    },
  ];

  const screen = el("div", { class: "screen about", "data-testid": "about-screen" }, [
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
    el("header", { class: "about__head" }, [
      el("div", { class: "about__wordmark" }, ["HAMARU"]),
      el("p", { class: "about__tagline" }, [t("app.tagline")]),
    ]),
    el(
      "div",
      { class: "about__body prose" },
      sections.map((section) =>
        el("section", { class: "about__section" }, [
          el("div", { class: "about__label" }, [
            el("span", { class: "about__chip", style: `--g: var(--glaze-${section.glaze})` }),
            el("span", { class: "about__eyebrow" }, [section.eyebrow]),
          ]),
          el("h2", { class: "about__title" }, [section.title]),
          ...section.body,
        ]),
      ),
    ),
    el("footer", { class: "about__foot" }, [
      el("span", {}, ["© 2026 lovenf.org"]),
      el("a", { class: "link", href: "#/", "data-testid": "about-home" }, [t("about.toApp")]),
    ]),
  ]);

  container.appendChild(screen);

  return {
    unmount() {
      /* 何も購読していない */
    },
  };
}
