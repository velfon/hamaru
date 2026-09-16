/**
 * 既定の config / experiments。バンドル時に JSON を取り込む。
 *
 * Node 側(sim / scripts)は JSON import の可搬性を避けるため
 * `fs.readFileSync` + `parseGameConfig` を使う(`sim/load-config.ts`)。
 */
import experimentsJson from "./experiments.json";
import gameConfigJson from "./game-config.json";
import { parseExperiments, parseGameConfig } from "./schema";

export const DEFAULT_CONFIG = parseGameConfig(gameConfigJson);
export const DEFAULT_EXPERIMENTS = parseExperiments(experimentsJson);

export * from "./resolve";
export * from "./schema";
