/**
 * ホーム(docs/01 §9.1)。
 *
 * ┌──────────────────────────────┐
 * │ HAMARU               ♪  ⚙︎   │
 * │ ┌──────────────────────────┐ │
 * │ │ 今日の挑戦  9/17         │ │
 * │ │ [ 挑戦する ]   連続 4 日  │ │
 * │ └──────────────────────────┘ │
 * │ [ ▶ エンドレス ]  (続きから) │
 * │ ベスト 12,340   プレイ 58 回 │
 * └──────────────────────────────┘
 */
import { deserialize } from "../../core/game";
import { msUntilNextUtcDay, utcDateString } from "../../core/daily";
import { formatCountdown, formatDate, formatNumber, t } from "../../i18n";
import {
  KEYS,
  loadDailyResults,
  loadLevelProgress,
  loadSavedGame,
  totalStars,
  unlockedLevel,
} from "../../storage/local";
import { DEFAULT_CONFIG } from "../../config";
import { button, iconButton, ICON_SETTINGS } from "../components/button";
import { el, fillSlot } from "../dom";
import { navigate, type Screen } from "../router";
import { createSoundControl } from "../sound";
import { statsStore } from "../store";

const MINUTE = 60_000;

export function homeScreen(container: HTMLElement): Screen {
  const stats = statsStore.get();
  const today = utcDateString(Date.now());
  const results = loadDailyResults();
  const todayResult = results[today] ?? null;

  const savedDaily = loadSavedGame(KEYS.gameDaily);
  const dailyState = savedDaily === null ? null : deserialize(savedDaily.state);
  const dailyInProgress =
    savedDaily !== null && savedDaily.date === today && dailyState?.status === "playing";

  const savedEndless = loadSavedGame(KEYS.gameEndless);
  const endlessState = savedEndless === null ? null : deserialize(savedEndless.state);
  const endlessInProgress = endlessState !== null && endlessState.status === "playing";

  /* デイリーカード(docs/03 §6 DailyCard) */
  const countdown = el("span", { "data-testid": "countdown" });

  const stateLabel = todayResult
    ? t("home.daily.done", {
        score: formatNumber(todayResult.score),
        n: formatNumber(todayResult.attempts),
      })
    : dailyInProgress
      ? t("home.daily.playing")
      : t("home.daily.new");

  const stateClass = todayResult
    ? "card__state card__state--done"
    : dailyInProgress
      ? "card__state card__state--playing"
      : "card__state";

  const dailyButtonLabel = todayResult
    ? t("over.retryDaily")
    : dailyInProgress
      ? t("home.resume")
      : t("home.daily.play");

  const card = el("section", { class: "card", "data-testid": "daily-card" }, [
    el("div", { class: "card__head" }, [
      el("h2", { class: "card__title" }, [t("home.daily.title")]),
      el("span", { class: "card__date" }, [formatDate(today)]),
    ]),
    el("div", { class: "card__meta" }, [
      el("span", { class: stateClass, "data-testid": "daily-state" }, [stateLabel]),
      stats.dailyStreak > 0
        ? el("span", { class: "streak", "data-testid": "daily-streak" }, [
            t("home.daily.streak", { n: stats.dailyStreak }),
          ])
        : null,
    ]),
    button({
      label: dailyButtonLabel,
      variant: "primary",
      testId: "daily-play",
      onClick: () => navigate("/daily"),
    }),
    el("div", { class: "card__meta card__meta--split" }, [
      countdown,
      button({
        label: t("home.ranking"),
        variant: "ghost",
        testId: "ranking-link",
        onClick: () => navigate("/ranking"),
      }),
    ]),
  ]);

  function renderCountdown(): void {
    countdown.textContent = t("home.daily.next", {
      time: formatCountdown(msUntilNextUtcDay(Date.now())),
    });
  }
  renderCountdown();
  const timer = window.setInterval(renderCountdown, MINUTE);

  /* エンドレス */
  const actions = el("div", { class: "home__actions" }, [
    button({
      label: endlessInProgress ? t("home.resume") : t("home.play"),
      variant: "primary",
      testId: "endless-play",
      onClick: () => navigate("/play"),
    }),
    endlessInProgress
      ? button({
          label: t("home.restart"),
          variant: "secondary",
          testId: "endless-restart",
          onClick: () => navigate("/play?new=1"),
        })
      : null,
  ]);

  /* レベル(docs/09 §5) */
  const levelProgress = loadLevelProgress();
  const levelsButton = button({
    label: t("home.levels", {
      n: unlockedLevel(levelProgress),
      stars: totalStars(levelProgress),
    }),
    variant: "secondary",
    testId: "levels-link",
    onClick: () => navigate("/levels"),
  });
  actions.appendChild(levelsButton);

  /* 統計(空状態は誘導。docs/03 §7) */
  const statsRow =
    stats.gamesPlayed === 0
      ? el("div", { class: "home__stats", "data-testid": "stats" }, [t("home.stats.empty")])
      : el("div", { class: "home__stats", "data-testid": "stats" }, [
          el("span", {}, [
            fillSlot(t("home.stats.best"), "score", el("b", {}, [formatNumber(stats.bestScore)])),
          ]),
          el("span", {}, [
            fillSlot(t("home.stats.games"), "n", el("b", {}, [formatNumber(stats.gamesPlayed)])),
          ]),
        ]);

  const glazebar = el("div", { class: "glazebar", "aria-hidden": "true" });
  for (let i = 1; i <= 6; i++) {
    const span = el("span", {});
    span.style.setProperty("--g", `var(--glaze-${i})`);
    glazebar.appendChild(span);
  }

  // ホームでは BGM を鳴らさない(遊んでいる画面だけ。docs/10 §1)。
  const sound = createSoundControl(DEFAULT_CONFIG, { playsMusic: false });

  const screen = el("div", { class: "screen", "data-testid": "home-screen" }, [
    el("div", { class: "topbar" }, [
      el("div", { class: "topbar__spacer" }),
      sound.button,
      iconButton({
        label: t("home.settings"),
        paths: ICON_SETTINGS,
        testId: "settings-link",
        onClick: () => navigate("/settings"),
      }),
    ]),
    el("header", { class: "home__hero" }, [
      el("h1", { class: "home__wordmark" }, ["HAMARU"]),
      el("p", { class: "home__tagline" }, [t("app.tagline")]),
      glazebar,
    ]),
    card,
    actions,
    statsRow,
  ]);

  container.appendChild(screen);

  return {
    unmount() {
      window.clearInterval(timer);
      sound.destroy();
    },
  };
}
