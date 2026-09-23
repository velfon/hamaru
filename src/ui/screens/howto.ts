/**
 * 遊び方(docs/01 §9.7)。
 *
 * 逆手のルールは読んで分かるものではないので、**この画面は説明しない。動かす。**
 * 5×5 の小さな窯を出し、プレイヤーが 1 手置く。すると窓のまわりにあった形が
 * 手に返ってくる。説明文は「いま起きたこと」を後から言うだけで、先回りしない。
 *
 * 見本は **core の `place` をそのまま呼ぶ**(docs/02 §3)。別実装を持たないので、
 * ルールを変えたときに見本だけが古くなることが起きない。
 *
 * 文言は初回 JS に載せず、開いた時に読み込む(about と同じ。docs/02 §11 N-15)。
 * **この 14 キーを常時読み込みに入れると、ホームもゲームも LCP が 1.39 → 1.54 秒に落ちる**
 * (シミュレート回線の往復境界をまたぐ。docs/06 §9 N-11)。
 */
import { DEFAULT_CONFIG } from "../../config";
import { validPositions } from "../../core/board";
import { nextPieceSize, place } from "../../core/game";
import { colorFor } from "../../core/derive";
import type { GameState } from "../../core/types";
import { addMessages, getLang, t } from "../../i18n";
import { markHowtoSeen } from "../../storage/local";
import { button, iconButton, ICON_BACK } from "../components/button";
import { el } from "../dom";
import { navigate, type Screen } from "../router";

/**
 * 見本の窯。本編の 10×10 より狭くして、**1 列そろうところまで数手で届く**ようにする。
 * 5×5 まで詰めると熱の育ちに盤が追いつかず 3 手で詰んでしまったので 6×6。
 */
const N = 6;
/**
 * 見本の初期配置。1 手目でどこに置いても何かが返るように散らし、
 * 最下段は 4 マス埋めておく(2 手で 1 列そろう = 消去まで見せられる)。
 */
const START: ReadonlyArray<readonly [number, number, number]> = [
  [1, 1, 2],
  [2, 1, 2],
  [1, 2, 4],
  [4, 3, 6],
  [0, 5, 1],
  [1, 5, 1],
  [2, 5, 1],
  [3, 5, 1],
];

type Beat = "first" | "returned" | "empty" | "hot" | "cleared" | "stuck";

function startState(): GameState {
  const board = new Uint8Array(N * N);
  for (const [x, y, color] of START) board[y * N + x] = color;
  return {
    version: 2,
    mode: "endless",
    seed: "howto",
    size: N,
    board,
    piece: { cells: [[0, 0]], color: colorFor(0) },
    // 熱 0 だと返ってくるのが必ず 1 マスで、**肝心の「形が返る」が見えない**。
    // 見本は少し温めた状態から始めて、1 手目から形が返るようにする。
    heat: 1,
    score: 0,
    streak: 0,
    longestStreak: 0,
    moves: 0,
    linesCleared: 0,
    status: "playing",
    startedAt: 0,
  };
}

/** 窓(3×3)にタイルが残っているか。「まわりに何も無かった」を正しく言うために数える。 */
function countWindowTiles(
  state: GameState,
  cx: number,
  cy: number,
  placed: ReadonlyArray<readonly [number, number]>,
): number {
  const just = new Set(placed.map(([x, y]) => `${x},${y}`));
  let n = 0;
  for (let y = cy - 1; y <= cy + 1; y++) {
    for (let x = cx - 1; x <= cx + 1; x++) {
      if (x < 0 || y < 0 || x >= N || y >= N) continue;
      if (state.board[y * N + x] === 0) continue;
      if (just.has(`${x},${y}`)) continue;
      n++;
    }
  }
  return n;
}

