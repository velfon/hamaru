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

/** かけらの色。0(空)を含まない。 */
export type Color = 1 | 2 | 3 | 4 | 5 | 6;

/** 盤。長さ size*size。`board[y * size + x]`。 */
export type Board = Uint8Array;

/** 形状の相対座標。`[dx, dy]`。 */
export type CellOffset = readonly [number, number];

/**
 * かけら(逆手のピース)。形は盤から derive されるので、カタログも ID も無い。
 * `cells` は正規化済み(左上が (0,0)、読み順)。
 */
export interface Piece {
  readonly cells: ReadonlyArray<CellOffset>;
  readonly color: Color;
}

export type Mode = "endless" | "daily" | "level";
/** `cleared` はレベルモードだけ(目標の列数に達した)。 */
export type Status = "playing" | "over" | "cleared";

/** レベルモードの面の情報(docs/09 §3)。 */
export interface LevelInfo {
  readonly no: number;
  /** 目標の列数。 */
  readonly goal: number;
  /** 使える手数の上限。 */
  readonly moveLimit: number;
}

export interface GameState {
  /** 2 = 逆手(docs/01)。1 は旧ルール(はめ込み)。 */
  readonly version: 2;
  readonly mode: Mode;
  readonly seed: string;
  readonly size: number;
  readonly board: Board;
  /** 手持ちは常に 1 個。 */
  readonly piece: Piece;
  /** 最後に消してからの手数。これが増えるほど次のかけらが大きくなる(docs/01 §5)。 */
  readonly heat: number;
  readonly score: number;
  readonly streak: number;
  readonly longestStreak: number;
  readonly moves: number;
  readonly linesCleared: number;
  readonly status: Status;
  /** epoch ms(演出・統計用。ロジックには使わない)。 */
  readonly startedAt: number;
  /** レベルモードだけ。 */
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
  /** この手のあとの熱(= 次のかけらの大きさを決める)。 */
  heatAfter: number;
  /** 次に配られるかけら。 */
  nextPiece: Piece;
  gameOver: boolean;
  /** レベルモード: この手で目標に達した。 */
  levelCleared?: boolean;
  /** レベルモード: 手数を使い切って失敗した。 */
  outOfMoves?: boolean;
}

/* ------------------------------------------------------------------ */
/* 設定(docs/02 §4.1)                                                 */
/* ------------------------------------------------------------------ */

/** 逆手のルール値(docs/01 §5)。 */
export interface SakateConfig {
  /** かけらの上限(マス数)。 */
  readonly maxPiece: number;
  /** 何手ごとにかけらが 1 マス育つか(消すと熱は 0 に戻る)。 */
  readonly growEvery: number;
  /** 次のかけらを読み取る窓の大きさ(奇数)。 */
  readonly window: number;
  /** 始めの盤に置いておくタイルの数。 */
  readonly startTiles: number;
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
  readonly movesPerLineStart: number;
  readonly movesPerLineEnd: number;
  readonly movesPerLineStep: number;
  readonly obstaclesPerLevel: number;
  readonly obstaclesMax: number;
  readonly starThree: number;
  readonly starTwo: number;
}

export interface ResolvedConfig {
  readonly schemaVersion: number;
  readonly board: { readonly size: number };
  readonly sakate: SakateConfig;
  readonly scoring: ScoringConfig;
  readonly input: InputConfig;
  readonly daily: DailyConfig;
  readonly fx: FxConfig;
  readonly audio: AudioConfig;
  readonly levels: LevelsConfig;
}
