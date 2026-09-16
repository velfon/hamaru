/**
 * ゲーム状態の遷移(docs/01 §5、docs/02 §3)。
 * すべて純粋関数。`place` は引数の state / board を変更せず、新しい state を返す。
 */
import {
  anyFits,
  canPlace,
  clearLines,
  createBoard,
  isBoardEmpty,
  placeShape,
  shapeCellsAt,
} from "./board";
import { rngFromState, createRng } from "./rng";
import { getShape } from "./shapes";
import { scorePlacement } from "./scoring";
import { TRAY_SIZE, generateTray } from "./tray";
import type { Board, GameState, Mode, Piece, PlaceResult, ResolvedConfig, Status } from "./types";

function failedResult(): PlaceResult {
  return {
    ok: false,
    placedCells: [],
    clearedRows: [],
    clearedCols: [],
    clearedCells: [],
    scoreDelta: 0,
    streakAfter: 0,
    boardCleared: false,
    newTray: false,
    gameOver: false,
  };
}

/** 新しいゲームを開始する。`now` は epoch ms(呼び出し側が渡す)。 */
export function newGame(config: ResolvedConfig, mode: Mode, seed: string, now: number): GameState {
  const size = config.board.size;
  const board = createBoard(size);
  const rng = createRng(seed);
  const tray = generateTray(rng, board, config);
  return {
    version: 1,
    mode,
    seed,
    rng: rng.getState(),
    size,
    board,
    tray,
    score: 0,
    streak: 0,
    longestStreak: 0,
    round: 1,
    moves: 0,
    linesCleared: 0,
    status: anyFits(board, size, tray) ? "playing" : "over",
    startedAt: now,
  };
}

/** トレイの trayIndex のピースを (x, y) に置く。 */
export function place(
  state: GameState,
  config: ResolvedConfig,
  trayIndex: number,
  x: number,
  y: number,
): { state: GameState; result: PlaceResult } {
  if (state.status !== "playing") return { state, result: failedResult() };
  if (!Number.isInteger(trayIndex) || trayIndex < 0 || trayIndex >= TRAY_SIZE) {
    return { state, result: failedResult() };
  }
  const piece = state.tray[trayIndex];
  if (piece === null || piece === undefined) return { state, result: failedResult() };
  const shape = getShape(piece.shapeId);
  if (shape === undefined) return { state, result: failedResult() };

  const size = state.size;
  if (!canPlace(state.board, size, shape, x, y)) return { state, result: failedResult() };

  const placedCells = shapeCellsAt(shape, x, y);
  const filled = placeShape(state.board, size, shape, x, y);
  const cleared = clearLines(filled, size);
  const lines = cleared.rows.length + cleared.cols.length;

  const streakAfter = lines > 0 ? state.streak + 1 : 0;
  const boardCleared = lines > 0 && isBoardEmpty(cleared.board);
  const scoreDelta = scorePlacement(
    { cellCount: shape.cells.length, lines, streakAfter, boardCleared },
    config.scoring,
  );

  let tray: Array<Piece | null> = state.tray.map((p, i) => (i === trayIndex ? null : p));
  let rngState = state.rng;
  let round = state.round;
  const newTray = tray.every((p) => p === null);
  if (newTray) {
    const rng = rngFromState(state.rng);
    tray = generateTray(rng, cleared.board, config);
    rngState = rng.getState();
    round += 1;
  }

  const gameOver = !anyFits(cleared.board, size, tray);
  const status: Status = gameOver ? "over" : "playing";

  const next: GameState = {
    ...state,
    rng: rngState,
    board: cleared.board,
    tray,
    score: state.score + scoreDelta,
    streak: streakAfter,
    longestStreak: Math.max(state.longestStreak, streakAfter),
    round,
    moves: state.moves + 1,
    linesCleared: state.linesCleared + lines,
    status,
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
      newTray,
      gameOver,
    },
  };
}

/* ------------------------------------------------------------------ */
/* 直列化                                                              */
/* ------------------------------------------------------------------ */

const B64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const B64_LOOKUP = new Map<string, number>(
  B64_CHARS.split("").map((c, i): [string, number] => [c, i]),
);

