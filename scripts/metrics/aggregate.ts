/**
 * 行データ → `kaizen/metrics/<date>.json`(docs/04 §5 の指標 ID、§7 の形)。
 *
 * すべて純粋関数。SQL を投げる部分(runner.ts)と分けてあり、固定の行データで単体テストする。
 * AE のサンプリングに備え、件数はすべて `_sample_interval`(= w)で重み付けする。
 * サンプリングの単位は index1 = installId なので、install 単位の分析は壊れない(docs/04 §4)。
 */
import { BUCKET, num, str, type Row } from "./sql";

export const MS_PER_DAY = 86_400_000;

/* ------------------------------------------------------------------ */
/* 行の型                                                               */
/* ------------------------------------------------------------------ */

export interface SessionRow {
  install: string;
  session: string;
  /** その日 00:00 UTC の epoch ms。 */
  dayMs: number;
  platform: string;
  lang: string;
  exp: string;
  variant: string;
  w: number;
  starts: number;
  games: number;
  abandons: number;
  gameMs: number;
  errors: number;
  dailyStarts: number;
  dailyResults: number;
  shares: number;
}

export interface HistRow {
  dayMs: number;
  platform: string;
  lang: string;
  exp: string;
  variant: string;
  bucket: number;
  n: number;
}

export interface VitalRow {
  dayMs: number;
  platform: string;
  lang: string;
  name: string;
  bucket: number;
  n: number;
}

export interface ErrorRow {
  stackHash: string;
  message: string;
  firstVersion: string;
  n: number;
  nRecent: number;
}

export interface RawData {
  sessions: SessionRow[];
  /** install → 初回 session_start の epoch ms(期間内に初回だった install だけ)。 */
  firstSeen: Map<string, number>;
  durations: HistRow[];
  scores: HistRow[];
  vitals: VitalRow[];
  errors: ErrorRow[];
  version: string;
}

/* ------------------------------------------------------------------ */
/* SQL 応答の行 → 型付きの行                                            */
/* ------------------------------------------------------------------ */

export function toSessionRow(r: Row): SessionRow {
  return {
    install: str(r["install"]),
    session: str(r["session"]),
    dayMs: num(r["day"]) * 1000,
    platform: str(r["platform"]),
    lang: str(r["lang"]),
    exp: str(r["exp"]),
    variant: str(r["variant"]),
    w: Math.max(1, num(r["w"])),
    starts: num(r["starts"]),
    games: num(r["games"]),
    abandons: num(r["abandons"]),
    gameMs: num(r["game_ms"]),
    errors: num(r["errors"]),
    dailyStarts: num(r["daily_starts"]),
    dailyResults: num(r["daily_results"]),
    shares: num(r["shares"]),
  };
}

export function toHistRow(r: Row): HistRow {
  return {
    dayMs: num(r["day"]) * 1000,
    platform: str(r["platform"]),
    lang: str(r["lang"]),
    exp: str(r["exp"]),
    variant: str(r["variant"]),
    bucket: num(r["bucket"]),
    n: num(r["n"]),
  };
}

export function toVitalRow(r: Row): VitalRow {
  return {
    dayMs: num(r["day"]) * 1000,
    platform: str(r["platform"]),
    lang: str(r["lang"]),
    name: str(r["name"]),
    bucket: num(r["bucket"]),
    n: num(r["n"]),
  };
}

export function toErrorRow(r: Row): ErrorRow {
  return {
    stackHash: str(r["stack_hash"]),
    message: str(r["message"]).slice(0, 200),
    firstVersion: str(r["first_version"]),
    n: num(r["n"]),
    nRecent: num(r["n_recent"]),
  };
}

/* ------------------------------------------------------------------ */
/* セッション行を (install, session) で束ねる                            */
/* ------------------------------------------------------------------ */

const sessionKey = (r: { install: string; session: string }): string => `${r.install}|${r.session}`;

/**
 * 日付・platform・lang・実験で GROUP BY した行を 1 セッション 1 行にまとめる。
 * 日付は最初の日、platform / lang は最初の日の値、実験は空でない値を優先する。
 */
