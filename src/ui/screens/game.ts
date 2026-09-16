/**
 * ゲーム画面(docs/01 §9.2、§9.3)。エンドレスとデイリーの両方をここで動かす。
 *
 * 状態の流れ: 入力(drag / keyboard)→ `core.place` → 新しい state を描画 → 演出。
 * 演出は描画の**後**に重ねるだけなので、演出を全部止めても DOM の最終形は変わらない。
 */
import { canPlace, fillRatio, placeShape, shapeCellsAt } from "../../core/board";
import { dailyNumber, dailySeed, endlessSeed, utcDateString } from "../../core/daily";
import { deserialize, newGame, place, serialize } from "../../core/game";
import { getShape } from "../../core/shapes";
import { streakMultiplier } from "../../core/scoring";
import type { Cell, GameState, Mode, Piece, ResolvedConfig } from "../../core/types";
import { resolveConfig, DEFAULT_CONFIG, DEFAULT_EXPERIMENTS } from "../../config";
import { formatNumber, t } from "../../i18n";
import {
  KEYS,
  loadSavedGame,
  remove,
  saveDailyResult,
  saveSavedGame,
  loadDailyResults,
} from "../../storage/local";
import { track, updateContext } from "../../telemetry/client";
import { createBoardView } from "../board-view";
import { button, iconButton, ICON_BACK } from "../components/button";
import { announce, toast } from "../components/toast";
import { createDrag, type PlacementHost, type PlacementPreview } from "../drag";
import { el, systemPrefersReducedMotion } from "../dom";
import {
  boardClearFx,
  clearFx,
  dropFx,
  gameOverDelay,
  renderNumber,
  vibrate,
  type FxOptions,
} from "../fx";
import { createKeyboard } from "../keyboard";
import { navigate, type Screen } from "../router";
import { buildShareText, shareText } from "../share";
import { getContext, settingsStore, statsStore, langStore } from "../store";
import { createTrayView } from "../tray-view";

/** 完全に埋まった行 / 列(消去プレビュー用)。 */
function completedLines(board: Uint8Array, size: number): { rows: number[]; cols: number[] } {
  const rows: number[] = [];
  const cols: number[] = [];
  for (let y = 0; y < size; y++) {
    let full = true;
    for (let x = 0; x < size; x++) {
      if ((board[y * size + x] ?? 0) === 0) {
        full = false;
        break;
      }
    }
    if (full) rows.push(y);
  }
  for (let x = 0; x < size; x++) {
    let full = true;
    for (let y = 0; y < size; y++) {
      if ((board[y * size + x] ?? 0) === 0) {
        full = false;
        break;
      }
    }
    if (full) cols.push(x);
  }
  return { rows, cols };
}

function reducedMotion(): boolean {
  const setting = settingsStore.get().motion;
  return setting === "always" || systemPrefersReducedMotion();
}

function fxOptions(config: ResolvedConfig): FxOptions {
  return {
    reduced: reducedMotion(),
    clearDurationMs: config.fx.clearDurationMs,
    snapDurationMs: config.fx.snapDurationMs,
  };
}

interface StartInfo {
  state: GameState;
  isPractice: boolean;
  resumed: boolean;
  date: string;
}

/**
 * 開発ビルドのみ: `?state=` で状態を差し込む(docs/06 §5)。
 * **1 回だけ**効くように、読んだらすぐ URL から消す(以降は通常どおり保存状態で動く)。
 */
function seededState(): GameState | null {
  if (!import.meta.env.DEV) return null;
  const params = new URLSearchParams(location.search);
  const raw = params.get("state");
  if (raw === null) return null;
  params.delete("state");
  const search = params.toString();
  history.replaceState(
    null,
    "",
    `${location.pathname}${search === "" ? "" : `?${search}`}${location.hash}`,
  );
  return deserialize(raw);
}