/** Uint8Array → base64(環境依存の btoa / Buffer を使わない純粋実装)。 */
export function encodeBoard(board: Board): string {
  let out = "";
  for (let i = 0; i < board.length; i += 3) {
    const b0 = board[i] ?? 0;
    const b1 = board[i + 1];
    const b2 = board[i + 2];
    out += B64_CHARS[b0 >> 2];
    out += B64_CHARS[((b0 & 0b11) << 4) | ((b1 ?? 0) >> 4)];
    out += b1 === undefined ? "=" : B64_CHARS[((b1 & 0b1111) << 2) | ((b2 ?? 0) >> 6)];
    out += b2 === undefined ? "=" : B64_CHARS[b2 & 0b111111];
  }
  return out;
}

/** base64 → Uint8Array。壊れていれば null。 */
export function decodeBoard(s: string): Uint8Array | null {
  if (s.length % 4 !== 0) return null;
  const groups = s.length / 4;
  if (groups === 0) return new Uint8Array(0);

  let padding = 0;
  if (s.endsWith("==")) padding = 2;
  else if (s.endsWith("=")) padding = 1;

  const bytes = new Uint8Array(groups * 3 - padding);
  let o = 0;
  for (let i = 0; i < s.length; i += 4) {
    const chunk = [0, 1, 2, 3].map((k) => {
      const ch = s[i + k] as string;
      if (ch === "=") return 0;
      const v = B64_LOOKUP.get(ch);
      return v === undefined ? -1 : v;
    });
    if (chunk.some((v) => v < 0)) return null;
    const [c0, c1, c2, c3] = chunk as [number, number, number, number];
    const triple = (c0 << 18) | (c1 << 12) | (c2 << 6) | c3;
    if (o < bytes.length) bytes[o++] = (triple >> 16) & 0xff;
    if (o < bytes.length) bytes[o++] = (triple >> 8) & 0xff;
    if (o < bytes.length) bytes[o++] = triple & 0xff;
  }
  return bytes;
}

interface SerializedState {
  version: number;
  mode: string;
  seed: string;
  rng: number;
  size: number;
  board: string;
  tray: Array<string | null>;
  score: number;
  streak: number;
  longestStreak: number;
  round: number;
  moves: number;
  linesCleared: number;
  status: string;
  startedAt: number;
}

export function serialize(state: GameState): string {
  const payload: SerializedState = {
    version: state.version,
    mode: state.mode,
    seed: state.seed,
    rng: state.rng,
    size: state.size,
    board: encodeBoard(state.board),
    tray: state.tray.map((p) => (p === null || p === undefined ? null : p.shapeId)),
    score: state.score,
    streak: state.streak,
    longestStreak: state.longestStreak,
    round: state.round,
    moves: state.moves,
    linesCleared: state.linesCleared,
    status: state.status,
    startedAt: state.startedAt,
  };
  return JSON.stringify(payload);
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/** 壊れていれば null を返す(docs/06 §8「エラー経路」)。 */
export function deserialize(s: string): GameState | null {
  let raw: unknown;
  try {
    raw = JSON.parse(s);
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;

  if (o["version"] !== 1) return null;
  if (o["mode"] !== "endless" && o["mode"] !== "daily") return null;
  if (o["status"] !== "playing" && o["status"] !== "over") return null;
  if (typeof o["seed"] !== "string") return null;
  if (typeof o["board"] !== "string") return null;

  const numeric = [
    "rng",
    "size",
    "score",
    "streak",
    "longestStreak",
    "round",
    "moves",
    "linesCleared",
    "startedAt",
  ];
  for (const key of numeric) {
    if (!isFiniteNumber(o[key])) return null;
  }
  const size = o["size"] as number;
  if (!Number.isInteger(size) || size < 1 || size > 64) return null;

  const board = decodeBoard(o["board"]);
  if (board === null || board.length !== size * size) return null;
  for (let i = 0; i < board.length; i++) {
    if ((board[i] as number) > 6) return null;
  }

  const trayRaw = o["tray"];
  if (!Array.isArray(trayRaw) || trayRaw.length !== TRAY_SIZE) return null;
  const tray: Array<Piece | null> = [];
  for (const entry of trayRaw) {
    if (entry === null) {
      tray.push(null);
      continue;
    }
    if (typeof entry !== "string" || getShape(entry) === undefined) return null;
    tray.push({ shapeId: entry });
  }

  return {
    version: 1,
    mode: o["mode"],
    seed: o["seed"],
    rng: o["rng"] as number,
    size,
    board,
    tray,
    score: o["score"] as number,
    streak: o["streak"] as number,
    longestStreak: o["longestStreak"] as number,
    round: o["round"] as number,
    moves: o["moves"] as number,
    linesCleared: o["linesCleared"] as number,
    status: o["status"],
    startedAt: o["startedAt"] as number,
  };
}