export function mergeSessions(rows: readonly SessionRow[]): SessionRow[] {
  const sorted = [...rows].sort((a, b) => a.dayMs - b.dayMs);
  const map = new Map<string, SessionRow>();
  for (const r of sorted) {
    const key = sessionKey(r);
    const cur = map.get(key);
    if (cur === undefined) {
      map.set(key, { ...r });
      continue;
    }
    cur.w = Math.max(cur.w, r.w);
    cur.starts += r.starts;
    cur.games += r.games;
    cur.abandons += r.abandons;
    cur.gameMs += r.gameMs;
    cur.errors += r.errors;
    cur.dailyStarts += r.dailyStarts;
    cur.dailyResults += r.dailyResults;
    cur.shares += r.shares;
    if (cur.exp === "" && r.exp !== "") {
      cur.exp = r.exp;
      cur.variant = r.variant;
    }
  }
  return [...map.values()];
}

/* ------------------------------------------------------------------ */
/* 分位                                                                 */
/* ------------------------------------------------------------------ */

/**
 * 重み付きヒストグラムの分位。各ビンは中央値(`(bucket + 0.5) * size`)で代表させる。
 * 総重みが 0 なら null。精度はビン幅の半分(docs/04 §10 N-4)。
 */
export function histQuantile(
  entries: ReadonlyArray<{ bucket: number; n: number }>,
  size: number,
  q: number,
): number | null {
  const merged = new Map<number, number>();
  for (const e of entries) {
    if (e.n <= 0) continue;
    merged.set(e.bucket, (merged.get(e.bucket) ?? 0) + e.n);
  }
  const bins = [...merged.entries()].sort((a, b) => a[0] - b[0]);
  const total = bins.reduce((s, [, n]) => s + n, 0);
  if (total <= 0) return null;
  const target = q * total;
  let cum = 0;
  for (const [bucket, n] of bins) {
    cum += n;
    if (cum >= target) return (bucket + 0.5) * size;
  }
  const last = bins[bins.length - 1];
  return last === undefined ? null : (last[0] + 0.5) * size;
}

/** 値の配列の重み付き分位(下側)。空なら null。 */
export function weightedQuantile(
  values: ReadonlyArray<{ value: number; w: number }>,
  q: number,
): number | null {
  const sorted = values.filter((v) => v.w > 0).sort((a, b) => a.value - b.value);
  const total = sorted.reduce((s, v) => s + v.w, 0);
  if (total <= 0) return null;
  const target = q * total;
  let cum = 0;
  for (const v of sorted) {
    cum += v.w;
    if (cum >= target) return v.value;
  }
  return sorted[sorted.length - 1]?.value ?? null;
}

/* ------------------------------------------------------------------ */
/* 指標                                                                 */
/* ------------------------------------------------------------------ */

export interface Window {
  fromMs: number;
  toMs: number;
}

export interface Slice {
  platform?: string;
  lang?: string;
  exp?: string;
  variant?: string;
}

/** docs/04 §5 の指標 ID をキーに持つ。分母が 0 の比は null。 */
export interface Metrics {
  sessions: number;
  installs_active: number;
  installs_new: number;
  games: number;
  games_per_session: number | null;
  median_game_seconds: number | null;
  median_score: number | null;
  p90_score: number | null;
  abandon_rate: number | null;
  session_minutes_median: number | null;
  d1_return: number | null;
  daily_start_rate: number | null;
  daily_completion: number | null;
  share_rate: number | null;
  crash_free: number | null;
  lcp_p75: number | null;
  inp_p75: number | null;
  cls_p75: number | null;
}

const inWindow = (dayMs: number, w: Window): boolean => dayMs >= w.fromMs && dayMs < w.toMs;

function matches(row: Partial<Record<keyof Slice, string>>, s: Slice): boolean {
  return (
    (s.platform === undefined || row.platform === s.platform) &&
    (s.lang === undefined || row.lang === s.lang) &&
    (s.exp === undefined || row.exp === s.exp) &&
    (s.variant === undefined || row.variant === s.variant)
  );
}

export function round(v: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}

const ratio = (a: number, b: number): number | null => (b > 0 ? round(a / b, 4) : null);

const roundOrNull = (v: number | null, digits: number): number | null =>
  v === null ? null : round(v, digits);

/**
 * 1 つの窓・切り口の指標をすべて計算する。
 * `sessions` は mergeSessions 済みの行を渡すこと。
 */
