/**
 * 保存層(docs/06 §2「マイグレーション(v0→v1 のダミー)、壊れたキーだけ初期化、
 * メモリフォールバック」)。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { migrate, envelope, SCHEMA_VERSION } from "../../src/storage/migrate";
import {
  clearAll,
  DAILY_RESULTS_KEEP,
  DEFAULT_SETTINGS,
  KEYS,
  loadDailyResults,
  loadInstall,
  loadSettings,
  loadStats,
  PREFIX,
  readKey,
  resetBackend,
  saveDailyResult,
  saveSettings,
  saveStats,
  storageKind,
  writeKey,
} from "../../src/storage/local";

class FakeStorage {
  map = new Map<string, string>();
  /** 0 より大きいと、保存総量がこの値を超える書き込みで例外を投げる。 */
  quota = 0;

  get length(): number {
    return this.map.size;
  }
  key(i: number): string | null {
    return [...this.map.keys()][i] ?? null;
  }
  getItem(k: string): string | null {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    if (this.quota > 0) {
      let total = v.length;
      for (const [key, value] of this.map) if (key !== k) total += value.length;
      if (total > this.quota) throw new Error("QuotaExceededError");
    }
    this.map.set(k, v);
  }
  removeItem(k: string): void {
    this.map.delete(k);
  }
}

const g = globalThis as { localStorage?: unknown };

function useLocalStorage(): FakeStorage {
  const fake = new FakeStorage();
  g.localStorage = fake;
  resetBackend();
  return fake;
}

function useNoStorage(): void {
  Object.defineProperty(g, "localStorage", {
    configurable: true,
    get() {
      throw new Error("SecurityError: localStorage は使えません");
    },
  });
  resetBackend();
}

afterEach(() => {
  delete g.localStorage;
  resetBackend();
});

describe("migrate", () => {
  it("現行バージョンの封筒からは data を返す", () => {
    expect(migrate({ schemaVersion: SCHEMA_VERSION, data: { a: 1 } })).toEqual({ a: 1 });
  });

  it("v0(封筒なし)は値そのものとして持ち上げる", () => {
    expect(migrate({ bestScore: 42 })).toEqual({ bestScore: 42 });
  });

  it("未来のバージョンは読めないので null", () => {
    expect(migrate({ schemaVersion: SCHEMA_VERSION + 1, data: {} })).toBeNull();
  });

  it("オブジェクト以外は null", () => {
    expect(migrate("x")).toBeNull();
    expect(migrate(null)).toBeNull();
    expect(migrate([1, 2])).toBeNull();
  });

  it("envelope は schemaVersion を付ける", () => {
    expect(envelope({ a: 1 })).toEqual({ schemaVersion: SCHEMA_VERSION, data: { a: 1 } });
  });
});

describe("バックエンド", () => {
  it("localStorage があれば使う", () => {
    const fake = useLocalStorage();
    expect(storageKind()).toBe("local");
    writeKey(KEYS.stats, { bestScore: 1 });
    expect(fake.map.has(`${PREFIX}stats`)).toBe(true);
  });

  it("localStorage が使えなければメモリで動く(保存内容は読める)", () => {
    useNoStorage();
    expect(storageKind()).toBe("memory");
    saveStats({ ...loadStats(), bestScore: 99 });
    expect(loadStats().bestScore).toBe(99);
  });
});

