/**
 * ヘッドレスシミュレーション CLI(docs/06 §4、docs/07 M2)。
 *
 *   npm run sim -- --games 2000 --bots random,greedy,lookahead --seed 1 \
 *                  [--config path] [--variant treatment] [--check] [--write-baseline]
 *
 * 出力: sim/out/<bot>.json(各ボットの統計)。`--check` は sim/baseline.json の帯域と比較する。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_CONFIG_PATH, loadExperiments, loadGameConfig } from "../src/config/load";
import { deepMerge, runningExperiment } from "../src/config/resolve";
import { newGame, place } from "../src/core/game";
import { createRng } from "../src/core/rng";
import { safeParseGameConfig } from "../src/config/schema";
import type { ResolvedConfig } from "../src/core/types";
import { greedyBot } from "./bots/greedy";
import { lookaheadBot } from "./bots/lookahead";
import { randomBot } from "./bots/random";
import type { Bot } from "./bots/types";
import {
  buildBotReport,
  checkAgainstBaseline,
  formatCheck,
  formatReport,
  type GameOutcome,
  type SimReport,
} from "./report";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = resolve(repoRoot, "sim/out");
const BASELINE_PATH = resolve(repoRoot, "sim/baseline.json");

const BOTS: Record<string, Bot> = {
  random: randomBot,
  greedy: greedyBot,
  lookahead: lookaheadBot,
};

/** 1 ゲームで安全に打てる最大手数(暴走検知)。 */
const MAX_MOVES = 5000;

export interface Options {
  games: number;
  bots: string[];
  seed: number;
  configPath: string;
  variant: string | null;
  check: boolean;
  writeBaseline: boolean;
}

export function parseArgs(argv: readonly string[]): Options {
  const options: Options = {
    games: 2000,
    bots: ["random", "greedy", "lookahead"],
    seed: 1,
    configPath: DEFAULT_CONFIG_PATH,
    variant: null,
    check: false,
    writeBaseline: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = (): string => {
      const v = argv[i + 1];
      if (v === undefined) throw new Error(`${arg} には値が要ります`);
      i++;
      return v;
    };
    switch (arg) {
      case "--games":
        options.games = Number(next());
        break;
      case "--bots":
        options.bots = next()
          .split(",")
          .map((s) => s.trim())
          .filter((s) => s.length > 0);
        break;
      case "--seed":
        options.seed = Number(next());
        break;
      case "--config":
        options.configPath = next();
        break;
      case "--variant":
        options.variant = next();
        break;
      case "--check":
        options.check = true;
        break;
      case "--write-baseline":
        options.writeBaseline = true;
        break;
      default:
        throw new Error(`不明な引数: ${String(arg)}`);
    }
  }

  if (!Number.isInteger(options.games) || options.games < 1) {
    throw new Error("--games は 1 以上の整数");
  }
  if (!Number.isFinite(options.seed)) throw new Error("--seed は数値");
  for (const name of options.bots) {
    if (BOTS[name] === undefined) {
      throw new Error(`不明なボット: ${name}(${Object.keys(BOTS).join(", ")} のいずれか)`);
    }
  }
  return options;
}

/**
 * `--variant` が指定されたら、running 実験の該当バリアントを base に deep-merge する。
 * 実験 PR で両バリアントを走らせるための入口(docs/06 §4)。
 */
export function applyVariant(base: ResolvedConfig, variant: string | null): ResolvedConfig {
  if (variant === null) return base;
  const experiments = loadExperiments();
  const exp = runningExperiment(experiments);
  if (exp === null) {
    throw new Error("--variant が指定されましたが status: running の実験がありません");
  }
  const override = exp.variants[variant];
  if (override === undefined) {
    throw new Error(
      `実験 ${exp.id} に variant "${variant}" がありません(${Object.keys(exp.variants).join(", ")})`,
    );
  }
  const parsed = safeParseGameConfig(deepMerge(structuredClone(base), override));
  if (!parsed.ok) {
    throw new Error(`variant "${variant}" の解決結果が不正です:\n${parsed.error}`);
  }
  return parsed.config;
}

/** 1 ゲームをボットに最後まで打たせる。 */
export function playGame(bot: Bot, config: ResolvedConfig, gameSeed: string): GameOutcome {
  let state = newGame(config, "endless", gameSeed, 0);
  const botRng = createRng(`bot:${gameSeed}`);
  let boardClear = false;

  for (let m = 0; m < MAX_MOVES && state.status === "playing"; m++) {
    const move = bot.chooseMove(state, config, botRng);
    if (move === null) break;
    const { state: next, result } = place(state, config, move.trayIndex, move.x, move.y);
    if (!result.ok) {
      throw new Error(
        `${bot.name}: 不正な手 tray=${move.trayIndex} (${move.x},${move.y}) seed=${gameSeed}`,
      );
    }
    if (result.boardCleared) boardClear = true;
    state = next;
  }

  return {
    moves: state.moves,
    score: state.score,
    lines: state.linesCleared,
    round: state.round,
    // 1 ラウンド目のまま終わった = 最初のトレイを置き切れずに詰んだ。
    gameOverAtRound1: state.round === 1,
    boardClear,
  };
}

export function runSimulation(options: Options): SimReport {
  const base = loadGameConfig(options.configPath);
  const config = applyVariant(base, options.variant);
  const startedAt = Date.now();
  const report: SimReport = {
    generatedFrom: {
      config: options.configPath,
      variant: options.variant,
      seed: options.seed,
      games: options.games,
    },
    bots: {},
    totalElapsedMs: 0,
  };

  for (const name of options.bots) {
    const bot = BOTS[name];
    /* c8 ignore next */
    if (bot === undefined) continue;
    const botStart = Date.now();
    const outcomes: GameOutcome[] = [];
    for (let i = 0; i < options.games; i++) {
      outcomes.push(playGame(bot, config, `sim:${options.seed}:${i}`));
    }
    report.bots[name] = buildBotReport(name, outcomes, Date.now() - botStart);
  }

  report.totalElapsedMs = Date.now() - startedAt;
  return report;
}

function main(argv: readonly string[]): number {
  const options = parseArgs(argv);
  const report = runSimulation(options);

  mkdirSync(OUT_DIR, { recursive: true });
  for (const [name, botReport] of Object.entries(report.bots)) {
    writeFileSync(
      resolve(OUT_DIR, `${name}.json`),
      JSON.stringify({ ...report.generatedFrom, ...botReport }, null, 2) + "\n",
      "utf8",
    );
  }
  console.log(formatReport(report));

  if (options.writeBaseline) {
    writeFileSync(BASELINE_PATH, JSON.stringify(report, null, 2) + "\n", "utf8");
    console.log(`\nbaseline を書き出しました: ${BASELINE_PATH}`);
  }

  if (options.check) {
    if (!existsSync(BASELINE_PATH)) {
      console.error(`baseline がありません: ${BASELINE_PATH}`);
      return 1;
    }
    const baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8")) as SimReport;
    const result = checkAgainstBaseline(report, baseline);
    console.log("\n" + formatCheck(result));
    return result.ok ? 0 : 1;
  }
  return 0;
}

/** 直接実行されたときだけ CLI として動く(テストからの import では動かさない)。 */
const entry = process.argv[1];
if (entry !== undefined && resolve(entry) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
