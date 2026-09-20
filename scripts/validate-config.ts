/**
 * `npm run validate:config` — game-config.json / experiments.json をスキーマで検証する。
 * 範囲外の値があれば非ゼロ終了する(docs/02 §4.1「範囲外はビルド失敗」)。
 *
 * 使い方: tsx scripts/validate-config.ts [game-config.json] [experiments.json]
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { allResolutions } from "../src/config/resolve";
import { levelsConfigHash, type LevelsTable } from "../src/core/levels";
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

  // 実行時にあり得る解決結果をすべて検証する(ブラウザは再検証しない。docs/02 §11 N-10)。
  let resolutions = 0;
  if (problems.length === 0) {
    const base = safeParseGameConfig(readJson(configPath));
    const experiments = safeParseExperiments(readJson(experimentsPath));
    if (base.ok && experiments.ok) {
      for (const { label, config } of allResolutions(base.config, experiments.file)) {
        resolutions++;
        const r = safeParseGameConfig(config);
        if (!r.ok) problems.push(`解決結果 ${label}:\n${r.error}`);
      }
    }
  }

  // レベルの面の表が今の config で作られたものか(docs/09 §4)。
  const tablePath = resolve(argv[2] ?? "src/config/levels-table.json");
  if (problems.length === 0) {
    const base = safeParseGameConfig(readJson(configPath));
    try {
      const table = readJson(tablePath) as LevelsTable;
      if (base.ok && table.configHash !== levelsConfigHash(base.config)) {
        problems.push(
          `levels-table (${tablePath}): config が変わったので面の表が古くなっています。\n` +
            "  npm run levels:table で作り直してください(docs/09 §4)",
        );
      }
    } catch (e) {
      problems.push(`levels-table: 読み込みに失敗しました (${tablePath}): ${String(e)}`);
    }
  }

  if (problems.length > 0) {
    console.error("config の検証に失敗しました:\n");
    for (const p of problems) console.error(p + "\n");
    return 1;
  }
  console.log(`config OK: ${configPath}, ${experimentsPath}(解決結果 ${resolutions} 通り)`);
  return 0;
}

process.exitCode = main(process.argv.slice(2));