export function computeMetrics(
  data: RawData,
  sessions: readonly SessionRow[],
  window: Window,
  slice: Slice = {},
): Metrics {
  const rows = sessions.filter((r) => inWindow(r.dayMs, window) && matches(r, slice));

  let sessionW = 0;
  let gamesW = 0;
  let abandonsW = 0;
  let errorFreeW = 0;
  let sessionCountW = 0;
  let sharesW = 0;
  let dailyResultsW = 0;
  const minutes: Array<{ value: number; w: number }> = [];
  const installs = new Map<string, { w: number; daily: boolean; dailyDone: boolean }>();

  for (const r of rows) {
    sessionW += r.w * r.starts;
    gamesW += r.w * r.games;
    abandonsW += r.w * r.abandons;
    sessionCountW += r.w;
    if (r.errors === 0) errorFreeW += r.w;
    sharesW += r.w * r.shares;
    dailyResultsW += r.w * r.dailyResults;
    minutes.push({ value: r.gameMs / 60_000, w: r.w });
    const cur = installs.get(r.install) ?? { w: 0, daily: false, dailyDone: false };
    cur.w = Math.max(cur.w, r.w);
    cur.daily ||= r.dailyStarts > 0;
    cur.dailyDone ||= r.dailyResults > 0;
    installs.set(r.install, cur);
  }

  let activeW = 0;
  let newW = 0;
  let dailyInstallsW = 0;
  let dailyDoneW = 0;
  for (const [install, v] of installs) {
    activeW += v.w;
    const first = data.firstSeen.get(install);
    if (first !== undefined && first >= window.fromMs && first < window.toMs) newW += v.w;
    if (v.daily) dailyInstallsW += v.w;
    if (v.daily && v.dailyDone) dailyDoneW += v.w;
  }

  const hist = (list: readonly HistRow[]) =>
    list.filter((h) => inWindow(h.dayMs, window) && matches(h, slice));
  const durations = hist(data.durations);
  const scores = hist(data.scores);

  const vitals = data.vitals.filter(
    (v) => inWindow(v.dayMs, window) && matches({ platform: v.platform, lang: v.lang }, slice),
  );
  const vital = (name: string, size: number, digits: number): number | null =>
    roundOrNull(
      histQuantile(
        vitals.filter((v) => v.name === name),
        size,
        0.75,
      ),
      digits,
    );

  const medianMs = histQuantile(durations, BUCKET.durationMs, 0.5);

  return {
    sessions: round(sessionW, 2),
    installs_active: round(activeW, 2),
    installs_new: round(newW, 2),
    games: round(gamesW, 2),
    games_per_session: ratio(gamesW, sessionW),
    median_game_seconds: medianMs === null ? null : round(medianMs / 1000, 1),
    median_score: roundOrNull(histQuantile(scores, BUCKET.score, 0.5), 0),
    p90_score: roundOrNull(histQuantile(scores, BUCKET.score, 0.9), 0),
    abandon_rate: ratio(abandonsW, gamesW),
    session_minutes_median: roundOrNull(weightedQuantile(minutes, 0.5), 2),
    d1_return: d1Return(data, sessions, window, slice),
    daily_start_rate: ratio(dailyInstallsW, activeW),
    daily_completion: ratio(dailyDoneW, dailyInstallsW),
    share_rate: ratio(sharesW, dailyResultsW),
    crash_free: ratio(errorFreeW, sessionCountW),
    lcp_p75: vital("LCP", BUCKET.lcpMs, 0),
    inp_p75: vital("INP", BUCKET.inpMs, 0),
    cls_p75: vital("CLS", BUCKET.cls, 4),
  };
}

/**
 * D1 リターン(docs/04 §5)。窓内の各日 D に初回だった install のうち、D+1 に session がある割合。
 * D+1 が窓の終わり(= 集計日の 00:00 UTC)までに**丸 1 日終わっている** D だけを数える。
 * AE は JOIN できないので、初回日(firstSeen)とセッション行をここで突き合わせる。
 */
