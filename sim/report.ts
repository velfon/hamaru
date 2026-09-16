/**
 * シミュレーション結果の集計と帯域判定(docs/06 §4)。
 */

export interface GameOutcome {
  moves: number;
  score: number;
  lines: number;
  round: number;
  gameOverAtRound1: boolean;
  boardClear: boolean;
}

export interface Distribution {
  mean: number;
  median: number;
  p10: number;
  p90: number;
  min: number;
  max: number;
}

export interface BotReport {
  bot: string;
  games: number;
  moves: Distribution;
  score: Distribution;
  lines: Distribution;
  round: Distribution;
  /** 1 ラウンド目で詰んだゲームの割合。fitGuarantee: oneOfThree なら 0 でなければならない。 */
  gameOverAtRound1: number;
  /** 1 回以上全消しが起きたゲームの割合。 */
  boardClear: number;
  elapsedMs: number;
}

export interface SimReport {
  generatedFrom: {
    config: string;
    variant: string | null;
    seed: number;
    games: number;
  };
  bots: Record<string, BotReport>;
  totalElapsedMs: number;
}

/** 線形補間しない単純な分位点(下側の順序統計量)。 */
export function percentile(sortedValues: readonly number[], p: number): number {
  if (sortedValues.length === 0) return 0;
  const idx = Math.min(
    sortedValues.length - 1,
    Math.max(0, Math.ceil(p * sortedValues.length) - 1),
  );
  return sortedValues[idx] ?? 0;
}

export function median(sortedValues: readonly number[]): number {
  const n = sortedValues.length;
  if (n === 0) return 0;
  if (n % 2 === 1) return sortedValues[(n - 1) / 2] ?? 0;
  const a = sortedValues[n / 2 - 1] ?? 0;
  const b = sortedValues[n / 2] ?? 0;
  return (a + b) / 2;
}

