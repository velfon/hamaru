/**
 * レベルの難易度曲線(docs/09 §4)。
 *
 *   npm run sim:levels -- [--from 1] [--to 60] [--trials 5] [--config path] [--check]
 *
 * 各レベルを greedy(乱数の違う trials 回)と lookahead(1 回)で遊び、クリア率・星・目標などを出す。
 * `--check` は docs/09 §4 の条件を確かめ、満たさなければ exit 1。
 */
import { resolve } from "node:path";
import { DEFAULT_CONFIG_PATH, loadGameConfig } from "../src/config/load";
import { place } from "../src/core/game";
import { readFileSync } from "node:fs";
import {
  levelParams,
  levelsConfigHash,
  levelVariant,
  newLevelGame,
  starsFor,
  type LevelsTable,
} from "../src/core/levels";
import { createRng } from "../src/core/rng";
import type { GameState, ResolvedConfig } from "../src/core/types";
import { greedyBot } from "./bots/greedy";
import { lookaheadBot } from "./bots/lookahead";
import type { Bot } from "./bots/types";

export interface LevelRow {
  level: number;
  variant: number;
  /** トレイ上限を切り上げる前の「1 列あたりのトレイ数」。 */
  perLine: number;
  goal: number;
  moveLimit: number;
  obstacles: number;
  greedyClearRate: number;
  greedyStars: number;
  lookaheadCleared: boolean;
  lookaheadStars: number;
}

function playLevel(
  bot: Bot,
  config: ResolvedConfig,
  level: number,
  variant: number,
  botSeed: string,
): GameState {
  let state = newLevelGame(config, level, 0, variant);
  const rng = createRng(botSeed);
  for (let i = 0; i < 2000 && state.status === "playing"; i++) {
    const m = bot.chooseMove(state, config, rng);
    if (m === null) break;
    state = place(state, config, m.x, m.y).state;
  }
  return state;
}

export function levelCurve(
  config: ResolvedConfig,
  from: number,
  to: number,
  trials: number,
  table?: LevelsTable,
): LevelRow[] {
  const rows: LevelRow[] = [];
  for (let n = from; n <= to; n++) {
    const p = levelParams(config.levels, n);
    const variant = table === undefined ? 0 : levelVariant(table, n);
    const l = config.levels;
    const perLine = Math.max(l.movesPerLineEnd, l.movesPerLineStart - l.movesPerLineStep * (n - 1));
    let cleared = 0;
    let stars = 0;
    for (let t = 0; t < trials; t++) {
      const s = playLevel(greedyBot, config, n, variant, `levels:greedy:${n}:${t}`);
      if (s.status === "cleared") cleared++;
      stars += starsFor(s, config.levels);
    }
    const la = playLevel(lookaheadBot, config, n, variant, `levels:lookahead:${n}`);
    rows.push({
      level: n,
      variant,
      perLine,
      goal: p.goal,
      moveLimit: p.moveLimit,
      obstacles: p.obstacles,
      greedyClearRate: cleared / trials,
      greedyStars: stars / trials,
      lookaheadCleared: la.status === "cleared",
      lookaheadStars: starsFor(la, config.levels),
    });
  }
  return rows;
}

/**
 * docs/09 §4 の条件。違反の説明を返す(空なら合格)。
 * 面の表は「序盤は greedy、以降は lookahead が解ける面」を選んでいるので、ここではそれが本当かを確かめる。
 */
export function checkCurve(rows: readonly LevelRow[], easyLevels = 10): string[] {
  const problems: string[] = [];
  const easyFail = rows.filter((r) => r.level <= easyLevels && r.greedyClearRate === 0);
  if (easyFail.length > 0) {
    problems.push(
      `序盤(〜${easyLevels})に greedy で解けない面: ${easyFail.map((r) => r.level).join(", ")}`,
    );
  }
  const hardFail = rows.filter((r) => r.level > easyLevels && !r.lookaheadCleared);
  if (hardFail.length > 0) {
    problems.push(
      `lookahead で解けない面: ${hardFail.map((r) => r.level).join(", ")}(npm run levels:table)`,
    );
  }
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1] as LevelRow;
    const b = rows[i] as LevelRow;
    if (b.goal < a.goal || b.obstacles < a.obstacles || b.perLine > a.perLine + 1e-9) {
      problems.push(
        `レベル ${b.level} が ${a.level} より易しくなっている(目標・欠片・トレイの余裕)`,
      );
    }
  }
  return problems;
}

function main(argv: readonly string[]): number {
  const get = (name: string, fallback: string) => {
    const i = argv.indexOf(name);
    return i >= 0 && argv[i + 1] !== undefined ? (argv[i + 1] as string) : fallback;
  };
  const config = loadGameConfig(resolve(get("--config", DEFAULT_CONFIG_PATH)));
  const from = Number(get("--from", "1"));
  const to = Number(get("--to", "60"));
  const trials = Number(get("--trials", "1"));
  const t0 = Date.now();
  const table = JSON.parse(
    readFileSync(resolve(get("--table", "src/config/levels-table.json")), "utf8"),
  ) as LevelsTable;
  if (table.configHash !== levelsConfigHash(config)) {
    console.error("面の表が config と合っていません。npm run levels:table で作り直してください");
    return 1;
  }
  const rows = levelCurve(config, from, to, trials, table);
  console.log("Lv  var goal trays obst | greedy clear  ★avg | lookahead ★");
  for (const r of rows) {
    console.log(
      `${String(r.level).padStart(3)} ${String(r.variant).padStart(3)} ${String(r.goal).padStart(4)} ${String(r.moveLimit).padStart(5)} ${String(r.obstacles).padStart(4)} | ` +
        `${(r.greedyClearRate * 100).toFixed(0).padStart(6)} %  ${r.greedyStars.toFixed(1).padStart(4)} | ${r.lookaheadCleared ? "clear" : "  -  "} ${r.lookaheadStars}`,
    );
  }
  console.log(`(${Date.now() - t0} ms)`);
  if (argv.includes("--check")) {
    const problems = checkCurve(rows);
    for (const p of problems) console.error(`NG  ${p}`);
    if (problems.length > 0) return 1;
    console.log("難易度曲線 OK");
  }
  return 0;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  process.exitCode = main(process.argv.slice(2));
}