export function d1Return(
  data: RawData,
  sessions: readonly SessionRow[],
  window: Window,
  slice: Slice = {},
): number | null {
  const activeDays = new Map<string, Set<number>>();
  const inSlice = new Map<string, number>();
  for (const r of sessions) {
    if (r.starts <= 0) continue;
    let days = activeDays.get(r.install);
    if (days === undefined) {
      days = new Set();
      activeDays.set(r.install, days);
    }
    days.add(r.dayMs);
    if (inWindow(r.dayMs, window) && matches(r, slice)) {
      inSlice.set(r.install, Math.max(inSlice.get(r.install) ?? 1, r.w));
    }
  }

  let cohort = 0;
  let returned = 0;
  for (const [install, firstMs] of data.firstSeen) {
    const w = inSlice.get(install);
    if (w === undefined) continue;
    const d0 = Math.floor(firstMs / MS_PER_DAY) * MS_PER_DAY;
    if (d0 < window.fromMs || d0 + 2 * MS_PER_DAY > window.toMs) continue;
    cohort += w;
    if (activeDays.get(install)?.has(d0 + MS_PER_DAY) === true) returned += w;
  }
  return ratio(returned, cohort);
}

/* ------------------------------------------------------------------ */
/* 実験                                                                 */
/* ------------------------------------------------------------------ */

/** experiment-eval が読む install 単位の行(`<date>-installs.json`)。 */
export interface InstallRow {
  install: string;
  variant: string;
  w: number;
  sessions: number;
  games: number;
  abandons: number;
  gameMinutes: number;
  errorSessions: number;
  sessionRows: number;
  dailyStarts: number;
  dailyResults: number;
  shares: number;
}

export function installRows(
  sessions: readonly SessionRow[],
  expId: string,
  sinceMs: number,
): InstallRow[] {
  const map = new Map<string, InstallRow>();
  for (const r of sessions) {
    if (r.exp !== expId || r.dayMs < sinceMs) continue;
    const key = `${r.install}|${r.variant}`;
    const cur: InstallRow = map.get(key) ?? {
      install: r.install,
      variant: r.variant,
      w: 1,
      sessions: 0,
      games: 0,
      abandons: 0,
      gameMinutes: 0,
      errorSessions: 0,
      sessionRows: 0,
      dailyStarts: 0,
      dailyResults: 0,
      shares: 0,
    };
    cur.w = Math.max(cur.w, r.w);
    cur.sessions += r.starts;
    cur.games += r.games;
    cur.abandons += r.abandons;
    cur.gameMinutes = round(cur.gameMinutes + r.gameMs / 60_000, 3);
    cur.errorSessions += r.errors > 0 ? 1 : 0;
    cur.sessionRows += 1;
    cur.dailyStarts += r.dailyStarts;
    cur.dailyResults += r.dailyResults;
    cur.shares += r.shares;
    map.set(key, cur);
  }
  return [...map.values()].sort((a, b) =>
    a.variant === b.variant
      ? a.install.localeCompare(b.install)
      : a.variant.localeCompare(b.variant),
  );
}

export interface ArmSummary {
  installs: number;
  sessions: number;
  games: number;
  games_per_session: { mean: number | null; sd: number | null };
  crash_free: number | null;
  median_game_seconds: number | null;
  abandon_rate: number | null;
}

export function meanSd(values: readonly number[]): { mean: number | null; sd: number | null } {
  const n = values.length;
  if (n === 0) return { mean: null, sd: null };
  const mean = values.reduce((s, v) => s + v, 0) / n;
  if (n < 2) return { mean: round(mean, 4), sd: null };
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1);
  return { mean: round(mean, 4), sd: round(Math.sqrt(variance), 4) };
}

export function armSummary(
  data: RawData,
  sessions: readonly SessionRow[],
  rows: readonly InstallRow[],
  expId: string,
  variant: string,
  since: Window,
): ArmSummary {
  const mine = rows.filter((r) => r.variant === variant);
  const m = computeMetrics(data, sessions, since, { exp: expId, variant });
  return {
    installs: mine.length,
    sessions: mine.reduce((s, r) => s + r.sessions, 0),
    games: mine.reduce((s, r) => s + r.games, 0),
    games_per_session: meanSd(mine.filter((r) => r.sessions > 0).map((r) => r.games / r.sessions)),
    crash_free: m.crash_free,
    median_game_seconds: m.median_game_seconds,
    abandon_rate: m.abandon_rate,
  };
}
