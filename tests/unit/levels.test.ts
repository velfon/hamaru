/**
 * レベルモード(docs/09)。
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, LEVELS_TABLE } from "../../src/config";
import { deserialize, place, serialize } from "../../src/core/game";
import {
  levelParams,
  levelsConfigHash,
  levelVariant,
  newLevelGame,
  starsFor,
  movesLeft,
} from "../../src/core/levels";
import { OBSTACLE, type GameState, type ResolvedConfig } from "../../src/core/types";
import { resetBackend, saveLevelResult, totalStars, unlockedLevel } from "../../src/storage/local";

const config = DEFAULT_CONFIG;
const L = config.levels;
const repoRoot = fileURLToPath(new URL("../..", import.meta.url));

describe("levelParams(docs/09 §2 の式)", () => {
  it("既定値の代表点", () => {
    expect(levelParams(L, 1)).toEqual({ no: 1, goal: 3, moveLimit: 42, obstacles: 0 });
    // goal = 3 + floor(10 × 0.25) = 5、1 本あたり 14 − 0.05 × 10 = 13.5 → ceil(67.5) = 68、欠片 floor(10 × 0.3) = 3
    expect(levelParams(L, 11)).toEqual({ no: 11, goal: 5, moveLimit: 68, obstacles: 3 });
    // 上限に張り付く
    expect(levelParams(L, 200)).toEqual({ no: 200, goal: 15, moveLimit: 105, obstacles: 18 });
  });

  it("レベルとともに目標と欠片は増え、1 列あたりのトレイは減る", () => {
    for (let n = 2; n <= 200; n++) {
      const a = levelParams(L, n - 1);
      const b = levelParams(L, n);
      expect(b.goal).toBeGreaterThanOrEqual(a.goal);
      expect(b.obstacles).toBeGreaterThanOrEqual(a.obstacles);
    }
  });

  it("0 や小数のレベル番号は 1 以上の整数に丸める", () => {
    expect(levelParams(L, 0).no).toBe(1);
    expect(levelParams(L, 3.7).no).toBe(3);
  });
});

describe("newLevelGame", () => {
  it("決定的で、欠片の数が式どおり、満杯の行・列を作らない", () => {
    for (const n of [1, 11, 60, 200]) {
      const a = newLevelGame(config, n, 0, 2);
      const b = newLevelGame(config, n, 999, 2);
      expect(serialize({ ...a, startedAt: 0 })).toBe(serialize({ ...b, startedAt: 0 }));
      const obstacles = [...a.board].filter((c) => c === OBSTACLE).length;
      expect(obstacles).toBe(levelParams(L, n).obstacles);
      for (let i = 0; i < a.size; i++) {
        let row = 0;
        let col = 0;
        for (let j = 0; j < a.size; j++) {
          if (a.board[i * a.size + j] !== 0) row++;
          if (a.board[j * a.size + i] !== 0) col++;
        }
        expect(row).toBeLessThan(a.size);
        expect(col).toBeLessThan(a.size);
      }
      expect(a.status).toBe("playing");
      expect(a.level).toEqual({
        no: n,
        goal: levelParams(L, n).goal,
        moveLimit: levelParams(L, n).moveLimit,
      });
    }
  });

  it("variant が違えば面も違う", () => {
    const a = newLevelGame(config, 30, 0, 0);
    const b = newLevelGame(config, 30, 0, 1);
    expect(a.seed).toBe("level:30");
    expect(b.seed).toBe("level:30:1");
    expect(serialize(a)).not.toBe(serialize(b));
  });
});

/** 状態を差し替えたレベルのゲーム(遷移の検査用)。 */
function withBoard(base: GameState, cells: number[], patch: Partial<GameState>): GameState {
  const board = new Uint8Array(base.size * base.size);
  for (const i of cells) board[i] = 2;
  return { ...base, board, ...patch };
}

describe("クリアとトレイ切れ(docs/09 §1)", () => {
  const base = newLevelGame(config, 1, 0, 0);
  const rowAlmost = Array.from({ length: 9 }, (_, x) => 90 + x); // 下段の 0〜8 列

  it("目標に達した手でクリアになる", () => {
    const s = withBoard(base, rowAlmost, { linesCleared: 2 });
    const { state, result } = place(s, config, 9, 9);
    expect(result.ok).toBe(true);
    expect(result.levelCleared).toBe(true);
    expect(state.status).toBe("cleared");
    expect(state.linesCleared).toBe(3);
    // それ以上は置けない
    expect(place(state, config, 0, 0).result.ok).toBe(false);
  });

  it("最後の 1 手で届けばクリア(手数切れより優先)", () => {
    const limit = base.level?.moveLimit ?? 42;
    const s = withBoard(base, rowAlmost, { linesCleared: 2, moves: limit - 1 });
    const { state, result } = place(s, config, 9, 9);
    expect(result.levelCleared).toBe(true);
    expect(result.outOfMoves).toBe(false);
    expect(state.status).toBe("cleared");
  });

  it("手数を使い切って届かなければ失敗", () => {
    const limit = base.level?.moveLimit ?? 42;
    const s = withBoard(base, [], { moves: limit - 1 });
    const { state, result } = place(s, config, 0, 0);
    expect(result.outOfMoves).toBe(true);
    expect(result.gameOver).toBe(true);
    expect(state.status).toBe("over");
    expect(movesLeft(state)).toBe(0);
  });

  it("手数が残っていれば続く", () => {
    const s = withBoard(base, [], { moves: 0 });
    const { state, result } = place(s, config, 0, 0);
    expect(result.gameOver).toBe(false);
    expect(state.moves).toBe(1);
    expect(movesLeft(state)).toBe((base.level?.moveLimit ?? 42) - 1);
  });

  it("エンドレスの place 結果にはレベルの項目を付けない(保存形式・golden を変えない)", () => {
    const endless = { ...base, mode: "endless" as const, level: undefined };
    delete (endless as { level?: unknown }).level;
    const { result } = place(endless, config, 0, 0);
    expect(result).not.toHaveProperty("levelCleared");
    expect(Object.keys(JSON.parse(serialize(endless)) as object)).not.toContain("level");
  });
});

