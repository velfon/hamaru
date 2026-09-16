/**
 * RawData → `kaizen/metrics/<date>.json` と `<date>-installs.json`(docs/04 §7)。純粋関数。
 */
import type { Experiment } from "../../src/config/schema";
import { parseUtcDate, utcDateString } from "../../src/core/daily";
import {
  armSummary,
  computeMetrics,
  d1Return,
  installRows,
  mergeSessions,
  MS_PER_DAY,
  round,
  type ArmSummary,
  type InstallRow,
  type Metrics,
  type RawData,
  type SessionRow,
  type Window,
} from "./aggregate";

export const PLATFORMS = ["ios", "android", "desktop", "other"] as const;
export const LANGS = ["ja", "en"] as const;

/** 内訳(byPlatform / byLang / vitals)に使う窓。 */
export const BREAKDOWN_WINDOW = "d7";

export interface WindowJson {
  from: string;
  to: string;
}

export interface DayJson {
  date: string;
  sessions: number;
  games: number;
  installs_active: number;
  installs_new: number;
  games_per_session: number | null;
  crash_free: number | null;
  /** その日に初回だった install の翌日再訪率。翌日がまだ終わっていなければ null。 */
  d1_return: number | null;
}

export interface ExperimentJson {
  id: string;
  status: "running";
  startedAt: string;
  days: number;
  primaryMetric: string;
  guardrails: string[];
  minUsersPerArm: number;
  maxDays: number;
  arms: Record<string, ArmSummary>;
}

export interface TopErrorJson {
  stackHash: string;
  message: string;
  n: number;
  /** 直近 1 日(d1)の件数。 */
  nRecent: number;
  firstVersion: string;
  /** 初出が現在のバージョン。 */
  isNew: boolean;
  /** 直近 1 日が期間平均の 2 倍以上かつ 3 件以上。 */
  rising: boolean;
}

export interface MetricsReport {
  schemaVersion: 1;
  generatedAt: string;
  date: string;
  version: string;
  windows: Record<string, WindowJson>;
  overall: Record<string, Metrics>;
  byDay: DayJson[];
  byPlatform: Record<string, Metrics>;
  byLang: Record<string, Metrics>;
  experiment: ExperimentJson | null;
  topErrors: TopErrorJson[];
  vitals: Pick<Metrics, "lcp_p75" | "inp_p75" | "cls_p75">;
  sampling: { maxSampleInterval: number };
}

export interface InstallsFile {
  schemaVersion: 1;
  date: string;
  experiment: string;
  since: string;
  rows: InstallRow[];
}

export interface BuildOptions {
  /** 集計日(UTC)。窓の終わりはこの日の 00:00 UTC(当日分は含まない)。 */
  date: string;
  /** 最長の窓の日数(既定 14)。 */
  days: number;
  nowMs: number;
  experiment: Experiment | null;
}

const iso = (ms: number): string => new Date(ms).toISOString().replace(".000Z", "Z");

export function windowKeys(days: number): string[] {
  return [...new Set(["d1", "d7", `d${days}`])];
}

export function dayStartMs(date: string): number {
  const ms = parseUtcDate(date);
  if (ms === null) throw new Error(`日付が不正です: ${date}(YYYY-MM-DD)`);
  return ms;
}

/** 実験の集計開始日(startedAt の日の 00:00 UTC)。 */
export function experimentSinceMs(exp: Experiment): number {
  if (exp.startedAt === undefined) {
    throw new Error(`${exp.id} は running ですが startedAt がありません(experiments.json)`);
  }
  return Math.floor(Date.parse(exp.startedAt) / MS_PER_DAY) * MS_PER_DAY;
}

