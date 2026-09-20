/**
 * localStorage ラッパ(docs/01 §10)。
 *
 * - キー接頭辞 `hamaru:v1:`、値は `{ schemaVersion, data }` の JSON。
 * - 読み込みは `migrate()` → 検証 の順。壊れていれば**そのキーだけ**初期化する。
 * - localStorage が使えない環境(プライベートモード等)はメモリ内フォールバックで動く。
 *   保存できない旨は UI に出さない。
 * - 容量超過は `telemetry:queue` を捨ててから 1 回だけ再試行する(docs/01 §13)。
 */
import { envelope, migrate } from "./migrate";

export const PREFIX = "hamaru:v1:";

export const KEYS = {
  install: "install",
  settings: "settings",
  stats: "stats",
  gameEndless: "game:endless",
  gameDaily: "game:daily",
  dailyResults: "daily:results",
  telemetryQueue: "telemetry:queue",
  experiments: "experiments",
  /** ランキングへの参加記録(docs/08 §3)。サーバのデータを消すべきかの判断に使う。 */
  leaderboard: "leaderboard",
  /** レベルの進捗(docs/09 §3)。 */
  levels: "levels",
  /** 途中のレベルのゲーム。 */
  gameLevel: "game:level",
} as const;

export type StorageKey = (typeof KEYS)[keyof typeof KEYS];

interface Backend {
  readonly kind: "local" | "memory";
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
  keys(): string[];
}

function memoryBackend(): Backend {
  const map = new Map<string, string>();
  return {
    kind: "memory",
    get: (k) => map.get(k) ?? null,
    set: (k, v) => void map.set(k, v),
    remove: (k) => void map.delete(k),
    keys: () => [...map.keys()],
  };
}

function localBackend(): Backend | null {
  try {
    const probe = `${PREFIX}__probe`;
    localStorage.setItem(probe, "1");
    localStorage.removeItem(probe);
  } catch {
    return null;
  }
  return {
    kind: "local",
    get: (k) => {
      try {
        return localStorage.getItem(k);
      } catch {
        return null;
      }
    },
    set: (k, v) => localStorage.setItem(k, v),
    remove: (k) => {
      try {
        localStorage.removeItem(k);
      } catch {
        /* 読み書きできないなら諦める */
      }
    },
    keys: () => {
      const out: string[] = [];
      try {
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k !== null) out.push(k);
        }
      } catch {
        /* 諦める */
      }
      return out;
    },
  };
}

let backend: Backend | null = null;

function be(): Backend {
  backend ??= localBackend() ?? memoryBackend();
  return backend;
}

/** テスト用: バックエンドを作り直す。 */
export function resetBackend(next?: Backend): void {
  backend = next ?? null;
}

/** 実際に永続化されているか(About 画面などで使わない。テスト用)。 */
export function storageKind(): "local" | "memory" {
  return be().kind;
}

function fullKey(key: StorageKey): string {
  return PREFIX + key;
}

/**
 * 値を読み、`migrate` と `validate` を通す。失敗したらそのキーを消して `null`。
 */
export function readKey<T>(key: StorageKey, validate: (data: unknown) => T | null): T | null {
  const raw = be().get(fullKey(key));
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    remove(key);
    return null;
  }
  const migrated = migrate(parsed);
  if (migrated === null) {
    remove(key);
    return null;
  }
  const value = validate(migrated);
  if (value === null) {
    remove(key);
    return null;
  }
  return value;
}

/** 値を書く。容量超過なら telemetry キューを捨てて 1 回だけ再試行し、それでも駄目なら黙って諦める。 */
export function writeKey(key: StorageKey, data: unknown): void {
  const payload = JSON.stringify(envelope(data));
  try {
    be().set(fullKey(key), payload);
    return;
  } catch {
    /* 容量超過の可能性 */
  }
  try {
    be().remove(fullKey(KEYS.telemetryQueue));
    be().set(fullKey(key), payload);
  } catch {
    /* 黙って続行(docs/01 §13) */
  }
}

export function remove(key: StorageKey): void {
  be().remove(fullKey(key));
}

/** `hamaru:v1:` で始まるキーを全て消す(設定「データを削除」)。 */
export function clearAll(): void {
  for (const k of be().keys()) {
    if (k.startsWith(PREFIX)) be().remove(k);
  }
}

/* ------------------------------------------------------------------ */
/* 型付きレコード(docs/01 §10 の表)                                    */
/* ------------------------------------------------------------------ */

export type LangSetting = "auto" | "ja" | "en";
export type ThemeSetting = "auto" | "light" | "dark";
export type MotionSetting = "system" | "always";

export interface Settings {
  lang: LangSetting;
  theme: ThemeSetting;
  haptics: boolean;
  motion: MotionSetting;
  previewClears: boolean;
  /** ランキングに参加する(デイリーの公式記録を送る)。docs/08 §3。 */
  leaderboard: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  lang: "auto",
  theme: "auto",
  haptics: true,
  motion: "system",
  previewClears: true,
  leaderboard: true,
};

