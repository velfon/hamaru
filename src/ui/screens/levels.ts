/**
 * レベル一覧(docs/09 §5)。`#/levels`。
 * 解放済みのレベルと星、次に遊ぶレベルを強調。未解放は 1 つ先まで鍵付きで見せる。
 */
import { levelParams } from "../../core/levels";
import { DEFAULT_CONFIG } from "../../config";
import { t } from "../../i18n";
import { loadLevelProgress, totalStars, unlockedLevel } from "../../storage/local";
import { iconButton, ICON_BACK } from "../components/button";
import { el } from "../dom";
import { navigate, type Screen } from "../router";
import { starsView } from "./level";

export function levelsScreen(container: HTMLElement): Screen {
  const progress = loadLevelProgress();
  const next = unlockedLevel(progress);
  const grid = el("ol", { class: "levels", "data-testid": "levels-grid" });

  for (let n = 1; n <= next + 1; n++) {
    const done = progress[n];
    const locked = n > next;
    const p = levelParams(DEFAULT_CONFIG.levels, n);
    const tile = el(
      "button",
      {
        type: "button",
        class: `levels__tile${n === next ? " levels__tile--next" : ""}${locked ? " levels__tile--locked" : ""}`,
        "data-testid": `level-${n}`,
        "aria-label": locked
          ? `${t("level.tag", { n })} ${t("levels.locked")}`
          : `${t("level.tag", { n })} ${t("levels.goal", { goal: p.goal, trays: p.trayLimit })}${done ? ` ${t("level.stars", { n: done.stars })}` : ""}`,
        ...(locked ? { disabled: "" } : {}),
      },
      [
        el("span", { class: "levels__no" }, [String(n)]),
        done
          ? starsView(done.stars)
          : el("span", { class: "levels__meta" }, [
              locked ? "🔒" : t("levels.goalShort", { goal: p.goal }),
            ]),
      ],
    );
    if (!locked) tile.addEventListener("click", () => navigate(`/level?n=${n}`));
    grid.appendChild(el("li", {}, [tile]));
  }

  container.appendChild(
    el("div", { class: "screen", "data-testid": "levels-screen" }, [
      el("div", { class: "topbar" }, [
        iconButton({
          label: t("ranking.back"),
          paths: ICON_BACK,
          testId: "back",
          onClick: () => navigate("/"),
        }),
        el("h1", { class: "topbar__title topbar__title--sub" }, [t("levels.title")]),
        el("div", { class: "topbar__spacer" }),
      ]),
      el("p", { class: "ranking__note" }, [t("levels.hint")]),
      el("p", { class: "levels__summary", "data-testid": "levels-summary" }, [
        t("levels.progress", { n: next, stars: totalStars(progress) }),
      ]),
      grid,
    ]),
  );
  grid.querySelector<HTMLButtonElement>(".levels__tile--next")?.scrollIntoView({ block: "center" });

  return {
    unmount() {
      /* 購読していない */
    },
  };
}
