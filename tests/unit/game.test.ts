/**
 * 逆手の 1 ゲーム(docs/01 §5)。
 *
 * ここが「ルールの正本」。乱数は**始めの盤を作るときだけ**で、
 * 供給(次に何が来るか)には運が無い、という性質を厚く固める。
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../../src/config";
import { canPlace, createBoard, isBoardEmpty } from "../../src/core/board";
import { pieceSizeFor } from "../../src/core/derive";
import {
  deserialize,
  newGame,
  nextPieceSize,
  place,
  seedPiece,
  serialize,
  startBoard,
} from "../../src/core/game";
import { makePiece } from "../../src/core/piece";
import type { GameState, ResolvedConfig } from "../../src/core/types";

const config = DEFAULT_CONFIG;
const SIZE = config.board.size;

/** 盤を差し替えたゲーム(遷移の検査用)。 */
function withBoard(
  base: GameState,
  filled: Array<[number, number]>,
  patch: Partial<GameState> = {},
) {
  const board = createBoard(base.size);
  for (const [x, y] of filled) board[y * base.size + x] = 2;
  return { ...base, board, ...patch } as GameState;
}

const emptyGame = (patch: Partial<GameState> = {}): GameState =>
  withBoard(newGame(config, "endless", "test", 0), [], patch);

describe("newGame", () => {
  it("初期状態が契約どおり", () => {
    const s = newGame(config, "endless", "seed-a", 1234);
    expect(s.version).toBe(2);
    expect(s.mode).toBe("endless");
    expect(s.size).toBe(SIZE);
    expect(s.board).toHaveLength(SIZE * SIZE);
    expect(s.piece.cells).toEqual([[0, 0]]); // 最初は必ず 1 マス
    expect(s.heat).toBe(0);
    expect(s.score).toBe(0);
    expect(s.moves).toBe(0);
    expect(s.status).toBe("playing");
    expect(s.startedAt).toBe(1234);
  });

  it("始めの盤はシードで決まる(同じシードなら同じ、違えば違う)", () => {
    const a = newGame(config, "endless", "seed-a", 0);
    const b = newGame(config, "endless", "seed-a", 0);
    const c = newGame(config, "endless", "seed-b", 0);
    expect([...a.board]).toEqual([...b.board]);
    expect([...a.board]).not.toEqual([...c.board]);
  });

  it("始めのタイル数は config どおりで、いきなり消える行・列は作らない", () => {
    for (const seed of ["a", "b", "c", "d", "e"]) {
      const board = startBoard(config, seed);
      expect([...board].filter((c) => c !== 0)).toHaveLength(config.sakate.startTiles);
      for (let i = 0; i < SIZE; i++) {
        let row = 0;
        let col = 0;
        for (let j = 0; j < SIZE; j++) {
          if (board[i * SIZE + j] !== 0) row++;
          if (board[j * SIZE + i] !== 0) col++;
        }
        expect(row).toBeLessThan(SIZE);
        expect(col).toBeLessThan(SIZE);
      }
    }
  });
});

describe("place", () => {
  it("入力の state と board を変更しない(純粋性)", () => {
    const s = emptyGame();
    const before = [...s.board];
    const { state: next } = place(s, config, 3, 3);
    expect([...s.board]).toEqual(before);
    expect(next).not.toBe(s);
  });

  it("置けない場所・終了後は ok:false で state は同一参照", () => {
    const s = withBoard(emptyGame(), [[0, 0]]);
    expect(place(s, config, 0, 0).result.ok).toBe(false);
    expect(place(s, config, 0, 0).state).toBe(s);
    expect(place(s, config, -1, 0).result.ok).toBe(false);
    expect(place(s, config, 1.5, 0).result.ok).toBe(false);
    const over = { ...s, status: "over" as const };
    expect(place(over, config, 5, 5).result.ok).toBe(false);
  });

  it("置くと得点が増え、手数が 1 つ進む", () => {
    const s = emptyGame();
    const { state, result } = place(s, config, 4, 4);
    expect(result.ok).toBe(true);
    expect(state.moves).toBe(1);
    expect(state.score).toBeGreaterThanOrEqual(config.scoring.perCell);
    expect(result.scoreDelta).toBe(state.score);
  });

  it("1 行そろうと消える", () => {
    const row = Array.from({ length: SIZE - 1 }, (_, x): [number, number] => [x, 9]);
    const s = withBoard(emptyGame(), row);
    const { state, result } = place(s, config, SIZE - 1, 9);
    expect(result.clearedRows).toEqual([9]);
    expect(result.clearedCells).toHaveLength(SIZE);
    expect(state.linesCleared).toBe(1);
    expect(isBoardEmpty(state.board)).toBe(true);
    expect(result.boardCleared).toBe(true);
    expect(state.score).toBeGreaterThan(config.scoring.lineBase);
  });
});

