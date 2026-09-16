/**
 * 実験の判定(docs/05 §6.3)。**決定的**で、LLM は結果を読むだけ。
 *
 *   1. ガードレール: 両腕 100 install 以上で、treatment がいずれかを破っていれば rollback
 *   2. サンプル到達: 両腕 minUsersPerArm 以上 かつ 経過 3 日以上 → Welch の t 検定(install 単位)
 *        p < 0.05 かつ改善 → promote / p < 0.05 かつ悪化 → rollback / それ以外 → continue
 *   3. 期限: 経過 ≥ maxDays で未決 → inconclusive(control を維持)
 *
 * 「改善」の向きは指標ごとに決まる(abandon_rate は下がるのが改善。docs/05 §13 N-2)。
 */
import type { Experiment } from "../../src/config/schema";
import type { ArmSummary, InstallRow } from "../metrics/aggregate";
import { round } from "../metrics/aggregate";
import { welch, type WelchResult } from "./stats";

export const MS_PER_DAY = 86_400_000;
export const ALPHA = 0.05;
export const MIN_DAYS = 3;
export const GUARDRAIL_MIN_INSTALLS = 100;

export type DecisionKind = "promote" | "rollback" | "continue" | "inconclusive" | "none";

/* ------------------------------------------------------------------ */
/* 主要指標(install 単位の値)                                          */
/* ------------------------------------------------------------------ */

export interface PrimaryMetric {
  /** 大きいほど良い(up)/ 小さいほど良い(down)。 */
  direction: "up" | "down";
  /** install 1 件の値。分母が無い install は null(検定から外す)。 */
  value(row: InstallRow): number | null;
  description: string;
}

export const PRIMARY_METRICS: Record<string, PrimaryMetric> = {
  games_per_session: {
    direction: "up",
    value: (r) => (r.sessions > 0 ? r.games / r.sessions : null),
    description: "install ごとの games / sessions の平均",
  },
  games: {
    direction: "up",
    value: (r) => r.games,
    description: "install ごとのゲーム数の平均",
  },
  session_minutes_median: {
    direction: "up",
    value: (r) => (r.sessions > 0 ? r.gameMinutes / r.sessions : null),
    description: "install ごとの 1 セッションあたりプレイ分数の平均(中央値の install 単位近似)",
  },
  abandon_rate: {
    direction: "down",
    value: (r) => (r.games > 0 ? r.abandons / r.games : null),
    description: "install ごとの abandon / games の平均",
  },
  crash_free: {
    direction: "up",
    value: (r) => (r.sessionRows > 0 ? 1 - r.errorSessions / r.sessionRows : null),
    description: "install ごとのエラーなしセッション率の平均",
  },
  daily_start_rate: {
    direction: "up",
    value: (r) => (r.dailyStarts > 0 ? 1 : 0),
    description: "デイリーを始めた install の割合",
  },
  daily_completion: {
    direction: "up",
    value: (r) => (r.dailyStarts > 0 ? (r.dailyResults > 0 ? 1 : 0) : null),
    description: "デイリーを始めた install のうち公式記録を残した割合",
  },
  share_rate: {
    direction: "up",
    value: (r) => (r.dailyResults > 0 ? r.shares / r.dailyResults : null),
    description: "install ごとの share / daily_result の平均",
  },
};

/* ------------------------------------------------------------------ */
/* ガードレール                                                         */
/* ------------------------------------------------------------------ */

export interface GuardrailResult {
  id: string;
  ok: boolean;
  /** 値が無くて判定できなかった(ok 扱い)。 */
  skipped: boolean;
  detail: string;
}

type Check = (control: ArmSummary, treatment: ArmSummary) => GuardrailResult;

const fmt = (v: number | null): string => (v === null ? "null" : String(round(v, 4)));

function skipped(id: string, why: string): GuardrailResult {
  return { id, ok: true, skipped: true, detail: `判定不能(${why})` };
}

type ArmMetric = "crash_free" | "median_game_seconds" | "abandon_rate";

/**
 * ガードレール ID → 判定。docs/05 §6.1 のテンプレートの既定値:
 *   crash_free             treatment ≥ control − 0.5pt
 *   median_game_seconds    treatment が 120〜600 秒
 *   abandon_rate           treatment ≤ control + 3pt
 * 加えて `<指標>_min_<n>` / `<指標>_max_<n>`(treatment の絶対値の下限 / 上限)を受け付ける。
 */