function startGame(mode: Mode, query: URLSearchParams, config: ResolvedConfig): StartInfo {
  const now = Date.now();
  const date = utcDateString(now);
  const seeded = seededState();
  if (seeded !== null && seeded.mode === mode) {
    return { state: seeded, isPractice: false, resumed: false, date };
  }

  if (mode === "daily") {
    const saved = loadSavedGame(KEYS.gameDaily);
    const savedState = saved === null ? null : deserialize(saved.state);
    const wantPractice = query.get("practice") === "1";
    if (
      !wantPractice &&
      saved !== null &&
      savedState !== null &&
      saved.date === date &&
      savedState.status === "playing"
    ) {
      return { state: savedState, isPractice: saved.isPractice === true, resumed: true, date };
    }
    // 日付が変わっていれば破棄する(docs/01 §7.2)。
    if (saved !== null && saved.date !== date) remove(KEYS.gameDaily);
    const done = loadDailyResults()[date];
    const isPractice = wantPractice || done !== undefined;
    return {
      state: newGame(config, "daily", dailySeed(date), now),
      isPractice,
      resumed: false,
      date,
    };
  }

  const saved = loadSavedGame(KEYS.gameEndless);
  const savedState = saved === null ? null : deserialize(saved.state);
  if (query.get("new") !== "1") {
    if (savedState !== null && savedState.status === "playing") {
      return { state: savedState, isPractice: false, resumed: true, date };
    }
  } else if (savedState !== null && savedState.status === "playing" && savedState.moves > 0) {
    // 「はじめから」で途中のゲームを破棄した(docs/04 §3 `game_end` reason=abandon)。
    track({
      event: "game_end",
      reason: "abandon",
      score: savedState.score,
      lines: savedState.linesCleared,
      moves: savedState.moves,
      durationMs: saved?.activeMs ?? 0,
      round: savedState.round,
      longestStreak: savedState.longestStreak,
      isPractice: 0,
      fillRatioAtEnd: fillRatio(savedState.board),
    });
    remove(KEYS.gameEndless);
  }
  const ctx = getContext();
  return {
    state: newGame(config, "endless", endlessSeed(ctx.installId, now), now),
    isPractice: false,
    resumed: false,
    date,
  };
}