function render(container: HTMLElement, next: string): void {
  let state = startState();

  /* 窯(見本) --------------------------------------------------------- */
  const cells: HTMLElement[] = [];
  const boardEl = el("div", {
    class: "board howto__board",
    role: "img",
    "aria-label": t("howto.demoLabel"),
  });
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const cell = el("div", { class: "cell", "data-c": "0", "data-x": x, "data-y": y });
      cells.push(cell);
      boardEl.appendChild(cell);
    }
  }

  /* 手持ちと熱 -------------------------------------------------------- */
  const slot = el("div", { class: "howto__slot", "data-testid": "howto-hand" });
  const heat = el("div", { class: "heat" });

  /* いま起きたことを言う 1 行(先回りしない) --------------------------- */
  const caption = el("p", {
    class: "howto__caption",
    "aria-live": "polite",
    "data-testid": "howto-caption",
  });

  function paintHand(): void {
    let w = 0;
    let h = 0;
    for (const [x, y] of state.piece.cells) {
      if (x + 1 > w) w = x + 1;
      if (y + 1 > h) h = y + 1;
    }
    const grid = el("div", { class: "slot__grid" });
    grid.style.gridTemplateColumns = `repeat(${w}, var(--unit))`;
    grid.style.gridTemplateRows = `repeat(${h}, var(--unit))`;
    const filled = new Set(state.piece.cells.map(([dx, dy]) => `${dx},${dy}`));
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        grid.appendChild(
          el("div", {
            class: "cell",
            "data-c": filled.has(`${x},${y}`) ? String(state.piece.color) : "0",
          }),
        );
      }
    }
    slot.replaceChildren(grid);
    // 点の数は**次に返ってくる**かけらの大きさ(= 熱)。手に持っている数ではない。
    const next = nextPieceSize(state, DEFAULT_CONFIG);
    heat.replaceChildren(
      el("span", { class: "heat__label" }, [t("howto.next")]),
      ...Array.from({ length: next }, () => el("span", { class: "heat__pip" })),
    );
  }

  function paintBoard(): void {
    for (let i = 0; i < cells.length; i++) {
      (cells[i] as HTMLElement).dataset["c"] = String(state.board[i] ?? 0);
    }
  }

  function say(beat: Beat): void {
    caption.textContent = t(`howto.step.${beat}`);
  }

  /** 次のかけらが「どこから返ってきたか」を金の枠で見せる(1 回だけ光る)。 */
  function flashWindow(cx: number, cy: number): void {
    for (const cell of cells) {
      const x = Number(cell.dataset["x"]);
      const y = Number(cell.dataset["y"]);
      const inWindow = Math.abs(x - cx) <= 1 && Math.abs(y - cy) <= 1;
      if (inWindow) cell.dataset["window"] = "1";
      else delete cell.dataset["window"];
    }
    window.setTimeout(() => {
      for (const cell of cells) delete cell.dataset["window"];
    }, 900);
  }

  function step(x: number, y: number): void {
    const before = state;
    const { state: next, result } = place(before, DEFAULT_CONFIG, x, y);
    if (!result.ok) return;
    state = next;
    paintBoard();
    paintHand();

    let sx = 0;
    let sy = 0;
    for (const [px, py] of result.placedCells) {
      sx += px;
      sy += py;
    }

    const cx = Math.round(sx / result.placedCells.length);
    const cy = Math.round(sy / result.placedCells.length);
    const windowHadTiles = countWindowTiles(state, cx, cy, result.placedCells) > 0;

    flashWindow(cx, cy);

    if (result.gameOver) say("stuck");
    else if (result.clearedRows.length + result.clearedCols.length > 0) say("cleared");
    // 1 手目はまず「形が返る」ことだけを言う。熱の話はその次から。
    else if (state.moves === 1 && windowHadTiles) say("returned");
    else if (!windowHadTiles) say("empty");
    else if (state.piece.cells.length > before.piece.cells.length) say("hot");
    else say("returned");
    updateButtons();
  }

  /**
   * キーボードと読み上げのための等価な操作。適当に置くと数手で詰んで何も学べないので、
   * sim の greedy と同じ考え方(消せる手を優先し、盤を散らかさない)で 1 手選ぶ。
   */
  function stepAuto(): void {
    let best: [number, number] | null = null;
    let bestValue = -Infinity;
    for (const [x, y] of validPositions(state.board, N, state.piece)) {
      const { state: after, result } = place(state, DEFAULT_CONFIG, x, y);
      if (!result.ok) continue;
      let filled = 0;
      for (const cell of after.board) if (cell !== 0) filled++;
      const value =
        (result.clearedRows.length + result.clearedCols.length) * 120 -
        after.piece.cells.length * 5 -
        filled * 0.4 -
        (result.gameOver ? 500 : 0);
      if (value > bestValue) {
        bestValue = value;
        best = [x, y];
      }
    }
    if (best !== null) step(best[0], best[1]);
  }

  function reset(): void {
    state = startState();
    paintBoard();
    paintHand();
    say("first");
    updateButtons();
  }

  const autoButton = button({
    label: t("howto.auto"),
    variant: "secondary",
    block: false,
    testId: "howto-auto",
    onClick: stepAuto,
  });
  const resetButton = button({
    label: t("howto.reset"),
    variant: "ghost",
    block: false,
    testId: "howto-reset",
    onClick: reset,
  });

  function updateButtons(): void {
    autoButton.disabled = state.status !== "playing";
  }

  boardEl.addEventListener("click", (ev) => {
    const target = (ev.target as HTMLElement).closest<HTMLElement>(".cell");
    if (target === null || state.status !== "playing") return;
    step(Number(target.dataset["x"]), Number(target.dataset["y"]));
  });

  paintBoard();
  paintHand();
  say("first");
  updateButtons();

  const screen = el("div", { class: "screen howto", "data-testid": "howto-screen" }, [
    el("div", { class: "topbar" }, [
      iconButton({
        label: t("game.back"),
        paths: ICON_BACK,
        testId: "back",
        onClick: () => navigate("/"),
      }),
      el("h1", { class: "topbar__title" }, [t("howto.title")]),
      el("div", { class: "topbar__spacer" }),
    ]),
    el("p", { class: "howto__lead" }, [t("howto.lead")]),
    el("div", { class: "howto__stage" }, [
      boardEl,
      el("div", { class: "howto__hand" }, [slot, heat]),
    ]),
    caption,
    el("div", { class: "howto__controls" }, [autoButton, resetButton]),
    el("p", { class: "howto__luck" }, [t("howto.luck")]),
    button({
      label: t("howto.start"),
      variant: "primary",
      testId: "howto-start",
      onClick: () => {
        markHowtoSeen();
        navigate(next);
      },
    }),
  ]);
  container.replaceChildren(screen);
}

export function howtoScreen(container: HTMLElement, query: URLSearchParams): Screen {
  // 開いた時点で「見た」とする(§9.7 の自動導線は 1 回だけ)。
  markHowtoSeen();
  // 行き先はホームが渡す。アプリ内のパスだけを受け取る(外部 URL へ飛ばさない)。
  const raw = query.get("next") ?? "/play";
  const next = raw.startsWith("/") && !raw.startsWith("//") ? raw : "/play";
  let unmounted = false;
  // 文言が届くまでは空の枠(ほぼ一瞬で入れ替わる)。
  container.appendChild(el("div", { class: "screen howto", "data-testid": "howto-screen" }));
  const lang = getLang();
  const loading =
    lang === "ja" ? import("../../i18n/howto.ja.json") : import("../../i18n/howto.en.json");
  void loading.then(
    (file) => {
      if (unmounted) return;
      addMessages(lang, file.default);
      render(container, next);
    },
    () => {
      /* 版の入れ替え直後など。開き直せば読み込み直す */
    },
  );

  return {
    unmount() {
      unmounted = true;
    },
  };
}
