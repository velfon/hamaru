/**
 * コアの型契約(docs/02 §3)。
 *
 * `src/core` は何も import しない純粋層なので、`ResolvedConfig` の *型* もここに置く。
 * zod スキーマ(`src/config/schema.ts`)はこの型に一致することをコンパイル時に検証する
 * (依存方向 core ← config を保つため。docs/02 §11 N-1)。
 */

/** 盤のセル。0 = 空、1..6 = 色インデックス。 */
export type Cell = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/** ピースの色。0(空)を含まない。 */
export type Color = 1 | 2 | 3 | 4 | 5 | 6;

/** 盤。長さ size*size。`board[y * size + x]`。 */
export type Board = Uint8Array;

/** 形状の相対座標。`[dx, dy]`。 */
export type CellOffset = readonly [number, number];

export interface Shape {
  readonly id: string;
  /** 原点 (0,0) を左上とする相対座標。min(dx) === 0 かつ min(dy) === 0。 */
  readonly cells: ReadonlyArray<CellOffset>;
  /** バウンディングボックスの幅 = max(dx) + 1。 */
  readonly w: number;
  /** バウンディングボックスの高さ = max(dy) + 1。 */
  readonly h: number;
  readonly color: Cell;
}

export interface Piece {
  readonly shapeId: string;
}

export type Mode = "endless" | "daily";
export type Status = "playing" | "over";

export interface GameState {
  readonly version: 1;
  readonly mode: Mode;
  readonly seed: string;
  /** mulberry32 の内部状態。途中再開しても同じ乱数列が続く。 */
  readonly rng: number;
  readonly size: number;
  readonly board: Board;
  /** 長さ 3。置き終わったスロットは null。 */
  readonly tray: ReadonlyArray<Piece | null>;
  readonly score: number;
  readonly streak: number;
  readonly longestStreak: number;
  readonly round: number;
  readonly moves: number;
  readonly linesCleared: number;
  readonly status: Status;
  /** epoch ms(演出・統計用。ロジックには使わない)。 */
  readonly startedAt: number;
}

export interface PlaceResult {
  ok: boolean;
  placedCells: Array<[number, number]>;
  clearedRows: number[];
  clearedCols: number[];
  clearedCells: Array<[number, number]>;
  scoreDelta: number;
  streakAfter: number;
  boardCleared: boolean;
  newTray: boolean;
  gameOver: boolean;
}

/* ------------------------------------------------------------------ */
/* 設定(docs/02 §4.1)                                                 */
/* ------------------------------------------------------------------ */

export type FitGuarantee = "none" | "oneOfThree";

export interface PityConfig {
  readonly enabled: boolean;
  /** 盤の埋まり率がこれ以上なら小形状の重みを底上げする。0〜1。 */
  readonly threshold: number;
  /** セル数 3 以下の形状の重み倍率。 */
  readonly smallBoost: number;
}

export interface PiecesConfig {
  /** 形状 ID → 重み。0〜5。 */
  readonly weights: Readonly<Record<string, number>>;
  readonly noTripleDuplicate: boolean;
  readonly fitGuarantee: FitGuarantee;
  readonly pity: PityConfig;
}

export interface StreakConfig {
  readonly step: number;
  readonly max: number;
}

export interface ScoringConfig {
  readonly perCell: number;
  readonly lineBase: number;
  readonly streak: StreakConfig;
  readonly boardClearBonus: number;
}

export interface InputConfig {
  readonly touchLiftOffset: number;
  readonly previewClears: boolean;
}

export interface DailyConfig {
  /** 通算 #1 になる UTC 日付(YYYY-MM-DD)。 */
  readonly epoch: string;
  readonly shareGaugeMax: number;
}

export interface FxConfig {
  readonly clearDurationMs: number;
  readonly snapDurationMs: number;
}

export interface ResolvedConfig {
  readonly schemaVersion: number;
  readonly board: { readonly size: number };
  readonly pieces: PiecesConfig;
  readonly scoring: ScoringConfig;
  readonly input: InputConfig;
  readonly daily: DailyConfig;
  readonly fx: FxConfig;
}
