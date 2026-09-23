/**
 * 逆手(さかて)の 1 ゲーム(docs/01 §5)。**純粋**。
 *
 * 手順(docs/01 §5.2):
 *   1. 手持ちのかけらを空きマスに置く
 *   2. 埋まった行・列を消す
 *   3. 得点を足す
 *   4. **熱**を更新する(消したら 0、消さなければ +1)
 *   5. 置いた場所から**次のかけらを作る**(docs/01 §5.3)
 *   6. そのかけらがどこにも置けなければ終わり
 *
 * 乱数を使うのは**始めの盤を作るときだけ**。その後の供給に運は無い。
 */
import { canPlace, clearLines, createBoard, isBoardEmpty, placePiece, pieceFits } from "./board";
import { colorFor, deriveNextPiece, pieceSizeFor } from "./derive";
import { makePiece, normalize } from "./piece";
import { createRng } from "./rng";
import { scorePlacement } from "./scoring";
import type { Board, GameState, Mode, Piece, PlaceResult, ResolvedConfig } from "./types";

/** 最初のかけらは必ず 1 マス(どこにでも置ける)。 */
export function seedPiece(): Piece {
  return makePiece([[0, 0]], colorFor(0));
}

/** 始めの盤。シードから決まる散らばり(ここだけが乱数)。 */
export function startBoard(config: ResolvedConfig, seed: string): Board {
  const size = config.board.size;
  const board = createBoard(size);
  const rng = createRng(seed);
  const tiles = Math.max(0, Math.min(size * size - 1, config.sakate.startTiles));
  let placed = 0;
  let guard = 0;
  while (placed < tiles && guard < tiles * 50) {
    guard++;
    const i = rng.nextInt(size * size);
    if (board[i] !== 0) continue;
    // 始めから行・列が埋まらないようにする(いきなり消えるのを防ぐ)
    board[i] = (placed % 6) + 1;
    placed++;
  }
  return board;
}

export function newGame(
  config: ResolvedConfig,
  mode: Mode,
  seed: string,
  startedAt: number,
): GameState {
  return {
    version: 2,
    mode,
    seed,
    size: config.board.size,
    board: startBoard(config, seed),
    piece: seedPiece(),
    heat: 0,
    score: 0,
    streak: 0,
    longestStreak: 0,
    moves: 0,
    linesCleared: 0,
    status: "playing",
    startedAt,
  };
}

const failed = (piece: Piece): PlaceResult => ({
  ok: false,
  placedCells: [],
  clearedRows: [],
  clearedCols: [],
  clearedCells: [],
  scoreDelta: 0,
  streakAfter: 0,
  boardCleared: false,
  heatAfter: 0,
  nextPiece: piece,
  gameOver: false,
});

/** 手持ちのかけらを (x, y)(左上基準)に置く。 */
export function place(
  state: GameState,
  config: ResolvedConfig,
  x: number,
  y: number,
): { state: GameState; result: PlaceResult } {
  if (state.status !== "playing" || !canPlace(state.board, state.size, state.piece, x, y)) {
    return { state, result: failed(state.piece) };
  }

  const placedCells = state.piece.cells.map(([dx, dy]): [number, number] => [x + dx, y + dy]);
  const filled = placePiece(state.board, state.size, state.piece, x, y);
  const cleared = clearLines(filled, state.size);
  const lines = cleared.rows.length + cleared.cols.length;
  const streakAfter = lines > 0 ? state.streak + 1 : 0;
  const boardCleared = lines > 0 && isBoardEmpty(cleared.board);
  const scoreDelta = scorePlacement(
    { cellCount: state.piece.cells.length, lines, streakAfter, boardCleared },
    config.scoring,
  );

  const heatAfter = lines > 0 ? 0 : state.heat + 1;
  const moves = state.moves + 1;
  const nextPiece = deriveNextPiece(
    cleared.board,
    state.size,
    placedCells,
    heatAfter,
    config.sakate,
    moves,
  );

  const level = state.level;
  const linesCleared = state.linesCleared + lines;
  const levelCleared = level !== undefined && linesCleared >= level.goal;
  const outOfMoves = level !== undefined && !levelCleared && moves >= level.moveLimit;
  const stuck = !pieceFits(cleared.board, state.size, nextPiece);
  const gameOver = levelCleared ? false : stuck || outOfMoves;

  const next: GameState = {
    ...state,
    board: cleared.board,
    piece: nextPiece,
    heat: heatAfter,
    score: state.score + scoreDelta,
    streak: streakAfter,
    longestStreak: Math.max(state.longestStreak, streakAfter),
    moves,
    linesCleared,
    status: levelCleared ? "cleared" : gameOver ? "over" : "playing",
  };

  return {
    state: next,
    result: {
      ok: true,
      placedCells,
      clearedRows: cleared.rows,
      clearedCols: cleared.cols,
      clearedCells: cleared.cells,
      scoreDelta,
      streakAfter,
      boardCleared,
      heatAfter,
      nextPiece,
      gameOver,
      ...(level !== undefined ? { levelCleared, outOfMoves } : {}),
    },
  };
}