export function gameScreen(mode: Mode) {
  return (container: HTMLElement, query: URLSearchParams): Screen => {
    const ctx = getContext();
    const config =
      mode === "daily"
        ? resolveConfig(DEFAULT_CONFIG, DEFAULT_EXPERIMENTS, ctx.installId, "daily")
        : ctx.config;

    const start = startGame(mode, query, config);
    let state = start.state;
    let isPractice = start.isPractice;
    const startDate = start.date;

    /* -------------------------------------------------------------- */
    /* アクティブ時間(非表示中は止める。docs/04 §3 `durationMs`)         */
    /* -------------------------------------------------------------- */
    let activeMs = 0;
    let lastTick = Date.now();
    let ended = false;

    function tick(): void {
      const now = Date.now();
      if (document.visibilityState === "visible") activeMs += now - lastTick;
      lastTick = now;
    }

    const onVisibility = (): void => {
      tick();
      if (document.visibilityState === "hidden") persist();
    };
    document.addEventListener("visibilitychange", onVisibility);

    /* -------------------------------------------------------------- */
    /* DOM                                                             */
    /* -------------------------------------------------------------- */
    const boardView = createBoardView(state.size);
    const trayView = createTrayView();

    const scoreValue = el("div", { class: "stat__value", "data-testid": "score" });
    const bestValue = el("div", { class: "stat__value", "data-testid": "best" });
    const streakBadge = el("div", { class: "streakbadge", "data-testid": "streak", hidden: true });

    const back = iconButton({
      label: t("game.back"),
      paths: ICON_BACK,
      testId: "back",
      onClick: () => navigate("/"),
    });

    const modeTag = el("div", { class: "modetag", "data-testid": "modetag" }, [
      mode === "daily"
        ? t("game.daily", { n: dailyNumber(startDate, config.daily.epoch) ?? 0 })
        : t("game.endless"),
      isPractice ? ` · ${t("game.practice")}` : "",
    ]);

    // ヘッダはワイヤ(docs/01 §9.2)どおり 1 行。← / スコア / ベスト / モードとストリーク。
    const hud = el("div", { class: "hud" }, [
      back,
      el("div", { class: "hud__scores" }, [
        el("div", { class: "stat stat--score" }, [
          el("span", { class: "stat__label" }, [t("game.score")]),
          scoreValue,
        ]),
        el("div", { class: "stat stat--best" }, [
          el("span", { class: "stat__label" }, [t("game.best")]),
          bestValue,
        ]),
      ]),
      el("div", { class: "hud__meta" }, [modeTag, streakBadge]),
    ]);

    const play = el("div", { class: "game__play" }, [boardView.root, trayView.root]);
    const screen = el("div", { class: "screen game", "data-testid": "game-screen" }, [hud, play]);
    container.appendChild(screen);

    let overlay: HTMLElement | null = null;

    /* -------------------------------------------------------------- */
    /* 描画                                                             */
    /* -------------------------------------------------------------- */
    function renderAll(): void {
      const fx = fxOptions(config);
      boardView.render(state.board);
      trayView.render(state.tray);
      renderNumber(scoreValue, formatNumber(state.score), fx);
      renderNumber(bestValue, formatNumber(Math.max(statsStore.get().bestScore, state.score)), fx);
      const mult = streakMultiplier(
        state.streak,
        config.scoring.streak.step,
        config.scoring.streak.max,
      );
      if (state.streak > 0 && mult > 1) {
        streakBadge.hidden = false;
        streakBadge.textContent = `×${mult.toFixed(2).replace(/0$/, "")}`;
      } else {
        streakBadge.hidden = true;
      }
    }

    function persist(): void {
      if (state.status !== "playing") return;
      const payload = {
        state: serialize(state),
        isPractice,
        activeMs,
        ...(mode === "daily" ? { date: startDate } : {}),
      };
      saveSavedGame(mode === "daily" ? KEYS.gameDaily : KEYS.gameEndless, payload);
    }

    /* -------------------------------------------------------------- */
    /* 配置                                                             */
    /* -------------------------------------------------------------- */
    const host: PlacementHost = {
      size: state.size,
      isPlaying: () => state.status === "playing" && overlay === null,
      pieceAt: (index) => state.tray[index] ?? null,
      preview(index, x, y): PlacementPreview {
        const piece: Piece | null = state.tray[index] ?? null;
        const shape = piece === null ? undefined : getShape(piece.shapeId);
        if (shape === undefined) {
          return { valid: false, cells: [], color: 0, rows: [], cols: [] };
        }
        const valid = canPlace(state.board, state.size, shape, x, y);
        if (!valid) return { valid: false, cells: [], color: shape.color, rows: [], cols: [] };
        const next = placeShape(state.board, state.size, shape, x, y);
        const lines = completedLines(next, state.size);
        return {
          valid: true,
          cells: shapeCellsAt(shape, x, y),
          color: shape.color,
          rows: lines.rows,
          cols: lines.cols,
        };
      },
      commit(index, x, y, delta) {
        const piece = state.tray[index] ?? null;
        const shape = piece === null ? undefined : getShape(piece.shapeId);
        if (shape === undefined) return;
        const filledBefore = placeShape(state.board, state.size, shape, x, y);
        const { state: next, result } = place(state, config, index, x, y);
        if (!result.ok) return;

        const fx = fxOptions(config);
        state = next;
        renderAll();
        persist();

        const clearedSet = new Set(result.clearedCells.map(([cx, cy]) => `${cx},${cy}`));
        const placedOutside = result.placedCells.filter(
          ([cx, cy]) => !clearedSet.has(`${cx},${cy}`),
        );
        dropFx(boardView, placedOutside, delta, fx);

        const haptics = settingsStore.get().haptics;
        if (result.clearedCells.length > 0) {
          const tiles = result.clearedCells.map(([cx, cy]) => ({
            x: cx,
            y: cy,
            color: (filledBefore[cy * state.size + cx] ?? 0) as Cell,
          }));
          clearFx(boardView, tiles, result.clearedRows, result.clearedCols, fx);
          vibrate([10, 30, 20], haptics);
        } else {
          vibrate(10, haptics);
        }

        if (result.boardCleared) {
          boardClearFx(boardView, t("fx.boardClear", { n: config.scoring.boardClearBonus }), fx);
        }

        const lines = result.clearedRows.length + result.clearedCols.length;
        announce(
          lines > 0
            ? t("a11y.placed", { points: result.scoreDelta, lines })
            : t("a11y.placedOnly", { points: result.scoreDelta }),
        );

        if (result.gameOver) void finish("over");
      },
    };

    const drag = createDrag({
      boardView,
      trayView,
      host,
      config,
      reduced: reducedMotion,
      previewClears: () => settingsStore.get().previewClears && config.input.previewClears,
    });

    const keyboard = createKeyboard({
      boardView,
      trayView,
      host,
      previewClears: () => settingsStore.get().previewClears && config.input.previewClears,
      isDragging: drag.isDragging,
    });

    /* -------------------------------------------------------------- */
    /* 終了                                                             */
    /* -------------------------------------------------------------- */
    function updateStats(): { newBest: boolean } {
      const stats = statsStore.get();
      let newBest = false;
      if (isPractice) return { newBest };
      const nextStats = { ...stats };
      nextStats.gamesPlayed += 1;
      nextStats.totalLines += state.linesCleared;
      nextStats.totalScore += state.score;
      nextStats.longestStreak = Math.max(stats.longestStreak, state.longestStreak);
      if (state.score > stats.bestScore) {
        nextStats.bestScore = state.score;
        newBest = true;
      }
      if (mode === "daily") {
        const yesterday = new Date(Date.parse(`${startDate}T00:00:00Z`) - 86_400_000)
          .toISOString()
          .slice(0, 10);
        if (stats.lastDailyDate === startDate) {
          // 同じ日の再計上はしない。
        } else if (stats.lastDailyDate === yesterday) {
          nextStats.dailyStreak = stats.dailyStreak + 1;
        } else {
          nextStats.dailyStreak = 1;
        }
        nextStats.lastDailyDate = startDate;
      }
      statsStore.set(nextStats);
      return { newBest };
    }

    async function finish(reason: "over" | "abandon"): Promise<void> {
      if (ended) return;
      ended = true;
      tick();
      remove(mode === "daily" ? KEYS.gameDaily : KEYS.gameEndless);

      const { newBest } = updateStats();
      const dailyNo = dailyNumber(startDate, config.daily.epoch) ?? 0;
      if (mode === "daily" && !isPractice) {
        saveDailyResult(startDate, {
          score: state.score,
          lines: state.linesCleared,
          isFirst: true,
        });
        track({
          event: "daily_result",
          dailyNo,
          score: state.score,
          lines: state.linesCleared,
        });
      }

      track({
        event: "game_end",
        reason,
        score: state.score,
        lines: state.linesCleared,
        moves: state.moves,
        durationMs: activeMs,
        round: state.round,
        longestStreak: state.longestStreak,
        isPractice: isPractice ? 1 : 0,
        fillRatioAtEnd: fillRatio(state.board),
      });

      if (reason !== "over") return;
      trayView.markDead();
      await gameOverDelay(fxOptions(config));
      showOverlay(newBest, dailyNo);
    }

    function statBlock(label: string, value: string): HTMLElement {
      return el("div", {}, [el("span", { class: "stat__label" }, [label]), el("b", {}, [value])]);
    }

    function showOverlay(newBest: boolean, dailyNo: number): void {
      keyboard.deselect();
      const actions = el("div", { class: "overlay__actions" });
      const panel = el("div", { class: "overlay__panel" }, [
        el("div", { class: "overlay__title" }, [t("over.title")]),
        newBest ? el("div", { class: "overlay__newbest" }, [t("over.newBest")]) : null,
        el("div", { class: "overlay__score", "data-testid": "final-score" }, [
          formatNumber(state.score),
        ]),
        el("div", { class: "overlay__grid" }, [
          statBlock(t("over.lines"), formatNumber(state.linesCleared)),
          statBlock(t("over.streak"), formatNumber(state.longestStreak)),
          statBlock(t("over.rounds"), formatNumber(state.round)),
        ]),
        actions,
      ]);

      if (mode === "daily" && !isPractice) {
        actions.append(
          button({
            label: t("over.share"),
            variant: "primary",
            testId: "share",
            onClick: () => void onShare(dailyNo),
          }),
          button({
            label: t("over.practice"),
            variant: "secondary",
            testId: "practice",
            onClick: () => restart(true),
          }),
        );
      } else {
        actions.appendChild(
          button({
            label: t("over.retry"),
            variant: "primary",
            testId: "retry",
            onClick: () => restart(isPractice),
          }),
        );
      }
      actions.appendChild(
        button({
          label: t("over.home"),
          variant: "secondary",
          testId: "over-home",
          onClick: () => navigate("/"),
        }),
      );

      overlay = el(
        "div",
        {
          class: "overlay",
          role: "dialog",
          "aria-modal": "true",
          "aria-label": t("a11y.gameOver"),
          "data-testid": "gameover",
        },
        [panel],
      );
      document.body.appendChild(overlay);
      const first = overlay.querySelector<HTMLButtonElement>("button");
      first?.focus();
    }

    async function onShare(dailyNo: number): Promise<void> {
      const text = buildShareText({
        dailyNo,
        date: startDate,
        score: state.score,
        lines: state.linesCleared,
        multiplier: streakMultiplier(
          state.longestStreak,
          config.scoring.streak.step,
          config.scoring.streak.max,
        ),
        gaugeMax: config.daily.shareGaugeMax,
        url: `${location.origin}${location.pathname}#/daily`,
      });
      const method = await shareText(text);
      if (method === "none") return;
      if (method === "copy") toast(t("toast.copied"));
      track({ event: "share", method });
    }

    /** 同じ画面のまま新しいゲームを始める。 */
    function restart(practice: boolean): void {
      overlay?.remove();
      overlay = null;
      ended = false;
      activeMs = 0;
      lastTick = Date.now();
      isPractice = practice;
      const now = Date.now();
      state =
        mode === "daily"
          ? newGame(config, "daily", dailySeed(startDate), now)
          : newGame(config, "endless", endlessSeed(ctx.installId, now), now);
      modeTag.textContent =
        (mode === "daily"
          ? t("game.daily", { n: dailyNumber(startDate, config.daily.epoch) ?? 0 })
          : t("game.endless")) + (practice ? ` · ${t("game.practice")}` : "");
      renderAll();
      persist();
      track({ event: "game_start", resumed: 0, isPractice: practice ? 1 : 0 });
    }

    /* -------------------------------------------------------------- */
    /* 起動                                                             */
    /* -------------------------------------------------------------- */
    updateContext({ mode });
    renderAll();
    persist();
    track({ event: "game_start", resumed: start.resumed ? 1 : 0, isPractice: isPractice ? 1 : 0 });
    if (state.status === "over") void finish("over");

    const unsubscribeLang = langStore.subscribe(() => {
      boardView.refreshLabels();
      trayView.refreshLabels();
    });

    return {
      unmount() {
        tick();
        persist();
        updateContext({ mode: "" });
        document.removeEventListener("visibilitychange", onVisibility);
        unsubscribeLang();
        drag.destroy();
        keyboard.destroy();
        overlay?.remove();
        overlay = null;
      },
    };
  };
}
