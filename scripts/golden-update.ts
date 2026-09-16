/**
 * `npm run golden:update` — 黄金テストのスナップショットを再生成する(docs/06 §3)。
 * **ルール変更時のみ**。PR に `golden: update` ラベルが要る(bot は付けられない)。
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadGameConfig } from "../src/config/load";
import { GOLDEN_TARGETS, configForTarget } from "../tests/unit/golden/targets";
import { runGoldenScript } from "../tests/unit/golden/scripted-run";

const config = loadGameConfig();

for (const target of GOLDEN_TARGETS) {
  const { snapshot } = runGoldenScript(configForTarget(config, target), target.mode, target.seed);
  const path = resolve(`tests/unit/golden/${target.file}`);
  writeFileSync(path, JSON.stringify(snapshot, null, 2) + "\n", "utf8");
  console.log(
    `updated ${target.file}: moves=${snapshot.movesApplied} score=${snapshot.score} lines=${snapshot.linesCleared} status=${snapshot.status}`,
  );
}