export interface Stats {
  gamesPlayed: number;
  bestScore: number;
  totalLines: number;
  totalScore: number;
  longestStreak: number;
  dailyStreak: number;
  lastDailyDate: string | null;
}

export const DEFAULT_STATS: Stats = {
  gamesPlayed: 0,
  bestScore: 0,
  totalLines: 0,
  totalScore: 0,
  longestStreak: 0,
  dailyStreak: 0,
  lastDailyDate: null,
};

export interface InstallRecord {
  id: string;
  createdAt: number;
  firstVersion: string;
}

export interface DailyResult {
  score: number;
  lines: number;
  isFirst: boolean;
}

export type DailyResults = Record<string, DailyResult>;

/** 保持する日数(docs/01 §10「直近 60 日分」)。 */
export const DAILY_RESULTS_KEEP = 60;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function pickEnum<T extends string>(v: unknown, allowed: readonly T[], fallback: T): T {
  return typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
}

function pickBool(v: unknown, fallback: boolean): boolean {
  return typeof v === "boolean" ? v : fallback;
}

function pickNumber(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : fallback;
}

/** 設定。欠けたフィールドは既定値で埋める(壊れていても全体は捨てない)。 */
export function loadSettings(): Settings {
  const v = readKey<Settings>(KEYS.settings, (data) => {
    if (!isRecord(data)) return null;
    return {
      lang: pickEnum(data["lang"], ["auto", "ja", "en"] as const, DEFAULT_SETTINGS.lang),
      theme: pickEnum(data["theme"], ["auto", "light", "dark"] as const, DEFAULT_SETTINGS.theme),
      haptics: pickBool(data["haptics"], DEFAULT_SETTINGS.haptics),
      motion: pickEnum(data["motion"], ["system", "always"] as const, DEFAULT_SETTINGS.motion),
      previewClears: pickBool(data["previewClears"], DEFAULT_SETTINGS.previewClears),
      leaderboard: pickBool(data["leaderboard"], DEFAULT_SETTINGS.leaderboard),
    };
  });
  return v ?? { ...DEFAULT_SETTINGS };
}

export function saveSettings(s: Settings): void {
  writeKey(KEYS.settings, s);
}

export function loadStats(): Stats {
  const v = readKey<Stats>(KEYS.stats, (data) => {
    if (!isRecord(data)) return null;
    const last = data["lastDailyDate"];
    return {
      gamesPlayed: pickNumber(data["gamesPlayed"], 0),
      bestScore: pickNumber(data["bestScore"], 0),
      totalLines: pickNumber(data["totalLines"], 0),
      totalScore: pickNumber(data["totalScore"], 0),
      longestStreak: pickNumber(data["longestStreak"], 0),
      dailyStreak: pickNumber(data["dailyStreak"], 0),
      lastDailyDate: typeof last === "string" ? last : null,
    };
  });
  return v ?? { ...DEFAULT_STATS };
}

export function saveStats(s: Stats): void {
  writeKey(KEYS.stats, s);
}

/** インストール記録。無ければ作る。UUID の生成は呼び出し側から渡す(テスト容易性)。 */
export function loadInstall(makeId: () => string, now: number, version: string): InstallRecord {
  const v = readKey<InstallRecord>(KEYS.install, (data) => {
    if (!isRecord(data)) return null;
    const id = data["id"];
    if (typeof id !== "string" || id.length === 0) return null;
    return {
      id,
      createdAt: pickNumber(data["createdAt"], now),
      firstVersion: typeof data["firstVersion"] === "string" ? data["firstVersion"] : version,
    };
  });
  if (v !== null) return v;
  const created: InstallRecord = { id: makeId(), createdAt: now, firstVersion: version };
  writeKey(KEYS.install, created);
  return created;
}

export function loadDailyResults(): DailyResults {
  const v = readKey<DailyResults>(KEYS.dailyResults, (data) => {
    if (!isRecord(data)) return null;
    const out: DailyResults = {};
    for (const [date, value] of Object.entries(data)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !isRecord(value)) continue;
      out[date] = {
        score: pickNumber(value["score"], 0),
        lines: pickNumber(value["lines"], 0),
        isFirst: pickBool(value["isFirst"], false),
      };
    }
    return out;
  });
  return v ?? {};
}

/** 1 日分の結果を記録し、古い日付を捨てる。 */
export function saveDailyResult(date: string, result: DailyResult): DailyResults {
  const all = loadDailyResults();
  all[date] = result;
  const dates = Object.keys(all).sort();
  const drop = dates.slice(0, Math.max(0, dates.length - DAILY_RESULTS_KEEP));
  for (const d of drop) delete all[d];
  writeKey(KEYS.dailyResults, all);
  return all;
}

