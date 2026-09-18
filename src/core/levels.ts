/**
 * レベルモード(docs/09)。面の生成・目標・星。すべて純粋関数。
 *
 * レベル N の面は固定シード `level:N` から作るので、全員が同じ面を遊ぶ。
 */
import { anyFits, createBoard } from "./board";
import { createRng, cyrb53 } from "./rng";
import { generateTray } from "./tray";
import {
  OBSTACLE,
  type GameState,
  type LevelInfo,
  type LevelsConfig,
  type ResolvedConfig,
} from "./types";

export interface LevelParams extends LevelInfo {
  /** 開始時の素焼きの欠片の数。 */
  readonly obstacles: number;
}

/**
 * レベル N の面のシード。variant は「強いボットが解けた候補」の番号(docs/09 §4)。
 * variant 0 は `level:N`(表が無いときの既定)。
 */
export function levelSeed(no: number, variant = 0): string {
  return variant <= 0 ? `level:${no}` : `level:${no}:${variant}`;
}

/** レベル N の目標・トレイ上限・欠片の数(docs/09 §2 の式)。 */
export function levelParams(levels: LevelsConfig, no: number): LevelParams {
  const n = Math.max(1, Math.floor(no));
  const goal = Math.min(
    levels.goalMax,
    levels.goalBase + Math.floor((n - 1) * levels.goalPerLevel),
  );
  const perLine = Math.max(
    levels.traysPerLineEnd,
    levels.traysPerLineStart - levels.traysPerLineStep * (n - 1),
  );
  const trayLimit = Math.max(1, Math.ceil(goal * perLine - 1e-9));
  const obstacles = Math.min(levels.obstaclesMax, Math.floor((n - 1) * levels.obstaclesPerLevel));
  return { no: n, goal, trayLimit, obstacles };
}

/**
 * 欠片を置いた盤。行や列を満杯にする位置には置かない(開始時に消える列を作らない)。
 * 乱数は面のシードと同じ列から先に使う(その後にトレイを配る)。
 */
function obstacleBoard(size: number, count: number, next: () => number): Uint8Array {
  const board = createBoard(size);
  const rowFill = new Array<number>(size).fill(0);
  const colFill = new Array<number>(size).fill(0);
  let placed = 0;
  for (let attempts = 0; placed < count && attempts < count * 50; attempts++) {
    const i = Math.floor(next() * size * size);
    const x = i % size;
    const y = Math.floor(i / size);
    if (board[i] !== 0) continue;
    if ((rowFill[y] as number) + 1 >= size || (colFill[x] as number) + 1 >= size) continue;
    board[i] = OBSTACLE;
    rowFill[y] = (rowFill[y] as number) + 1;
    colFill[x] = (colFill[x] as number) + 1;
    placed++;
  }
  return board;
}

/** レベル N の新しいゲーム。`now` は epoch ms(ロジックには使わない)。 */
export function newLevelGame(
  config: ResolvedConfig,
  no: number,
  now: number,
  variant = 0,
): GameState {
  const params = levelParams(config.levels, no);
  const size = config.board.size;
  const seed = levelSeed(params.no, variant);
  const rng = createRng(seed);
  const board = obstacleBoard(size, params.obstacles, () => rng.next());
  const tray = generateTray(rng, board, config);
  return {
    version: 1,
    mode: "level",
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
    level: { no: params.no, goal: params.goal, trayLimit: params.trayLimit },
  };
}

/** クリアしたときの星(1〜3)。クリアしていなければ 0。 */
export function starsFor(state: GameState, levels: LevelsConfig): 0 | 1 | 2 | 3 {
  if (state.status !== "cleared" || state.level === undefined) return 0;
  const limit = state.level.trayLimit;
  if (state.round <= Math.ceil(limit * levels.starThree - 1e-9)) return 3;
  if (state.round <= Math.ceil(limit * levels.starTwo - 1e-9)) return 2;
  return 1;
}

/** 残りのトレイ数(今のトレイを含む)。 */
export function traysLeft(state: GameState): number {
  return state.level === undefined
    ? Infinity
    : Math.max(0, state.level.trayLimit - state.round + 1);
}

/** 面の表(`src/config/levels-table.json`)が収録するレベル数。これより先は variant 0。 */
export const LEVEL_TABLE_SIZE = 200;

/** 面の候補を試す回数の上限(docs/09 §4)。 */
export const MAX_LEVEL_VARIANTS = 40;

/**
 * 面の表が前提にしている config のハッシュ。面の生成と解けるかどうかに効く部分
 * (盤・ピース・配点・レベル)だけを、キーの順序に依存しない形で固める。
 * 値が変わったら `npm run levels:table` で表を作り直す(`validate:config` が検出する)。
 */
export function levelsConfigHash(config: ResolvedConfig): string {
  const stable = (v: unknown): unknown =>
    v !== null && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(
          Object.keys(v as Record<string, unknown>)
            .sort()
            .map((k) => [k, stable((v as Record<string, unknown>)[k])]),
        )
      : v;
  const payload = JSON.stringify(
    stable({
      board: config.board,
      pieces: config.pieces,
      scoring: config.scoring,
      levels: config.levels,
    }),
  );
  return cyrb53(payload).toString(16);
}

export interface LevelsTable {
  readonly schemaVersion: 1;
  readonly configHash: string;
  /** index = レベル - 1。値は採用した variant。-1 は解ける候補が見つからなかった(variant 0 で遊ぶ)。 */
  readonly variants: readonly number[];
}

/** 表からレベル N の variant を引く(表の外・見つからなかった面は 0)。 */
export function levelVariant(table: LevelsTable, no: number): number {
  const v = table.variants[no - 1];
  return v === undefined || v < 0 ? 0 : v;
}
