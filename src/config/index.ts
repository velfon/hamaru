/**
 * 既定の config / experiments(ブラウザ用)。バンドル時に JSON を取り込む。
 *
 * **ここでは zod を使わない**(初回 JS の約 6 割が zod だった。docs/02 §11 N-10)。
 * 両 JSON と、全実験 × 全バリアント × 両モードの解決結果は `npm run validate:config` が
 * ビルドの前に検証する(`npm run build` / CI の G1 / deploy のすべてで先に走る)。
 *
 * Node 側(sim / scripts)は `src/config/load.ts`(zod で検証して読む)を使う。
 */
import type { ResolvedConfig } from "../core/types";
import type { LevelsTable } from "../core/levels";
import experimentsJson from "./experiments.json";
import gameConfigJson from "./game-config.json";
import levelsTableJson from "./levels-table.json";
import type { ExperimentsFile } from "./schema";

export const DEFAULT_CONFIG = gameConfigJson as unknown as ResolvedConfig;
export const DEFAULT_EXPERIMENTS = experimentsJson as unknown as ExperimentsFile;
/**
 * レベルの面の表(docs/09 §4)。レベルは実験を適用しない既定の config で遊ぶ
 * (実験でかけらの出方が変わると表の「解ける面」の前提が崩れるため)。
 */
export const LEVELS_TABLE = levelsTableJson as unknown as LevelsTable;

export * from "./resolve";
export type * from "./schema";
