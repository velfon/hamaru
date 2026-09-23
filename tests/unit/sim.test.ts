import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../../src/config";
import { canPlace, createBoard, validPositions } from "../../src/core/board";
import { newGame, place } from "../../src/core/game";
import { createRng } from "../../src/core/rng";
import { greedyBot, simulate, valueOf } from "../../sim/bots/greedy";
import { lookaheadBot } from "../../sim/bots/lookahead";
import { randomBot } from "../../sim/bots/random";
import type { Bot } from "../../sim/bots/types";
import { countFilled, evaluateMove } from "../../sim/evaluate";
import {
  BAND,
  buildBotReport,
  checkAgainstBaseline,
  variantCheckOk,
  describe as describeDist,
  median,
  percentile,
  type GameOutcome,
  type SimReport,
} from "../../sim/report";
import { applyVariant, parseArgs, playGame } from "../../sim/run";

const CONFIG = DEFAULT_CONFIG;
const BOTS: Bot[] = [randomBot, greedyBot, lookaheadBot];

describe("sim / report の統計", () => {
  it("median は偶数長で中央 2 値の平均", () => {
    expect(median([1, 2, 3])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([])).toBe(0);
  });

  it("percentile は下側の順序統計量", () => {
    const v = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(v, 0.1)).toBe(10);
    expect(percentile(v, 0.9)).toBe(90);
    expect(percentile(v, 0)).toBe(1);
    expect(percentile(v, 1)).toBe(100);
    expect(percentile([], 0.5)).toBe(0);
  });

  it("describe は mean / median / p10 / p90 / min / max を返す", () => {
    const d = describeDist([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(d.mean).toBe(5.5);
    expect(d.median).toBe(5.5);
    expect(d.p10).toBe(1);
    expect(d.p90).toBe(9);
    expect(d.min).toBe(1);
    expect(d.max).toBe(10);
    expect(describeDist([])).toEqual({ mean: 0, median: 0, p10: 0, p90: 0, min: 0, max: 0 });
  });

  it("buildBotReport は率を 0〜1 で出す", () => {
    const outcomes: GameOutcome[] = [
      { moves: 10, score: 100, lines: 2, heat: 4, gameOverAtMove1: false, boardClear: true },
      { moves: 20, score: 200, lines: 4, heat: 8, gameOverAtMove1: true, boardClear: false },
    ];
    const r = buildBotReport("x", outcomes, 123);
    expect(r.games).toBe(2);
    expect(r.gameOverAtMove1).toBe(0.5);
    expect(r.boardClear).toBe(0.5);
    expect(r.moves.median).toBe(15);
    expect(r.elapsedMs).toBe(123);
    expect(buildBotReport("x", [], 0).gameOverAtMove1).toBe(0);
  });
});

describe("sim / 帯域判定", () => {
  const report = (moves: number, score: number, overAtR1 = 0): SimReport => ({
    generatedFrom: { config: "c", variant: null, seed: 1, games: 10 },
    totalElapsedMs: 0,
    bots: {
      random: buildBotReport(
        "random",
        [
          {
            moves,
            score,
            lines: 0,
            heat: 1,
            gameOverAtMove1: overAtR1 > 0,
            boardClear: false,
          },
        ],
        0,
      ),
      greedy: buildBotReport(
        "greedy",
        [{ moves, score, lines: 0, heat: 1, gameOverAtMove1: false, boardClear: false }],
        0,
      ),
      lookahead: buildBotReport(
        "lookahead",
        [{ moves, score, lines: 0, heat: 1, gameOverAtMove1: false, boardClear: false }],
        0,
      ),
    },
  });

  it("baseline と同じなら帯域内", () => {
    const r = checkAgainstBaseline(report(100, 1000), report(100, 1000));
    expect(r.ok).toBe(true);
    expect(r.bands).toHaveLength(4);
    expect(r.skipped).toEqual([]);
  });

  it("±30 % の境界", () => {
    expect(BAND).toBe(0.3);
    expect(checkAgainstBaseline(report(130, 1300), report(100, 1000)).ok).toBe(true);
    expect(checkAgainstBaseline(report(70, 700), report(100, 1000)).ok).toBe(true);
    expect(checkAgainstBaseline(report(131, 1000), report(100, 1000)).ok).toBe(false);
    expect(checkAgainstBaseline(report(69, 1000), report(100, 1000)).ok).toBe(false);
  });

  it("random.median_moves が baseline の 50 % 未満なら fatal", () => {
    const r = checkAgainstBaseline(report(40, 1000), report(100, 1000));
    expect(r.ok).toBe(false);
    expect(r.bands.find((b) => b.metric === "random.median_moves")?.fatal).toBe(true);
  });

  it("gameOverAtMove1 != 0 は帯域内でも失敗", () => {
    const r = checkAgainstBaseline(report(100, 1000, 1), report(100, 1000));
    expect(r.ok).toBe(false);
    expect(r.gameOverViolations).toEqual(["random"]);
  });

  it("variant は帯域外でもよいが、50 % 未満の破壊と初手詰みは落とす", () => {
    const outOfBand = checkAgainstBaseline(report(69, 1000), report(100, 1000));
    expect(outOfBand.ok).toBe(false);
    expect(variantCheckOk(outOfBand)).toBe(true);

    const broken = checkAgainstBaseline(report(40, 1000), report(100, 1000));
    expect(variantCheckOk(broken)).toBe(false);

    const deadFirstMove = checkAgainstBaseline(report(100, 1000, 1), report(100, 1000));
    expect(variantCheckOk(deadFirstMove)).toBe(false);
  });

  it("baseline に無いボットは skip する", () => {
    const partial = report(100, 1000);
    delete partial.bots["lookahead"];
    const r = checkAgainstBaseline(partial, partial);
    expect(r.skipped).toEqual(["lookahead.median_moves"]);
    expect(r.ok).toBe(true);
  });
});

describe("sim / parseArgs", () => {
  it("既定値", () => {
    expect(parseArgs([])).toEqual({
      games: 2000,
      bots: ["random", "greedy", "lookahead"],
      seed: 1,
      configPath: "src/config/game-config.json",
      variant: null,
      check: false,
      writeBaseline: false,
    });
  });

  it("docs/06 §4 の呼び出し形式を解釈する", () => {
    const o = parseArgs([
      "--games",
      "2000",
      "--bots",
      "random,greedy",
      "--seed",
      "42",
      "--config",
      "other.json",
      "--variant",
      "treatment",
      "--check",
    ]);
    expect(o.games).toBe(2000);
    expect(o.bots).toEqual(["random", "greedy"]);
    expect(o.seed).toBe(42);
    expect(o.configPath).toBe("other.json");
    expect(o.variant).toBe("treatment");
    expect(o.check).toBe(true);
  });

  it("不正な引数は例外", () => {
    expect(() => parseArgs(["--nope"])).toThrow();
    expect(() => parseArgs(["--games"])).toThrow();
    expect(() => parseArgs(["--games", "0"])).toThrow();
    expect(() => parseArgs(["--games", "1.5"])).toThrow();
    expect(() => parseArgs(["--seed", "x"])).toThrow();
    expect(() => parseArgs(["--bots", "cheater"])).toThrow();
  });

  it("running 実験が無い状態で --variant を使うと例外", () => {
    expect(() => applyVariant(CONFIG, "treatment")).toThrow();
    expect(applyVariant(CONFIG, null)).toBe(CONFIG);
  });
});

describe("sim / evaluate", () => {
  it("評価は盤を変更しない", () => {
    const board = createBoard(10);
    const before = Array.from(board);
    const piece = {
      cells: [
        [0, 0],
        [1, 0],
        [0, 1],
        [1, 1],
      ] as const,
      color: 2 as const,
    };
    evaluateMove(board, 10, piece, 3, 3, CONFIG.scoring, 0, 0);
    expect(Array.from(board)).toEqual(before);
  });

  it("core の place と同じ得点・消去数になる", () => {
    let state = newGame(CONFIG, "endless", "evaluate-parity", 0);
    for (let m = 0; m < 60 && state.status === "playing"; m++) {
      const positions = validPositions(state.board, state.size, state.piece);
      const target = positions[m % Math.max(positions.length, 1)];
      if (target === undefined) break;

      const predicted = evaluateMove(
        state.board,
        state.size,
        state.piece,
        target[0],
        target[1],
        CONFIG.scoring,
        state.streak,
        countFilled(state.board),
      );
      const { state: next, result } = place(state, CONFIG, target[0], target[1]);
      expect(result.ok).toBe(true);
      expect(predicted.score).toBe(result.scoreDelta);
      expect(predicted.lines).toBe(result.clearedRows.length + result.clearedCols.length);
      expect(predicted.boardCleared).toBe(result.boardCleared);
      state = next;
    }
    expect(state.moves).toBeGreaterThan(5);
  });

  it("countFilled", () => {
    const board = createBoard(10);
    expect(countFilled(board)).toBe(0);
    board[5] = 3;
    board[9] = 1;
    expect(countFilled(board)).toBe(2);
  });
});

describe("sim / bots", () => {
  it("simulate は core と同じ結果になる(盤・消えた本数・次のかけら)", () => {
    const state = newGame(CONFIG, "endless", "sim-parity", 0);
    const [x, y] = validPositions(state.board, state.size, state.piece)[0] as [number, number];
    const simulated = simulate(state, CONFIG, x, y);
    const { state: next, result } = place(state, CONFIG, x, y);
    expect(Array.from(simulated.board)).toEqual(Array.from(next.board));
    expect(simulated.lines).toBe(result.clearedRows.length + result.clearedCols.length);
    expect(simulated.next).toEqual(next.piece);
    expect(simulated.heat).toBe(next.heat);
  });

  it("valueOf は消せる手を高く評価する", () => {
    const state = newGame(CONFIG, "endless", "value", 0);
    const spots = validPositions(state.board, state.size, state.piece);
    const values = spots.map(([x, y]) => valueOf(state, CONFIG, x, y));
    expect(values.every((v) => Number.isFinite(v.value))).toBe(true);
  });

  it.each(BOTS)("$name は常に合法手を返す", (bot) => {
    let state = newGame(CONFIG, "endless", "legal-moves", 0);
    const rng = createRng("legal-moves");
    let moves = 0;
    while (state.status === "playing" && moves < 200) {
      const move = bot.chooseMove(state, CONFIG, rng);
      if (move === null) break;
      expect(
        canPlace(state.board, state.size, state.piece, move.x, move.y),
        `${bot.name}: 置けない手を返した`,
      ).toBe(true);
      state = place(state, CONFIG, move.x, move.y).state;
      moves++;
    }
    expect(moves).toBeGreaterThan(5);
  });

  it.each(BOTS)("$name は同じシードで同じ結果(決定的)", (bot) => {
    const a = playGame(bot, CONFIG, "sim:1:0");
    const b = playGame(bot, CONFIG, "sim:1:0");
    expect(a).toEqual(b);
  });

  it("中央値スコアの順位が random < greedy < lookahead(docs/07 M2 受け入れ)", () => {
    // 逆手は上手いボットほどゲームが長い(先読みは中央 370 手)。本数は少なくてよい。
    const games = 8;
    const scoreOf = (bot: Bot): number => {
      const scores: number[] = [];
      for (let i = 0; i < games; i++) scores.push(playGame(bot, CONFIG, `sim:99:${i}`).score);
      scores.sort((x, y) => x - y);
      return scores[Math.floor(scores.length / 2)] as number;
    };
    const random = scoreOf(randomBot);
    const greedy = scoreOf(greedyBot);
    const lookahead = scoreOf(lookaheadBot);
    expect(greedy, `random ${random} / greedy ${greedy}`).toBeGreaterThan(random);
    expect(lookahead, `greedy ${greedy} / lookahead ${lookahead}`).toBeGreaterThan(greedy);
  }, 120_000);

  it("random は初手ゲームオーバーを起こさない(最初のかけらは必ず 1 マス)", () => {
    for (let i = 0; i < 200; i++) {
      expect(playGame(randomBot, CONFIG, `sim:1:${i}`).gameOverAtMove1).toBe(false);
    }
  });
});
