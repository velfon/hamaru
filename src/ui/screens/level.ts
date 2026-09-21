/**
 * レベルのゲーム画面(docs/09 §5)。`#/level?n=N`。
 *
 * ┌──────────────────────────────┐
 * │ ←  Lv.7   スコア 240  目標 5/10  残り 3 │
 * │ ┌──────────────────────────┐ │
 * │ │ 10×10 盤(素焼きの欠片あり)│ │
 * │ └──────────────────────────┘ │
 * │   ▣▣     ▣▣▣     ▣           │
 * └──────────────────────────────┘
 *
 * 盤・トレイ・ドラッグ・キーボード・演出はエンドレス / デイリーと同じ部品を使う。
 * レベルは実験を適用しない既定の config で遊ぶ(面の表の前提。docs/09 §4)。
 */
import { canPlace, fillRatio, placeShape, shapeCellsAt } from "../../core/board";
import { deserialize, place, serialize } from "../../core/game";
import { levelVariant, newLevelGame, starsFor, traysLeft } from "../../core/levels";
import { getShape } from "../../core/shapes";
import type { Cell, GameState, Piece } from "../../core/types";
import { DEFAULT_CONFIG, LEVELS_TABLE } from "../../config";
import { formatNumber, t } from "../../i18n";
import {
  KEYS,
  loadLevelProgress,
  loadSavedGame,
  remove,
  saveLevelResult,
  saveSavedGame,
  unlockedLevel,
} from "../../storage/local";
import { track, updateContext } from "../../telemetry/client";
import { createBoardView } from "../board-view";
import { button, iconButton, ICON_BACK } from "../components/button";
import { announce } from "../components/toast";
import { createDrag, type PlacementHost, type PlacementPreview } from "../drag";
import { el, systemPrefersReducedMotion } from "../dom";
import { boardClearFx, clearFx, dropFx, gameOverDelay, renderNumber, vibrate } from "../fx";
import { createKeyboard } from "../keyboard";
import { createMusicControl } from "../music";
import { navigate, type Screen } from "../router";
import { langStore, settingsStore } from "../store";
import { createTrayView } from "../tray-view";
import { seededState } from "./game";

const config = DEFAULT_CONFIG;

function reducedMotion(): boolean {
  return settingsStore.get().motion === "always" || systemPrefersReducedMotion();
}

const fxOptions = () => ({
  reduced: reducedMotion(),
  clearDurationMs: config.fx.clearDurationMs,
  snapDurationMs: config.fx.snapDurationMs,
});

/** 完全に埋まった行 / 列(消去プレビュー用)。 */
function completedLines(board: Uint8Array, size: number): { rows: number[]; cols: number[] } {
  const rows: number[] = [];
  const cols: number[] = [];
  for (let i = 0; i < size; i++) {
    let row = true;
    let col = true;
    for (let j = 0; j < size; j++) {
      if ((board[i * size + j] ?? 0) === 0) row = false;
      if ((board[j * size + i] ?? 0) === 0) col = false;
    }
    if (row) rows.push(i);
    if (col) cols.push(i);
  }
  return { rows, cols };
}

/** 1〜3 個の星(金継ぎ色で塗る)。 */
export function starsView(stars: number, testId?: string): HTMLElement {
  const wrap = el("span", {
    class: "stars",
    role: "img",
    "aria-label": t("level.stars", { n: stars }),
    ...(testId ? { "data-testid": testId, "data-stars": String(stars) } : {}),
  });
  for (let i = 1; i <= 3; i++) {
    wrap.appendChild(
      el("span", { class: i <= stars ? "star star--on" : "star", "aria-hidden": "true" }, ["★"]),
    );
  }
  return wrap;
}