export function describe(values: readonly number[]): Distribution {
  if (values.length === 0) {
    return { mean: 0, median: 0, p10: 0, p90: 0, min: 0, max: 0 };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  return {
    mean: round3(sum / sorted.length),
    median: round3(median(sorted)),
    p10: round3(percentile(sorted, 0.1)),
    p90: round3(percentile(sorted, 0.9)),
    min: sorted[0] ?? 0,
    max: sorted[sorted.length - 1] ?? 0,
  };
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}

export function buildBotReport(
  bot: string,
  outcomes: readonly GameOutcome[],
  elapsedMs: number,
): BotReport {
  const games = outcomes.length;
  return {
    bot,
    games,
    moves: describe(outcomes.map((o) => o.moves)),
    score: describe(outcomes.map((o) => o.score)),
    lines: describe(outcomes.map((o) => o.lines)),
    round: describe(outcomes.map((o) => o.round)),
    gameOverAtRound1: games === 0 ? 0 : outcomes.filter((o) => o.gameOverAtRound1).length / games,
    boardClear: games === 0 ? 0 : round3(outcomes.filter((o) => o.boardClear).length / games),
    elapsedMs: Math.round(elapsedMs),
  };
}

/* ------------------------------------------------------------------ */
/* 帯域判定(docs/06 §4「帯域」)                                        */
/* ------------------------------------------------------------------ */

/** baseline ± この割合。 */
export const BAND = 0.3;
/** random.median_moves がこの割合を下回ったら「明らかに壊れている」。 */
export const HARD_FLOOR = 0.5;

export interface BandCheck {
  metric: string;
  baseline: number;
  actual: number;
  low: number;
  high: number;
  ok: boolean;
  fatal: boolean;
}

/** docs/06 §4 の表で判定する指標。 */
const BANDED: ReadonlyArray<[bot: string, key: "moves" | "score", label: string]> = [
  ["random", "moves", "random.median_moves"],
  ["greedy", "moves", "greedy.median_moves"],
  ["greedy", "score", "greedy.median_score"],
  ["lookahead", "moves", "lookahead.median_moves"],
];

export interface CheckResult {
  bands: BandCheck[];
  /** `*.gameOverAtRound1` が 0 でなかったボット。 */
  gameOverViolations: string[];
  /** baseline に無い / 今回走らせていないため判定できなかった指標。 */
  skipped: string[];
  ok: boolean;
}

export function checkAgainstBaseline(current: SimReport, baseline: SimReport): CheckResult {
  const bands: BandCheck[] = [];
  const skipped: string[] = [];

  for (const [bot, key, label] of BANDED) {
    const cur = current.bots[bot];
    const base = baseline.bots[bot];
    if (cur === undefined || base === undefined) {
      skipped.push(label);
      continue;
    }
    const baseValue = base[key].median;
    const actual = cur[key].median;
    const low = baseValue * (1 - BAND);
    const high = baseValue * (1 + BAND);
    bands.push({
      metric: label,
      baseline: baseValue,
      actual,
      low: round3(low),
      high: round3(high),
      ok: actual >= low && actual <= high,
      fatal: label === "random.median_moves" && actual < baseValue * HARD_FLOOR,
    });
  }

  const gameOverViolations = Object.values(current.bots)
    .filter((b) => b.gameOverAtRound1 !== 0)
    .map((b) => b.bot);

  return {
    bands,
    gameOverViolations,
    skipped,
    ok: bands.every((b) => b.ok) && gameOverViolations.length === 0,
  };
}

/* ------------------------------------------------------------------ */
/* 表示                                                                */
/* ------------------------------------------------------------------ */

const pad = (s: string, n: number): string => s.padEnd(n);
const num = (v: number, n = 9): string => v.toFixed(v % 1 === 0 ? 0 : 2).padStart(n);

export function formatReport(report: SimReport): string {
  const lines: string[] = [];
  lines.push(
    `games=${report.generatedFrom.games} seed=${report.generatedFrom.seed} config=${report.generatedFrom.config}` +
      (report.generatedFrom.variant === null ? "" : ` variant=${report.generatedFrom.variant}`),
  );
  lines.push(
    `${pad("bot", 11)}${pad("med moves", 11)}${pad("med score", 11)}${pad("med lines", 11)}${pad("med round", 11)}${pad("p10/p90 score", 18)}${pad("over@r1", 9)}${pad("clear", 8)}ms`,
  );
  for (const bot of Object.values(report.bots)) {
    lines.push(
      pad(bot.bot, 11) +
        pad(String(bot.moves.median), 11) +
        pad(String(bot.score.median), 11) +
        pad(String(bot.lines.median), 11) +
        pad(String(bot.round.median), 11) +
        pad(`${bot.score.p10} / ${bot.score.p90}`, 18) +
        pad(bot.gameOverAtRound1.toFixed(4), 9) +
        pad(bot.boardClear.toFixed(3), 8) +
        String(bot.elapsedMs),
    );
  }
  lines.push(`total ${report.totalElapsedMs} ms`);
  return lines.join("\n");
}

export function formatCheck(result: CheckResult): string {
  const lines: string[] = ["baseline との帯域比較 (±30 %):"];
  for (const b of result.bands) {
    lines.push(
      `  ${b.ok ? "OK  " : "NG  "}${pad(b.metric, 24)} actual=${num(b.actual)} baseline=${num(b.baseline)} band=[${b.low}, ${b.high}]${b.fatal ? "  ** baseline の 50 % 未満: 明らかに壊れている **" : ""}`,
    );
  }
  for (const metric of result.skipped) {
    lines.push(`  SKIP ${metric}(baseline か今回の実行に無い)`);
  }
  for (const bot of result.gameOverViolations) {
    lines.push(`  NG  ${bot}.gameOverAtRound1 != 0`);
  }
  lines.push(result.ok ? "帯域内" : "帯域外");
  return lines.join("\n");
}