export function buildReport(
  data: RawData,
  opts: BuildOptions,
): { report: MetricsReport; installs: InstallsFile | null } {
  const toMs = dayStartMs(opts.date);
  const sessions = mergeSessions(data.sessions);

  const windows: Record<string, Window> = {};
  for (const key of windowKeys(opts.days)) {
    const n = Number(key.slice(1));
    windows[key] = { fromMs: toMs - n * MS_PER_DAY, toMs };
  }
  const longest = windows[`d${opts.days}`] as Window;
  const breakdown = windows[BREAKDOWN_WINDOW] as Window;

  const overall: Record<string, Metrics> = {};
  for (const [key, w] of Object.entries(windows)) overall[key] = computeMetrics(data, sessions, w);

  const byDay: DayJson[] = [];
  for (let d = longest.fromMs; d < toMs; d += MS_PER_DAY) {
    const day: Window = { fromMs: d, toMs: d + MS_PER_DAY };
    const m = computeMetrics(data, sessions, day);
    byDay.push({
      date: utcDateString(d),
      sessions: m.sessions,
      games: m.games,
      installs_active: m.installs_active,
      installs_new: m.installs_new,
      games_per_session: m.games_per_session,
      crash_free: m.crash_free,
      // コホート日 D だけで数え、D+1 が丸 1 日終わっているか(D + 2 日 <= 集計日)で判定する。
      d1_return: d + 2 * MS_PER_DAY <= toMs ? cohortReturn(data, sessions, d, toMs) : null,
    });
  }

  const byPlatform: Record<string, Metrics> = {};
  for (const p of PLATFORMS)
    byPlatform[p] = computeMetrics(data, sessions, breakdown, { platform: p });
  const byLang: Record<string, Metrics> = {};
  for (const l of LANGS) byLang[l] = computeMetrics(data, sessions, breakdown, { lang: l });

  let experiment: ExperimentJson | null = null;
  let installs: InstallsFile | null = null;
  const exp = opts.experiment;
  if (exp !== null) {
    const sinceMs = experimentSinceMs(exp);
    const rows = installRows(sessions, exp.id, sinceMs);
    const since: Window = { fromMs: sinceMs, toMs };
    const arms: Record<string, ArmSummary> = {};
    for (const variant of Object.keys(exp.allocation).sort()) {
      arms[variant] = armSummary(data, sessions, rows, exp.id, variant, since);
    }
    experiment = {
      id: exp.id,
      status: "running",
      startedAt: exp.startedAt as string,
      days: Math.max(
        0,
        Math.floor((opts.nowMs - Date.parse(exp.startedAt as string)) / MS_PER_DAY),
      ),
      primaryMetric: exp.primaryMetric,
      guardrails: [...exp.guardrails],
      minUsersPerArm: exp.minUsersPerArm,
      maxDays: exp.maxDays,
      arms,
    };
    installs = { schemaVersion: 1, date: opts.date, experiment: exp.id, since: iso(sinceMs), rows };
  }

  const d7 = overall[BREAKDOWN_WINDOW] as Metrics;
  const report: MetricsReport = {
    schemaVersion: 1,
    generatedAt: iso(opts.nowMs),
    date: opts.date,
    version: data.version,
    windows: Object.fromEntries(
      Object.entries(windows).map(([k, w]) => [k, { from: iso(w.fromMs), to: iso(w.toMs) }]),
    ),
    overall,
    byDay,
    byPlatform,
    byLang,
    experiment,
    topErrors: data.errors.map((e) => {
      const avg = e.n / opts.days;
      return {
        stackHash: e.stackHash,
        message: e.message,
        n: round(e.n, 2),
        nRecent: round(e.nRecent, 2),
        firstVersion: e.firstVersion,
        isNew: data.version !== "" && e.firstVersion === data.version,
        rising: e.nRecent >= 3 && e.nRecent >= 2 * avg,
      };
    }),
    vitals: { lcp_p75: d7.lcp_p75, inp_p75: d7.inp_p75, cls_p75: d7.cls_p75 },
    sampling: {
      maxSampleInterval: data.sessions.reduce((m, r) => Math.max(m, r.w), 1),
    },
  };
  return { report, installs };
}

/** コホート日 d0 に初回だった install の翌日再訪率。 */
function cohortReturn(
  data: RawData,
  sessions: readonly SessionRow[],
  d0: number,
  toMs: number,
): number | null {
  const onlyD0: RawData = {
    ...data,
    firstSeen: new Map(
      [...data.firstSeen].filter(([, first]) => first >= d0 && first < d0 + MS_PER_DAY),
    ),
  };
  return d1Return(onlyD0, sessions, { fromMs: d0, toMs });
}