describe("熱(docs/01 §5.3)", () => {
  it("消さない手ごとに熱が上がり、かけらが育つ", () => {
    let s = emptyGame();
    const sizes: number[] = [];
    for (let i = 0; i < 8; i++) {
      const spot = i * 2;
      const { state } = place(s, config, spot % SIZE, Math.floor(spot / SIZE) * 2);
      s = state;
      sizes.push(s.piece.cells.length);
      expect(s.heat).toBe(i + 1);
    }
    // 単調に大きくなり、上限を超えない
    expect(sizes[sizes.length - 1]).toBeGreaterThan(sizes[0] as number);
    for (const size of sizes) expect(size).toBeLessThanOrEqual(config.sakate.maxPiece);
  });

  it("消すと熱が 0 に戻り、次のかけらは 1 マスになる", () => {
    const row = Array.from({ length: SIZE - 1 }, (_, x): [number, number] => [x, 9]);
    const s = withBoard(emptyGame(), row, { heat: 7 });
    const { state, result } = place(s, config, SIZE - 1, 9);
    expect(result.heatAfter).toBe(0);
    expect(state.heat).toBe(0);
    expect(state.piece.cells).toHaveLength(1);
    expect(result.nextPiece.cells).toHaveLength(1);
  });

  it("nextPieceSize は熱と config から決まる", () => {
    const s = emptyGame({ heat: 5 });
    expect(nextPieceSize(s, config)).toBe(pieceSizeFor(5, config.sakate));
  });
});

describe("次のかけら(逆手の核)", () => {
  it("置いた場所のまわりのタイルから作られる", () => {
    // (3,4) と (3,5) にタイル。その隣の (4,5) に 1 マス置く
    const s = withBoard(
      emptyGame(),
      [
        [3, 4],
        [3, 5],
      ],
      { heat: 1 }, // 置くと熱 2 → かけらは 2 マス
    );
    const { state } = place(s, config, 4, 5);
    // 縦に 2 つ並んだ形(熱 3 → 2 マス)が返る
    expect(state.piece.cells).toEqual([
      [0, 0],
      [0, 1],
    ]);
  });

  it("同じ盤・同じ手順なら、最後まで同じゲームになる(乱数ゼロ)", () => {
    const moves: Array<[number, number]> = [
      [0, 0],
      [2, 0],
      [4, 0],
      [6, 0],
      [8, 0],
      [0, 2],
    ];
    const run = (): GameState => {
      let s = newGame(config, "daily", "daily:2026-10-01", 0);
      for (const [x, y] of moves) {
        if (!canPlace(s.board, s.size, s.piece, x, y)) continue;
        s = place(s, config, x, y).state;
      }
      return s;
    };
    expect(serialize(run())).toBe(serialize(run()));
  });
});

describe("ゲームオーバー", () => {
  it("次のかけらがどこにも置けなければ終わり", () => {
    // 空きが「飛び飛びの 1 マス」だけの盤。どの行・列も満杯にならないので消えない。
    const filled: Array<[number, number]> = [];
    const isEmpty = (x: number, y: number): boolean => x === y || x === (y + 5) % SIZE;
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        if (!isEmpty(x, y)) filled.push([x, y]);
      }
    }
    const s = withBoard(emptyGame(), filled, { heat: 2 }); // 置くと熱 3 → 2 マス
    const { state, result } = place(s, config, 5, 5);
    expect(result.ok).toBe(true);
    expect(result.clearedRows).toEqual([]);
    expect(result.nextPiece.cells.length).toBeGreaterThan(1);
    expect(result.gameOver).toBe(true);
    expect(state.status).toBe("over");
  });
});

describe("保存形式", () => {
  it("往復で同じ状態に戻る", () => {
    let s = newGame(config, "daily", "daily:2026-10-02", 999);
    s = place(s, config, 1, 1).state;
    s = place(s, config, 5, 5).state;
    const back = deserialize(serialize(s));
    expect(back).toEqual(s);
  });

  it("壊れた入力は null", () => {
    const valid = JSON.parse(serialize(newGame(config, "endless", "x", 0))) as Record<
      string,
      unknown
    >;
    expect(deserialize("not json")).toBeNull();
    expect(deserialize("[]")).toBeNull();
    expect(deserialize(JSON.stringify({ ...valid, version: 1 }))).toBeNull();
    expect(deserialize(JSON.stringify({ ...valid, mode: "zzz" }))).toBeNull();
    expect(deserialize(JSON.stringify({ ...valid, size: 99 }))).toBeNull();
    expect(deserialize(JSON.stringify({ ...valid, board: "###" }))).toBeNull();
    expect(deserialize(JSON.stringify({ ...valid, piece: { cells: [], color: 1 } }))).toBeNull();
    expect(
      deserialize(JSON.stringify({ ...valid, piece: { cells: [[0, 0]], color: 9 } })),
    ).toBeNull();
    // level なしの cleared / level モードは壊れた保存
    expect(deserialize(JSON.stringify({ ...valid, status: "cleared" }))).toBeNull();
    expect(deserialize(JSON.stringify({ ...valid, mode: "level" }))).toBeNull();
  });

  it("かけらは正規化して読む", () => {
    const valid = JSON.parse(serialize(newGame(config, "endless", "x", 0))) as Record<
      string,
      unknown
    >;
    const shifted = deserialize(
      JSON.stringify({
        ...valid,
        piece: {
          cells: [
            [4, 4],
            [5, 4],
          ],
          color: 3,
        },
      }),
    );
    expect(shifted?.piece).toEqual(
      makePiece(
        [
          [0, 0],
          [1, 0],
        ],
        3,
      ),
    );
  });
});

describe("seedPiece", () => {
  it("常に 1 マス(どこにでも置ける)", () => {
    expect(seedPiece().cells).toEqual([[0, 0]]);
  });
});

describe("config の型", () => {
  it("ResolvedConfig は sakate を持つ", () => {
    const cfg: ResolvedConfig = config;
    expect(cfg.sakate.maxPiece).toBeGreaterThanOrEqual(1);
    expect(cfg.sakate.growEvery).toBeGreaterThanOrEqual(1);
  });
});