describe("壊れたデータ", () => {
  it("壊れた JSON はそのキーだけ初期化し、他のキーは残る", () => {
    const fake = useLocalStorage();
    saveStats({ ...loadStats(), bestScore: 1234 });
    fake.map.set(`${PREFIX}settings`, "{not json");

    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
    expect(fake.map.has(`${PREFIX}settings`)).toBe(false);
    expect(loadStats().bestScore).toBe(1234);
  });

  it("型が違うフィールドは既定値で埋める", () => {
    const fake = useLocalStorage();
    fake.map.set(
      `${PREFIX}settings`,
      JSON.stringify({ schemaVersion: 1, data: { lang: "fr", haptics: "yes" } }),
    );
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it("v0 形式の統計を読める", () => {
    const fake = useLocalStorage();
    fake.map.set(`${PREFIX}stats`, JSON.stringify({ bestScore: 777, gamesPlayed: 3 }));
    const stats = loadStats();
    expect(stats.bestScore).toBe(777);
    expect(stats.gamesPlayed).toBe(3);
    expect(stats.dailyStreak).toBe(0);
  });

  it("検証に失敗したキーは消える", () => {
    const fake = useLocalStorage();
    fake.map.set(`${PREFIX}install`, JSON.stringify({ schemaVersion: 1, data: { id: 42 } }));
    expect(readKey(KEYS.install, () => null)).toBeNull();
    expect(fake.map.has(`${PREFIX}install`)).toBe(false);
  });
});

describe("容量超過", () => {
  it("telemetry:queue を捨ててから再試行する(docs/01 §13)", () => {
    const fake = useLocalStorage();
    writeKey(KEYS.telemetryQueue, { events: "x".repeat(400) });
    fake.quota = 300;
    writeKey(KEYS.stats, { bestScore: 5 });
    expect(fake.map.has(`${PREFIX}telemetry:queue`)).toBe(false);
    expect(fake.map.has(`${PREFIX}stats`)).toBe(true);
  });

  it("再試行しても入らなければ黙って続行する", () => {
    const fake = useLocalStorage();
    fake.quota = 1;
    expect(() => writeKey(KEYS.stats, { bestScore: 5 })).not.toThrow();
    expect(fake.map.has(`${PREFIX}stats`)).toBe(false);
  });
});

describe("レコード", () => {
  beforeEach(() => {
    useLocalStorage();
  });

  it("install は無ければ作り、次回は同じ ID を返す", () => {
    let n = 0;
    const first = loadInstall(() => `id-${++n}`, 1000, "abc1234");
    const second = loadInstall(() => `id-${++n}`, 2000, "zzz9999");
    expect(second).toEqual(first);
    expect(first.id).toBe("id-1");
    expect(first.createdAt).toBe(1000);
  });

  it("設定は往復する", () => {
    saveSettings({ ...DEFAULT_SETTINGS, theme: "light", haptics: false });
    expect(loadSettings().theme).toBe("light");
    expect(loadSettings().haptics).toBe(false);
  });

  it("デイリー結果は 60 日分だけ残す", () => {
    for (let i = 0; i < DAILY_RESULTS_KEEP + 5; i++) {
      const date = new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10);
      saveDailyResult(date, { score: i, lines: i });
    }
    const all = loadDailyResults();
    expect(Object.keys(all)).toHaveLength(DAILY_RESULTS_KEEP);
    expect(all["2026-01-01"]).toBeUndefined();
    const last = new Date(Date.UTC(2026, 0, 1 + DAILY_RESULTS_KEEP + 4)).toISOString().slice(0, 10);
    expect(all[last]?.score).toBe(DAILY_RESULTS_KEEP + 4);
  });

  it("同じ日に何度遊んでもベストだけ残り、回数が増える(docs/08 §1)", () => {
    saveDailyResult("2026-10-05", { score: 251, lines: 3 });
    expect(loadDailyResults()["2026-10-05"]).toEqual({ score: 251, lines: 3, attempts: 1 });

    // 低い得点ではベストも消去数も変わらない
    saveDailyResult("2026-10-05", { score: 100, lines: 1 });
    expect(loadDailyResults()["2026-10-05"]).toEqual({ score: 251, lines: 3, attempts: 2 });

    // 更新したらベストと消去数が入れ替わる
    saveDailyResult("2026-10-05", { score: 1224, lines: 9 });
    expect(loadDailyResults()["2026-10-05"]).toEqual({ score: 1224, lines: 9, attempts: 3 });

    // 別の日は独立
    saveDailyResult("2026-10-06", { score: 10, lines: 0 });
    expect(loadDailyResults()["2026-10-06"]?.attempts).toBe(1);
  });

  it("古い保存(attempts なし)は 1 回として読む", () => {
    writeKey(KEYS.dailyResults, { "2026-10-07": { score: 500, lines: 2, isFirst: true } });
    expect(loadDailyResults()["2026-10-07"]).toEqual({ score: 500, lines: 2, attempts: 1 });
  });

  it("不正な日付キーは読み飛ばす", () => {
    saveDailyResult("2026-10-01", { score: 1, lines: 1 });
    writeKey(KEYS.dailyResults, {
      "not-a-date": { score: 1 },
      "2026-10-02": { score: 2, lines: 0 },
    });
    const all = loadDailyResults();
    expect(all["not-a-date"]).toBeUndefined();
    expect(all["2026-10-02"]?.score).toBe(2);
  });

  it("clearAll は hamaru: 接頭辞のキーだけ消す", () => {
    const fake = useLocalStorage();
    fake.map.set("other-app", "keep");
    saveStats({ ...loadStats(), bestScore: 10 });
    clearAll();
    expect(fake.map.get("other-app")).toBe("keep");
    expect(loadStats().bestScore).toBe(0);
  });
});
