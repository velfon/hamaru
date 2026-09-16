/**
 * `npm run validate:config` — game-config.json / experiments.json をスキーマで検証する。
 * 範囲外の値があれば非ゼロ終了する(docs/02 §4.1「範囲外はビルド失敗」)。
 *
 * 使い方: tsx scripts/validate-config.ts [game-config.json] [experiments.json]
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { safeParseExperiments, safeParseGameConfig } from "../src/config/schema";

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

function main(argv: readonly string[]): number {
  const configPath = resolve(argv[0] ?? "src/config/game-config.json");
  const experimentsPath = resolve(argv[1] ?? "src/config/experiments.json");

  const problems: string[] = [];

  for (const [label, path, check] of [
    ["game-config", configPath, safeParseGameConfig],
    ["experiments", experimentsPath, safeParseExperiments],
  ] as const) {
    let raw: unknown;
    try {
      raw = readJson(path);
    } catch (e) {
      problems.push(`${label}: 読み込みに失敗しました (${path}): ${String(e)}`);
      continue;
    }
    const result = check(raw);
    if (!result.ok) problems.push(`${label} (${path}):\n${result.error}`);
  }

  if (problems.length > 0) {
    console.error("config の検証に失敗しました:\n");
    for (const p of problems) console.error(p + "\n");
    return 1;
  }
  console.log(`config OK: ${configPath}, ${experimentsPath}`);
  return 0;
}

process.exitCode = main(process.argv.slice(2));
