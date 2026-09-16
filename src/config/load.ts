/**
 * Node 側(sim / scripts)向けの config ローダ。
 * ブラウザバンドルからは参照しない(`src/config/index.ts` が JSON を直接 import する)。
 */
import { readFileSync } from "node:fs";
import type { ResolvedConfig } from "../core/types";
import { parseExperiments, parseGameConfig } from "./schema";
import type { ExperimentsFile } from "./schema";

export const DEFAULT_CONFIG_PATH = "src/config/game-config.json";
export const DEFAULT_EXPERIMENTS_PATH = "src/config/experiments.json";

export function loadGameConfig(path: string = DEFAULT_CONFIG_PATH): ResolvedConfig {
  return parseGameConfig(JSON.parse(readFileSync(path, "utf8")));
}

export function loadExperiments(path: string = DEFAULT_EXPERIMENTS_PATH): ExperimentsFile {
  return parseExperiments(JSON.parse(readFileSync(path, "utf8")));
}
