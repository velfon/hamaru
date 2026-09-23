/**
 * `npm run levels:table` — レベルの面の表 `src/config/levels-table.json` を作る(docs/09 §4)。
 *
 * レベルごとにシードの候補(variant 0, 1, 2, …)を順に試し、ボットが実際にクリアできた最初の候補を採用する。
 * 序盤(レベル 1〜10)は弱い greedy ボットで、それ以降は lookahead ボットで解けることを条件にする。
 * これで「解けない面で先に進めない」ことが起きない。表には config のハッシュを入れ、
 * config が変わって表が古くなったら `validate:config` が検出する。
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { DEFAULT_CONFIG_PATH, loadGameConfig } from "../src/config/load";
import { place } from "../src/core/game";
import {
  LEVEL_TABLE_SIZE,
  levelsConfigHash,
  MAX_LEVEL_VARIANTS,
  newLevelGame,
  type LevelsTable,
} from "../src/core/levels";
import { createRng } from "../src/core/rng";
import type { ResolvedConfig } from "../src/core/types";
import { greedyBot } from "../sim/bots/greedy";
import { lookaheadBot } from "../sim/bots/lookahead";
import type { Bot } from "../sim/bots/types";

/** 序盤は greedy でも解ける面にする(確実に易しく)。 */
export const EASY_LEVELS = 10;

export function solverFor(level: number): Bot {
  return level <= EASY_LEVELS ? greedyBot : lookaheadBot;
}

export function clears(bot: Bot, config: ResolvedConfig, level: number, variant: number): boolean {
  let s = newLevelGame(config, level, 0, variant);
  const rng = createRng(`solver:${level}:${variant}`);
  for (let i = 0; i < 2000 && s.status === "playing"; i++) {
    const m = bot.chooseMove(s, config, rng);
    if (m === null) break;
    s = place(s, config, m.x, m.y).state;
  }
  return s.status === "cleared";
}

export function buildTable(config: ResolvedConfig, size = LEVEL_TABLE_SIZE): LevelsTable {
  const variants: number[] = [];
  for (let n = 1; n <= size; n++) {
    const bot = solverFor(n);
    let found = -1;
    for (let v = 0; v < MAX_LEVEL_VARIANTS && found < 0; v++) {
      if (clears(bot, config, n, v)) found = v;
    }
    variants.push(found);
  }
  return { schemaVersion: 1, configHash: levelsConfigHash(config), variants };
}

function main(): number {
  const config = loadGameConfig(resolve(DEFAULT_CONFIG_PATH));
  const t0 = Date.now();
  const table = buildTable(config);
  const out = resolve("src/config/levels-table.json");
  writeFileSync(out, JSON.stringify(table) + "\n", "utf8");
  const missing = table.variants.flatMap((v, i) => (v < 0 ? [i + 1] : []));
  console.log(
    `levels:table: ${table.variants.length} レベル、hash ${table.configHash}、${Date.now() - t0} ms → ${out}`,
  );
  if (missing.length > 0) {
    console.error(`解ける候補が見つからなかったレベル: ${missing.join(", ")}(variant 0 で遊ぶ)`);
    return 1;
  }
  return 0;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  process.exitCode = main();
}
