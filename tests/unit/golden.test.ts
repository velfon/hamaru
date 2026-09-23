/**
 * 黄金テスト(docs/06 §3)。
 * 不一致 = **ルールが変わった**ということ。意図的なら PR に `golden: update` ラベルを付け、
 * `npm run golden:update` で更新し、kaizen/CHANGELOG.md に「ルール変更」と明記する。
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../../src/config";
import { GOLDEN_TARGETS, configForTarget } from "./golden/targets";
import { runGoldenScript, type GoldenSnapshot } from "./golden/scripted-run";

const readGolden = (file: string): GoldenSnapshot =>
  JSON.parse(readFileSync(new URL(`./golden/${file}`, import.meta.url), "utf8")) as GoldenSnapshot;

describe("golden", () => {
  it.each(GOLDEN_TARGETS)("$file が固定されている", (target) => {
    const expected = readGolden(target.file);
    const { snapshot } = runGoldenScript(
      configForTarget(DEFAULT_CONFIG, target),
      target.mode,
      target.seed,
    );
    expect(snapshot).toEqual(expected);
  });

  it.each(GOLDEN_TARGETS)("$file: 同じ入力を 2 回走らせても同じ(決定性)", (target) => {
    const config = configForTarget(DEFAULT_CONFIG, target);
    const a = runGoldenScript(config, target.mode, target.seed);
    const b = runGoldenScript(config, target.mode, target.seed);
    expect(a.snapshot).toEqual(b.snapshot);
  });

  it("50 手のスクリプトが実際に十分な手数を消化している", () => {
    for (const target of GOLDEN_TARGETS) {
      const golden = readGolden(target.file);
      expect(golden.movesRequested).toBe(50);
      expect(golden.movesApplied, target.file).toBeGreaterThan(10);
      expect(golden.board).toHaveLength(DEFAULT_CONFIG.board.size ** 2);
    }
  });

  it("デイリーは誰がやっても同じ条件(config が base と同じ)", () => {
    const target = GOLDEN_TARGETS.find((t) => t.mode === "daily");
    expect(target).toBeDefined();
    if (target === undefined) return;
    expect(configForTarget(DEFAULT_CONFIG, target).sakate).toEqual(DEFAULT_CONFIG.sakate);
  });

  it("供給に乱数が無い: 同じ盤・同じ手順なら、かけらも同じ", () => {
    const target = GOLDEN_TARGETS[0] as (typeof GOLDEN_TARGETS)[number];
    const config = configForTarget(DEFAULT_CONFIG, target);
    const a = runGoldenScript(config, target.mode, target.seed, 20);
    const b = runGoldenScript(config, target.mode, target.seed, 20);
    expect(a.snapshot.piece).toEqual(b.snapshot.piece);
    expect(a.state.heat).toBe(b.state.heat);
  });
});
