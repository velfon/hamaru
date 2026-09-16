import { forceDaily } from "../../../src/config/resolve";
import { dailySeed } from "../../../src/core/daily";
import type { Mode, ResolvedConfig } from "../../../src/core/types";

export interface GoldenTarget {
  file: string;
  mode: Mode;
  seed: string;
}

/** docs/06 §3 の 2 本。 */
export const GOLDEN_TARGETS: readonly GoldenTarget[] = [
  { file: "daily-2026-10-01.json", mode: "daily", seed: dailySeed("2026-10-01") },
  { file: "endless-seed-42.json", mode: "endless", seed: "42" },
];

/** デイリーは fitGuarantee / pity が強制 OFF になる(docs/01 §4.2)。 */
export function configForTarget(base: ResolvedConfig, target: GoldenTarget): ResolvedConfig {
  return target.mode === "daily" ? forceDaily(base) : base;
}