/** 次のかけらの大きさ(UI の「熱」表示用)。 */
export function nextPieceSize(state: GameState, config: ResolvedConfig): number {
  return pieceSizeFor(state.heat, config.sakate);
}

/* ------------------------------------------------------------------ */
/* 保存形式(docs/01 §10)                                              */
/* ------------------------------------------------------------------ */

interface Serialized {
  version: 2;
  mode: Mode;
  seed: string;
  size: number;
  board: string;
  piece: { cells: Array<[number, number]>; color: number };
  heat: number;
  score: number;
  streak: number;
  longestStreak: number;
  moves: number;
  linesCleared: number;
  status: string;
  startedAt: number;
  level?: { no: number; goal: number; moveLimit: number };
}

const toBase64 = (bytes: Uint8Array): string => {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
};

const fromBase64 = (text: string): Uint8Array => {
  const binary = atob(text);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
};

export function serialize(state: GameState): string {
  const payload: Serialized = {
    version: 2,
    mode: state.mode,
    seed: state.seed,
    size: state.size,
    board: toBase64(state.board),
    piece: {
      cells: state.piece.cells.map(([x, y]): [number, number] => [x, y]),
      color: state.piece.color,
    },
    heat: state.heat,
    score: state.score,
    streak: state.streak,
    longestStreak: state.longestStreak,
    moves: state.moves,
    linesCleared: state.linesCleared,
    status: state.status,
    startedAt: state.startedAt,
    ...(state.level !== undefined ? { level: { ...state.level } } : {}),
  };
  return JSON.stringify(payload);
}

/** 壊れていれば null(呼び出し側はそのキーを捨てる)。 */
export function deserialize(text: string): GameState | null {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof data !== "object" || data === null) return null;
  const d = data as Partial<Serialized>;
  if (d.version !== 2) return null;
  if (d.mode !== "endless" && d.mode !== "daily" && d.mode !== "level") return null;
  if (typeof d.size !== "number" || d.size < 4 || d.size > 20) return null;
  if (typeof d.board !== "string" || typeof d.seed !== "string") return null;

  let board: Uint8Array;
  try {
    board = fromBase64(d.board);
  } catch {
    return null;
  }
  if (board.length !== d.size * d.size) return null;

  const cells = d.piece?.cells;
  if (!Array.isArray(cells) || cells.length === 0 || cells.length > 64) return null;
  for (const cell of cells) {
    if (!Array.isArray(cell) || cell.length !== 2) return null;
    if (!Number.isInteger(cell[0]) || !Number.isInteger(cell[1])) return null;
  }
  const color = d.piece?.color;
  if (typeof color !== "number" || color < 1 || color > 6) return null;

  const num = (v: unknown, fallback = 0): number =>
    typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : fallback;

  const status = d.status === "over" || d.status === "cleared" ? d.status : "playing";
  const level =
    d.level !== undefined &&
    typeof d.level.no === "number" &&
    d.level.no >= 1 &&
    typeof d.level.goal === "number" &&
    typeof d.level.moveLimit === "number"
      ? { no: d.level.no, goal: d.level.goal, moveLimit: d.level.moveLimit }
      : undefined;
  // `cleared` はレベルだけ。level なしの cleared は壊れた保存。
  if (status === "cleared" && level === undefined) return null;
  if (d.mode === "level" && level === undefined) return null;

  return {
    version: 2,
    mode: d.mode,
    seed: d.seed,
    size: d.size,
    board,
    piece: makePiece(
      normalize(cells.map(([x, y]) => [x, y] as const)),
      color as GameState["piece"]["color"],
    ),
    heat: num(d.heat),
    score: num(d.score),
    streak: num(d.streak),
    longestStreak: num(d.longestStreak),
    moves: num(d.moves),
    linesCleared: num(d.linesCleared),
    status,
    startedAt: num(d.startedAt),
    ...(level !== undefined ? { level } : {}),
  };
}
