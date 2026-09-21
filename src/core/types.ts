/**
 * コアの型契約(docs/02 §3)。
 *
 * `src/core` は何も import しない純粋層なので、`ResolvedConfig` の *型* もここに置く。
 * zod スキーマ(`src/config/schema.ts`)はこの型に一致することをコンパイル時に検証する
 * (依存方向 core ← config を保つため。docs/02 §11 N-1)。
 */

/** 盤のセル。0 = 空、1..6 = 色インデックス、7 = 素焼きの欠片(レベルの障害物。docs/09 §1)。 */
export type Cell = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

/** 素焼きの欠片のセル値。 */
export const OBSTACLE: Cell = 7;

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

export type Mode = "endless" | "daily" | "level";
/** `cleared` はレベルモードだけ(目標の列数に達した)。 */
export type Status = "playing" | "over" | "cleared";

/** レベルモードの面の情報(docs/09 §3)。 */
export interface LevelInfo {
  readonly no: number;
  /** 目標の列数。 */
  readonly goal: number;
  /** 使えるトレイの数(= ラウンドの上限)。 */
  readonly trayLimit: number;
}

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
  /** レベルモードだけ。エンドレス・デイリーでは持たない(保存形式を変えない)。 */
  readonly level?: LevelInfo;
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
  /** レベルモード: この手で目標に達した。 */
  levelCleared?: boolean;
  /** レベルモード: トレイを使い切って失敗した。 */
  outOfTrays?: boolean;
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

/** BGM(docs/10 §5)。音源は持たず、この値から合成する。 */
export interface AudioConfig {
  /** テンポ(1 分あたりの拍)。 */
  readonly bpm: number;
  /** BGM の音量 0〜1。 */
  readonly volume: number;
  /** 効果音の音量 0〜1。 */
  readonly sfxVolume: number;
}

export interface FxConfig {
  readonly clearDurationMs: number;
  readonly snapDurationMs: number;
}

/** レベルの難易度(docs/09 §2)。 */
export interface LevelsConfig {
  readonly goalBase: number;
  readonly goalPerLevel: number;
  readonly goalMax: number;
  readonly traysPerLineStart: number;
  readonly traysPerLineEnd: number;
  readonly traysPerLineStep: number;
  readonly obstaclesPerLevel: number;
  readonly obstaclesMax: number;
  readonly starThree: number;
  readonly starTwo: number;
}

export interface ResolvedConfig {
  readonly schemaVersion: number;
  readonly board: { readonly size: number };
  readonly pieces: PiecesConfig;
  readonly scoring: ScoringConfig;
  readonly input: InputConfig;
  readonly daily: DailyConfig;
  readonly fx: FxConfig;
  readonly audio: AudioConfig;
  readonly levels: LevelsConfig;
}
