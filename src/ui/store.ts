/**
 * 小さな observable ストア(docs/02 §5)と、アプリ全体で共有する状態。
 *
 * 実装ノート: docs/02 §2 のツリーに「アプリ文脈(install / config / 実験割り当て)」を
 * 置く先が無いため、購読対象と一緒にここへ置いた(新しいファイルを増やさない)。
 */
import type { ResolvedConfig } from "../core/types";
import type { Lang } from "../i18n";
import type { Settings, Stats } from "../storage/local";

export interface Store<T> {
  get(): T;
  set(value: T): void;
  update(fn: (value: T) => T): void;
  subscribe(fn: (value: T) => void): () => void;
}

export function createStore<T>(initial: T): Store<T> {
  let value = initial;
  const subscribers = new Set<(v: T) => void>();
  return {
    get: () => value,
    set(next) {
      if (Object.is(next, value)) return;
      value = next;
      for (const fn of [...subscribers]) fn(value);
    },
    update(fn) {
      this.set(fn(value));
    },
    subscribe(fn) {
      subscribers.add(fn);
      return () => void subscribers.delete(fn);
    },
  };
}

/** 起動時に 1 度だけ決まる文脈。 */
export interface AppContext {
  installId: string;
  version: string;
  /** エンドレス用に解決済みの config。デイリーは開始時に解決し直す。 */
  config: ResolvedConfig;
  exp: string;
  variant: string;
}

export const settingsStore = createStore<Settings>({
  lang: "auto",
  theme: "auto",
  haptics: true,
  motion: "system",
  previewClears: true,
  music: false,
  leaderboard: true,
});

export const statsStore = createStore<Stats>({
  gamesPlayed: 0,
  bestScore: 0,
  totalLines: 0,
  totalScore: 0,
  longestStreak: 0,
  dailyStreak: 0,
  lastDailyDate: null,
});

export const langStore = createStore<Lang>("ja");

let context: AppContext | null = null;

export function setContext(ctx: AppContext): void {
  context = ctx;
}

export function getContext(): AppContext {
  if (context === null) throw new Error("AppContext が未初期化です");
  return context;
}