export function guardrailCheck(id: string): Check {
  if (id === "crash_free") {
    return (c, t) =>
      c.crash_free === null || t.crash_free === null
        ? skipped(id, "crash_free が null")
        : {
            id,
            ok: t.crash_free >= c.crash_free - 0.005,
            skipped: false,
            detail: `treatment ${fmt(t.crash_free)} ≥ control ${fmt(c.crash_free)} − 0.005`,
          };
  }
  if (id === "abandon_rate") {
    return (c, t) =>
      c.abandon_rate === null || t.abandon_rate === null
        ? skipped(id, "abandon_rate が null")
        : {
            id,
            ok: t.abandon_rate <= c.abandon_rate + 0.03,
            skipped: false,
            detail: `treatment ${fmt(t.abandon_rate)} ≤ control ${fmt(c.abandon_rate)} + 0.03`,
          };
  }
  if (id === "median_game_seconds") {
    return (_c, t) =>
      t.median_game_seconds === null
        ? skipped(id, "median_game_seconds が null")
        : {
            id,
            ok: t.median_game_seconds >= 120 && t.median_game_seconds <= 600,
            skipped: false,
            detail: `treatment ${fmt(t.median_game_seconds)} が 120〜600`,
          };
  }
  const m = /^(crash_free|median_game_seconds|abandon_rate)_(min|max)_(\d+(?:\.\d+)?)$/.exec(id);
  if (m !== null) {
    const metric = m[1] as ArmMetric;
    const kind = m[2] as "min" | "max";
    const bound = Number(m[3]);
    return (_c, t) => {
      const v = t[metric];
      if (v === null) return skipped(id, `${metric} が null`);
      const ok = kind === "min" ? v >= bound : v <= bound;
      return {
        id,
        ok,
        skipped: false,
        detail: `treatment ${metric} ${fmt(v)} ${kind === "min" ? "≥" : "≤"} ${bound}`,
      };
    };
  }
  throw new Error(
    `未対応のガードレール ID: ${id}(使えるもの: crash_free, median_game_seconds, abandon_rate, <指標>_min_<n>, <指標>_max_<n>)`,
  );
}

/* ------------------------------------------------------------------ */
/* 判定                                                                 */
/* ------------------------------------------------------------------ */

export interface DecisionStats {
  primaryMetric: string;
  direction: "up" | "down";
  days: number;
  installs: Record<string, number>;
  n: Record<string, number>;
  mean: Record<string, number | null>;
  welch: {
    t: number | null;
    df: number;
    p: number;
    diff: number;
    ci95: [number, number];
    liftPct: number | null;
    liftCi95Pct: [number, number] | null;
  } | null;
}

export interface DecisionJson {
  schemaVersion: 1;
  date: string;
  evaluatedAt: string;
  experiment: string | null;
  decision: DecisionKind;
  reason: string;
  stats: DecisionStats | null;
  guardrails: GuardrailResult[];
}

export interface DecideInput {
  date: string;
  nowMs: number;
  experiment: Experiment | null;
  /** metrics の experiment.arms(ガードレール用)。 */
  arms: Record<string, ArmSummary> | null;
  installs: readonly InstallRow[];
}

const iso = (ms: number): string => new Date(ms).toISOString().replace(".000Z", "Z");
const signed = (v: number, digits = 1): string => `${v >= 0 ? "+" : ""}${v.toFixed(digits)}`;