/** 実験割り当てのキャッシュ(docs/02 §4.3)。 */
export function loadExperimentCache(): Record<string, string> {
  const v = readKey<Record<string, string>>(KEYS.experiments, (data) => {
    if (!isRecord(data)) return null;
    const out: Record<string, string> = {};
    for (const [k, val] of Object.entries(data)) {
      if (typeof val === "string") out[k] = val;
    }
    return out;
  });
  return v ?? {};
}

export function saveExperimentCache(cache: Record<string, string>): void {
  writeKey(KEYS.experiments, cache);
}

/* ------------------------------------------------------------------ */
/* 途中のゲーム                                                         */
/* ------------------------------------------------------------------ */

export interface SavedGame {
  /** `serialize(state)` の文字列。 */
  state: string;
  /** デイリーのみ: 開始時の UTC 日付。 */
  date?: string;
  /** 練習プレイか。 */
  isPractice?: boolean;
  /** 集計済みのアクティブ時間(ms)。 */
  activeMs?: number;
  /** デイリーのみ: 置いた手の列 [トレイ, x, y](ランキングの送信用。docs/08 §2)。 */
  moves?: Array<[number, number, number]>;
}

function pickMoves(v: unknown): Array<[number, number, number]> | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: Array<[number, number, number]> = [];
  for (const m of v) {
    if (!Array.isArray(m) || m.length !== 3 || !m.every((n) => Number.isInteger(n) && n >= 0)) {
      return undefined;
    }
    out.push([m[0] as number, m[1] as number, m[2] as number]);
  }
  return out;
}

export function loadSavedGame(
  key: typeof KEYS.gameEndless | typeof KEYS.gameDaily | typeof KEYS.gameLevel,
): SavedGame | null {
  return readKey<SavedGame>(key, (data) => {
    if (!isRecord(data)) return null;
    const state = data["state"];
    if (typeof state !== "string") return null;
    const date = data["date"];
    return {
      state,
      date: typeof date === "string" ? date : undefined,
      isPractice: pickBool(data["isPractice"], false),
      activeMs: pickNumber(data["activeMs"], 0),
      moves: pickMoves(data["moves"]),
    };
  });
}

/** ランキングへの参加記録。 */
export interface LeaderboardRecord {
  /** 一度でもサーバに記録した(「データを削除」でサーバ側も消す)。 */
  participated: boolean;
}

export function loadLeaderboardRecord(): LeaderboardRecord {
  const v = readKey<LeaderboardRecord>(KEYS.leaderboard, (data) =>
    isRecord(data) ? { participated: pickBool(data["participated"], false) } : null,
  );
  return v ?? { participated: false };
}

export function saveLeaderboardRecord(r: LeaderboardRecord): void {
  writeKey(KEYS.leaderboard, r);
}

export function saveSavedGame(
  key: typeof KEYS.gameEndless | typeof KEYS.gameDaily | typeof KEYS.gameLevel,
  value: SavedGame,
): void {
  writeKey(key, value);
}

/* ------------------------------------------------------------------ */
/* レベルの進捗(docs/09 §3)                                           */
/* ------------------------------------------------------------------ */

export interface LevelResult {
  stars: 1 | 2 | 3;
  score: number;
}

/** レベル番号 → 最高の星と得点(クリアしたレベルだけ)。 */
export type LevelProgress = Record<number, LevelResult>;

export function loadLevelProgress(): LevelProgress {
  const v = readKey<LevelProgress>(KEYS.levels, (data) => {
    if (!isRecord(data) || !isRecord(data["progress"])) return null;
    const out: LevelProgress = {};
    for (const [k, r] of Object.entries(data["progress"])) {
      const n = Number(k);
      if (!Number.isInteger(n) || n < 1 || !isRecord(r)) continue;
      const stars = r["stars"];
      if (stars !== 1 && stars !== 2 && stars !== 3) continue;
      out[n] = { stars, score: pickNumber(r["score"], 0) };
    }
    return out;
  });
  return v ?? {};
}

/** クリアを記録する。星と得点はそれぞれ最高を残す。 */
export function saveLevelResult(no: number, result: LevelResult): LevelProgress {
  const progress = loadLevelProgress();
  const prev = progress[no];
  progress[no] = {
    stars: Math.max(prev?.stars ?? 0, result.stars) as 1 | 2 | 3,
    score: Math.max(prev?.score ?? 0, result.score),
  };
  writeKey(KEYS.levels, { progress });
  return progress;
}

/** 遊べる最大のレベル(クリアした最大 + 1)。 */
export function unlockedLevel(progress: LevelProgress): number {
  let n = 1;
  while (progress[n] !== undefined) n++;
  return n;
}

export function totalStars(progress: LevelProgress): number {
  return Object.values(progress).reduce((s, r) => s + r.stars, 0);
}