describe("starsFor", () => {
  const limit = 10;
  const cleared = (moves: number): GameState => ({
    ...newLevelGame(config, 1, 0, 0),
    status: "cleared",
    moves,
    level: { no: 1, goal: 3, moveLimit: limit },
  });
  it.each([
    [1, 3],
    [6, 3], // ceil(10 × 0.6) = 6
    [7, 2],
    [8, 2], // ceil(10 × 0.8) = 8
    [9, 1],
    [10, 1],
  ])("%i 手でクリア → ★%i", (moves, stars) => {
    expect(starsFor(cleared(moves), L)).toBe(stars);
  });
  it("クリアしていなければ 0", () => {
    expect(starsFor(newLevelGame(config, 1, 0, 0), L)).toBe(0);
  });
});

describe("保存形式", () => {
  it("レベルの状態(欠片・目標)は往復で保たれる", () => {
    const s = newLevelGame(config, 42, 5, 3);
    const back = deserialize(serialize(s));
    expect(back).toEqual(s);
  });
  it("cleared はレベルのときだけ有効。level 無しの level モードは壊れた扱い", () => {
    const s = JSON.parse(serialize(newLevelGame(config, 1, 0, 0))) as Record<string, unknown>;
    expect(deserialize(JSON.stringify({ ...s, status: "cleared" }))).not.toBeNull();
    expect(
      deserialize(JSON.stringify({ ...s, mode: "endless", status: "cleared", level: undefined })),
    ).toBeNull();
    expect(deserialize(JSON.stringify({ ...s, level: undefined }))).toBeNull();
    expect(
      deserialize(JSON.stringify({ ...s, level: { no: 0, goal: 3, moveLimit: 6 } })),
    ).toBeNull();
  });
});

describe("面の表(docs/09 §4)", () => {
  it("同梱の表は今の config のハッシュと一致し、200 面すべてに解ける候補がある", () => {
    expect(LEVELS_TABLE.configHash).toBe(levelsConfigHash(config));
    expect(LEVELS_TABLE.variants).toHaveLength(200);
    expect(LEVELS_TABLE.variants.every((v) => v >= 0)).toBe(true);
  });

  it("levelVariant は表の外と -1 を 0 にする", () => {
    const table = { schemaVersion: 1 as const, configHash: "", variants: [3, -1] };
    expect(levelVariant(table, 1)).toBe(3);
    expect(levelVariant(table, 2)).toBe(0);
    expect(levelVariant(table, 999)).toBe(0);
  });

  it("ハッシュはキーの順序に依存せず、面に効く値が変われば変わる", () => {
    const reordered = JSON.parse(JSON.stringify(config)) as ResolvedConfig;
    const levels = { ...reordered.levels };
    const shuffled = Object.fromEntries(
      Object.entries(levels).reverse(),
    ) as unknown as ResolvedConfig["levels"];
    expect(levelsConfigHash({ ...reordered, levels: shuffled })).toBe(levelsConfigHash(config));
    expect(levelsConfigHash({ ...config, levels: { ...L, goalMax: 16 } })).not.toBe(
      levelsConfigHash(config),
    );
    // 面に関係しない値(演出)は無関係
    expect(levelsConfigHash({ ...config, fx: { ...config.fx, clearDurationMs: 1 } })).toBe(
      levelsConfigHash(config),
    );
  });

  it("config を変えて表を作り直さないと validate:config が止める", () => {
    const dir = mkdtempSync(join(tmpdir(), "hamaru-levels-"));
    const cfg = JSON.parse(readFileSync(join(repoRoot, "src/config/game-config.json"), "utf8"));
    cfg.levels.goalMax = 16;
    const path = join(dir, "game-config.json");
    writeFileSync(path, JSON.stringify(cfg));
    let code = 0;
    let out = "";
    try {
      execFileSync(
        "npx",
        ["tsx", "scripts/validate-config.ts", path, "src/config/experiments.json"],
        {
          cwd: repoRoot,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
    } catch (e) {
      const err = e as { status?: number; stderr?: string };
      code = err.status ?? 1;
      out = err.stderr ?? "";
    }
    expect(code).toBe(1);
    expect(out).toContain("npm run levels:table");
  }, 60_000);
});

describe("進捗の保存", () => {
  it("星と得点は最高を残し、解放はクリア済みの次まで", () => {
    resetBackend();
    expect(unlockedLevel({})).toBe(1);
    saveLevelResult(1, { stars: 2, score: 100 });
    saveLevelResult(1, { stars: 1, score: 300 });
    const p = saveLevelResult(2, { stars: 3, score: 50 });
    expect(p[1]).toEqual({ stars: 2, score: 300 });
    expect(unlockedLevel(p)).toBe(3);
    expect(totalStars(p)).toBe(5);
  });

  it("欠片のセルにはかけらを置けない", () => {
    const s = newLevelGame(config, 40, 0, 0);
    const i = [...s.board].findIndex((c) => c === OBSTACLE);
    expect(i).toBeGreaterThanOrEqual(0);
    expect(place(s, config, i % s.size, Math.floor(i / s.size)).result.ok).toBe(false);
  });
});