export function decide(input: DecideInput): DecisionJson {
  const base = { schemaVersion: 1 as const, date: input.date, evaluatedAt: iso(input.nowMs) };
  const exp = input.experiment;
  if (exp === null) {
    return {
      ...base,
      experiment: null,
      decision: "none",
      reason: "稼働中の実験はありません",
      stats: null,
      guardrails: [],
    };
  }
  if (exp.startedAt === undefined)
    throw new Error(`${exp.id}: running なのに startedAt がありません`);

  const variants = Object.keys(exp.allocation).sort();
  if (!variants.includes("control") || variants.length !== 2) {
    throw new Error(
      `${exp.id}: 判定は control と treatment の 2 腕のみ対応です(現在: ${variants.join(", ")})`,
    );
  }
  const treatment = variants.find((v) => v !== "control") as string;

  const metric = PRIMARY_METRICS[exp.primaryMetric];
  if (metric === undefined) {
    throw new Error(
      `${exp.id}: 未対応の主要指標 ${exp.primaryMetric}(使えるもの: ${Object.keys(PRIMARY_METRICS).join(", ")})`,
    );
  }
  const checks = exp.guardrails.map((id) => ({ id, check: guardrailCheck(id) }));

  const days = Math.max(0, Math.floor((input.nowMs - Date.parse(exp.startedAt)) / MS_PER_DAY));
  const rowsOf = (v: string) => input.installs.filter((r) => r.variant === v);
  const installs = { control: rowsOf("control").length, [treatment]: rowsOf(treatment).length };
  const values = (v: string): number[] =>
    rowsOf(v)
      .map((r) => metric.value(r))
      .filter((x): x is number => x !== null && Number.isFinite(x));
  const a = values("control");
  const b = values(treatment);
  const nC = installs["control"] as number;
  const nT = installs[treatment] as number;

  const result = welch(a, b);
  const stats: DecisionStats = {
    primaryMetric: exp.primaryMetric,
    direction: metric.direction,
    days,
    installs,
    n: { control: a.length, [treatment]: b.length },
    mean: {
      control: a.length > 0 ? round(a.reduce((s, x) => s + x, 0) / a.length, 4) : null,
      [treatment]: b.length > 0 ? round(b.reduce((s, x) => s + x, 0) / b.length, 4) : null,
    },
    welch: result === null ? null : welchJson(result),
  };
  const summary = `n=${nC}/${nT}, days=${days}`;

  // 1. ガードレール
  let guardrails: GuardrailResult[] = [];
  const armC = input.arms?.["control"];
  const armT = input.arms?.[treatment];
  if (nC >= GUARDRAIL_MIN_INSTALLS && nT >= GUARDRAIL_MIN_INSTALLS && armC && armT) {
    guardrails = checks.map(({ check }) => check(armC, armT));
    const broken = guardrails.filter((g) => !g.ok);
    if (broken.length > 0) {
      return {
        ...base,
        experiment: exp.id,
        decision: "rollback",
        reason: `${summary}, guardrail breached: ${broken.map((g) => `${g.id} (${g.detail})`).join("; ")}`,
        stats,
        guardrails,
      };
    }
  }
  const guardText = guardrails.length === 0 ? "guardrails not evaluated (n<100)" : "guardrails ok";

  // 2. サンプル到達 → 検定
  const reached = nC >= exp.minUsersPerArm && nT >= exp.minUsersPerArm && days >= MIN_DAYS;
  if (reached && result !== null && stats.welch !== null) {
    const w = stats.welch;
    const liftText =
      w.liftPct === null || w.liftCi95Pct === null
        ? `diff=${signed(w.diff, 4)}`
        : `lift=${signed(w.liftPct)}% (95%CI ${signed(w.liftCi95Pct[0])}..${signed(w.liftCi95Pct[1])})`;
    const text = `${summary}, ${liftText}, p=${w.p.toFixed(3)}, ${guardText}`;
    if (result.p < ALPHA && result.diff !== 0) {
      const improved = metric.direction === "up" ? result.diff > 0 : result.diff < 0;
      return {
        ...base,
        experiment: exp.id,
        decision: improved ? "promote" : "rollback",
        reason: text,
        stats,
        guardrails,
      };
    }
    if (days >= exp.maxDays) {
      return {
        ...base,
        experiment: exp.id,
        decision: "inconclusive",
        reason: `${text}, maxDays reached`,
        stats,
        guardrails,
      };
    }
    return { ...base, experiment: exp.id, decision: "continue", reason: text, stats, guardrails };
  }

  // 3. 期限
  const waiting = `${summary}, need n>=${exp.minUsersPerArm}/arm and days>=${MIN_DAYS}, ${guardText}`;
  if (days >= exp.maxDays) {
    return {
      ...base,
      experiment: exp.id,
      decision: "inconclusive",
      reason: `${waiting}, maxDays reached`,
      stats,
      guardrails,
    };
  }
  return { ...base, experiment: exp.id, decision: "continue", reason: waiting, stats, guardrails };
}

function welchJson(r: WelchResult): NonNullable<DecisionStats["welch"]> {
  const lift = r.mean0 > 0 ? (r.diff / r.mean0) * 100 : null;
  return {
    t: r.t === null ? null : round(r.t, 4),
    df: round(r.df, 2),
    p: round(r.p, 6),
    diff: round(r.diff, 6),
    ci95: [round(r.ciLow, 6), round(r.ciHigh, 6)],
    liftPct: lift === null ? null : round(lift, 2),
    liftCi95Pct:
      r.mean0 > 0
        ? [round((r.ciLow / r.mean0) * 100, 2), round((r.ciHigh / r.mean0) * 100, 2)]
        : null,
  };
}