export function levelScreen(container: HTMLElement, query: URLSearchParams): Screen {
  // 開発ビルドの E2E 専用(`?state=`)。本番では常に null。
  const seeded = seededState();
  if (seeded !== null && seeded.mode === "level" && seeded.level !== undefined) {
    saveSavedGame(KEYS.gameLevel, { state: serialize(seeded), activeMs: 0 });
  }
  const progress = loadLevelProgress();
  const unlocked = unlockedLevel(progress);
  const requested = Number(query.get("n") ?? unlocked);
  const devNo = seeded?.level?.no;
  const no =
    devNo !== undefined
      ? devNo
      : Number.isInteger(requested) && requested >= 1 && requested <= unlocked
        ? requested
        : unlocked;
  const variant = levelVariant(LEVELS_TABLE, no);

  const saved = loadSavedGame(KEYS.gameLevel);
  const savedState = saved === null ? null : deserialize(saved.state);
  const resumed =
    savedState !== null && savedState.status === "playing" && savedState.level?.no === no;
  let state: GameState = resumed
    ? (savedState as GameState)
    : newLevelGame(config, no, Date.now(), variant);

  let activeMs = resumed ? (saved?.activeMs ?? 0) : 0;
  let lastTick = Date.now();
  let ended = false;
  let overlay: HTMLElement | null = null;

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

  /* DOM */
  const boardView = createBoardView(state.size);
  const trayView = createTrayView();
  const scoreValue = el("div", { class: "stat__value", "data-testid": "score" });
  const goalValue = el("div", { class: "stat__value", "data-testid": "goal" });
  const traysValue = el("div", { class: "stat__value", "data-testid": "trays" });

  const music = createMusicControl(config);

  const hud = el("div", { class: "hud" }, [
    iconButton({
      label: t("game.back"),
      paths: ICON_BACK,
      testId: "back",
      onClick: () => navigate("/levels"),
    }),
    music.button,
    el("div", { class: "hud__scores" }, [
      el("div", { class: "stat stat--score" }, [
        el("span", { class: "stat__label" }, [t("game.score")]),
        scoreValue,
      ]),
      el("div", { class: "stat stat--best" }, [
        el("span", { class: "stat__label" }, [t("level.goal")]),
        goalValue,
      ]),
      el("div", { class: "stat stat--best" }, [
        el("span", { class: "stat__label" }, [t("level.trays")]),
        traysValue,
      ]),
    ]),
    el("div", { class: "hud__meta" }, [
      el("div", { class: "modetag", "data-testid": "modetag" }, [t("level.tag", { n: no })]),
    ]),
  ]);
  const play = el("div", { class: "game__play" }, [boardView.root, trayView.root]);
  container.appendChild(
    el("div", { class: "screen game", "data-testid": "level-screen" }, [hud, play]),
  );

  function renderAll(): void {
    const fx = fxOptions();
    boardView.render(state.board);
    trayView.render(state.tray);
    renderNumber(scoreValue, formatNumber(state.score), fx);
    const goal = state.level?.goal ?? 0;
    goalValue.textContent = `${Math.min(state.linesCleared, goal)}/${goal}`;
    traysValue.textContent = String(traysLeft(state));
  }

  function persist(): void {
    if (state.status !== "playing") return;
    saveSavedGame(KEYS.gameLevel, { state: serialize(state), activeMs });
  }

  /* 配置 */
  const host: PlacementHost = {
    size: state.size,
    isPlaying: () => state.status === "playing" && overlay === null,
    pieceAt: (index) => state.tray[index] ?? null,
    preview(index, x, y): PlacementPreview {
      const piece: Piece | null = state.tray[index] ?? null;
      const shape = piece === null ? undefined : getShape(piece.shapeId);
      if (shape === undefined) return { valid: false, cells: [], color: 0, rows: [], cols: [] };
      if (!canPlace(state.board, state.size, shape, x, y)) {
        return { valid: false, cells: [], color: shape.color, rows: [], cols: [] };
      }
      const lines = completedLines(placeShape(state.board, state.size, shape, x, y), state.size);
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
      const fx = fxOptions();
      state = next;
      renderAll();
      persist();

      const clearedSet = new Set(result.clearedCells.map(([cx, cy]) => `${cx},${cy}`));
      dropFx(
        boardView,
        result.placedCells.filter(([cx, cy]) => !clearedSet.has(`${cx},${cy}`)),
        delta,
        fx,
      );
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
      if (result.boardCleared)
        boardClearFx(boardView, t("fx.boardClear", { n: config.scoring.boardClearBonus }), fx);
      const lines = result.clearedRows.length + result.clearedCols.length;
      announce(
        lines > 0
          ? t("a11y.placed", { points: result.scoreDelta, lines })
          : t("a11y.placedOnly", { points: result.scoreDelta }),
      );

      if (result.levelCleared === true) void finish("clear", false);
      else if (result.gameOver) void finish("over", result.outOfTrays === true);
    },
  };

  const previewClears = () => settingsStore.get().previewClears && config.input.previewClears;
  const drag = createDrag({
    boardView,
    trayView,
    host,
    config,
    reduced: reducedMotion,
    previewClears,
  });
  const keyboard = createKeyboard({
    boardView,
    trayView,
    host,
    previewClears,
    isDragging: drag.isDragging,
  });

  /* 終了 */
  async function finish(reason: "clear" | "over", outOfTrays: boolean): Promise<void> {
    if (ended) return;
    ended = true;
    tick();
    remove(KEYS.gameLevel);
    const stars = starsFor(state, config.levels);
    if (reason === "clear" && stars > 0) {
      saveLevelResult(no, { stars: stars as 1 | 2 | 3, score: state.score });
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
      isPractice: 0,
      fillRatioAtEnd: fillRatio(state.board),
    });
    if (reason === "over") trayView.markDead();
    await gameOverDelay(fxOptions());
    showOverlay(reason, stars, outOfTrays);
  }

  function showOverlay(reason: "clear" | "over", stars: number, outOfTrays: boolean): void {
    keyboard.deselect();
    const goal = state.level?.goal ?? 0;
    const actions = el("div", { class: "overlay__actions" });
    if (reason === "clear") {
      actions.append(
        button({
          label: t("level.next"),
          variant: "primary",
          testId: "level-next",
          onClick: () => navigate(`/level?n=${no + 1}`),
        }),
        button({
          label: t("level.retry"),
          variant: "secondary",
          testId: "level-retry",
          onClick: restart,
        }),
      );
    } else {
      actions.append(
        button({
          label: t("level.retry"),
          variant: "primary",
          testId: "level-retry",
          onClick: restart,
        }),
      );
    }
    actions.appendChild(
      button({
        label: t("level.list"),
        variant: "secondary",
        testId: "level-list",
        onClick: () => navigate("/levels"),
      }),
    );

    const panel = el("div", { class: "overlay__panel" }, [
      el("div", { class: "overlay__title" }, [
        reason === "clear"
          ? t("level.clear.title", { n: no })
          : t("level.fail.title", { n: goal - state.linesCleared }),
      ]),
      reason === "clear"
        ? starsView(stars, "level-stars")
        : el(
            "div",
            { class: "overlay__rank overlay__rank--muted", "data-testid": "level-fail-reason" },
            [t(outOfTrays ? "level.fail.trays" : "level.fail.stuck")],
          ),
      el("div", { class: "overlay__score", "data-testid": "final-score" }, [
        formatNumber(state.score),
      ]),
      actions,
    ]);
    overlay = el(
      "div",
      {
        class: "overlay",
        role: "dialog",
        "aria-modal": "true",
        "aria-label": reason === "clear" ? t("level.clear.title", { n: no }) : t("a11y.gameOver"),
        "data-testid": reason === "clear" ? "level-clear" : "gameover",
      },
      [panel],
    );
    document.body.appendChild(overlay);
    overlay.querySelector<HTMLButtonElement>("button")?.focus();
  }

  function restart(): void {
    overlay?.remove();
    overlay = null;
    ended = false;
    activeMs = 0;
    lastTick = Date.now();
    state = newLevelGame(config, no, Date.now(), variant);
    renderAll();
    persist();
    track({ event: "game_start", resumed: 0, isPractice: 0 });
  }

  /* 起動 */
  updateContext({ mode: "level" });
  renderAll();
  persist();
  track({ event: "game_start", resumed: resumed ? 1 : 0, isPractice: 0 });

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
      music.destroy();
      drag.destroy();
      keyboard.destroy();
      overlay?.remove();
      overlay = null;
    },
  };
}
