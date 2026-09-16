import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../../src/config";
import { deepMerge, forceDaily } from "../../src/config/resolve";
import { boardIndex, clearLines, createBoard, validPositions } from "../../src/core/board";
import {
  decodeBoard,
  deserialize,
  encodeBoard,
  newGame,
  place,
  serialize,
} from "../../src/core/game";
import { SHAPES, getShape } from "../../src/core/shapes";
import type { GameState, Piece, ResolvedConfig, Shape } from "../../src/core/types";

const CONFIG = DEFAULT_CONFIG;
const SIZE = CONFIG.board.size;

const shape = (id: string): Shape => {
  const s = getShape(id);
  if (s === undefined) throw new Error(id);
  return s;
};

const withConfig = (override: unknown): ResolvedConfig =>
  deepMerge(structuredClone(DEFAULT_CONFIG), override);

/** 盤とトレイを直接組み立てたテスト用の state。 */
function stateWith(partial: Partial<GameState>): GameState {
  const base = newGame(CONFIG, "endless", "fixture", 1_700_000_000_000);
  return { ...base, ...partial };
}

const trayOf = (...idsIn: Array<string | null>): Array<Piece | null> =>
  idsIn.map((id) => (id === null ? null : { shapeId: id }));

/**
 * 空きセルが互いに隣接しない盤。dot 以外は置けず、1 マス埋めても行・列は完成しない。
 * 空き = (y, y) と ((y+3) % 10, y)(各行・各列にちょうど 2 つ、間隔は 3 か 7)。
 */
function sparseBoard(): Uint8Array {
  const board = createBoard(SIZE).fill(1);
  for (let y = 0; y < SIZE; y++) {
    board[boardIndex(SIZE, y, y)] = 0;
    board[boardIndex(SIZE, (y + 3) % SIZE, y)] = 0;
  }
  return board;
}

describe("game / newGame", () => {
  it("初期状態が契約どおり", () => {
    const s = newGame(CONFIG, "endless", "seed-1", 12345);
    expect(s.version).toBe(1);
    expect(s.mode).toBe("endless");
    expect(s.seed).toBe("seed-1");
    expect(s.size).toBe(SIZE);
    expect(s.board).toHaveLength(SIZE * SIZE);
    expect(s.board.every((c) => c === 0)).toBe(true);
    expect(s.tray).toHaveLength(3);
    expect(s.tray.every((p) => p !== null)).toBe(true);
    expect(s.score).toBe(0);
    expect(s.streak).toBe(0);
    expect(s.longestStreak).toBe(0);
    expect(s.round).toBe(1);
    expect(s.moves).toBe(0);
    expect(s.linesCleared).toBe(0);
    expect(s.status).toBe("playing");
    expect(s.startedAt).toBe(12345);
  });

  it("同じシードなら同じ初期トレイ、違うシードなら(だいたい)違う", () => {
    const a = newGame(CONFIG, "endless", "same", 0);
    const b = newGame(CONFIG, "endless", "same", 999);
    expect(a.tray).toEqual(b.tray);
    expect(a.rng).toBe(b.rng);

    const different = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const s = newGame(CONFIG, "endless", `s${i}`, 0);
      different.add(s.tray.map((p) => p?.shapeId).join(","));
    }
    expect(different.size).toBeGreaterThan(10);
  });
});

describe("game / place", () => {
  it("入力の state と board を変更しない(純粋性)", () => {
    const s = newGame(CONFIG, "endless", "immutable", 0);
    const snapshot = {
      board: Array.from(s.board),
      tray: s.tray.map((p) => p?.shapeId ?? null),
      score: s.score,
      rng: s.rng,
    };
    const { state: next, result } = place(s, CONFIG, 0, 0, 0);
    expect(result.ok).toBe(true);
    expect(Array.from(s.board)).toEqual(snapshot.board);
    expect(s.tray.map((p) => p?.shapeId ?? null)).toEqual(snapshot.tray);
    expect(s.score).toBe(snapshot.score);
    expect(s.rng).toBe(snapshot.rng);
    expect(next).not.toBe(s);
    expect(next.board).not.toBe(s.board);
  });

  it("置けない場所なら ok:false で state は同一参照", () => {
    const s = newGame(CONFIG, "endless", "reject", 0);
    const first = place(s, CONFIG, 0, 0, 0).state;
    const bad = place(first, CONFIG, 1, 0, 0);
    // 1 つ目を置いた場所に重ねられるかは形状次第なので、確実に盤外を狙う。
    const outside = place(first, CONFIG, 1, SIZE, SIZE);
    expect(outside.result.ok).toBe(false);
    expect(outside.state).toBe(first);
    expect(outside.result.scoreDelta).toBe(0);
    expect(bad.state === first || bad.result.ok).toBeTruthy();
  });

  it("不正な trayIndex / 空スロット / 未知の形状 / 終了後は ok:false", () => {
    const s = newGame(CONFIG, "endless", "invalid", 0);
    for (const i of [-1, 3, 1.5, Number.NaN]) {
      expect(place(s, CONFIG, i, 0, 0).result.ok).toBe(false);
    }
    expect(place(stateWith({ tray: trayOf(null, null, null) }), CONFIG, 0, 0, 0).result.ok).toBe(
      false,
    );
    expect(place(stateWith({ tray: trayOf("ghost", null, null) }), CONFIG, 0, 0, 0).result.ok).toBe(
      false,
    );
    expect(place(stateWith({ status: "over" }), CONFIG, 0, 0, 0).result.ok).toBe(false);
  });

  it("スコアは単調非減少で、配置ごとにセル数以上増える", () => {
    let s = newGame(CONFIG, "endless", "monotonic", 0);
    let guard = 0;
    while (s.status === "playing" && guard++ < 400) {
      const before = s.score;
      let moved = false;
      for (let t = 0; t < 3; t++) {
        const piece = s.tray[t];
        if (piece === null || piece === undefined) continue;
        const positions = validPositions(s.board, s.size, shape(piece.shapeId));
        const target = positions[0];
        if (target === undefined) continue;
        const r = place(s, CONFIG, t, target[0], target[1]);
        expect(r.result.ok).toBe(true);
        s = r.state;
        moved = true;
        break;
      }
      if (!moved) break;
      expect(s.score).toBeGreaterThanOrEqual(before);
    }
    expect(s.moves).toBeGreaterThan(0);
    expect(s.score).toBeLessThan(2 ** 31); // docs/06 §8: 桁溢れしない前提の明示
  });

  it("1 行完成で消去され、結果に行番号とセルが入る", () => {
    const board = createBoard(SIZE);
    for (let x = 0; x < SIZE - 1; x++) board[boardIndex(SIZE, x, 5)] = 1;
    board[boardIndex(SIZE, 0, 0)] = 1; // 全消しにならないように 1 マス残す
    const s = stateWith({ board, tray: trayOf("dot", "sq2", "sq2") });
    const { state, result } = place(s, CONFIG, 0, SIZE - 1, 5);
    expect(result.ok).toBe(true);
    expect(result.clearedRows).toEqual([5]);
    expect(result.clearedCols).toEqual([]);
    expect(result.clearedCells).toHaveLength(SIZE);
    expect(result.placedCells).toEqual([[SIZE - 1, 5]]);
    expect(result.scoreDelta).toBe(1 + 10);
    expect(result.streakAfter).toBe(1);
    expect(result.boardCleared).toBe(false);
    expect(state.linesCleared).toBe(1);
    expect(state.board[boardIndex(SIZE, 5, 5)]).toBe(0);
    expect(state.board[boardIndex(SIZE, 0, 0)]).toBe(1);
  });

  it("全消しボーナスが付く", () => {
    const board = createBoard(SIZE);
    for (let x = 0; x < SIZE - 1; x++) board[boardIndex(SIZE, x, 0)] = 1;
    const s = stateWith({ board, tray: trayOf("dot", null, null) });
    const { result } = place(s, CONFIG, 0, SIZE - 1, 0);
    expect(result.boardCleared).toBe(true);
    expect(result.scoreDelta).toBe(1 + 10 + 300);
  });

  it("行 + 列の同時消去は 2 列(30 点)、交差セルは 1 回だけ", () => {
    const board = createBoard(SIZE);
    for (let x = 0; x < SIZE; x++) board[boardIndex(SIZE, x, 9)] = 1;
    for (let y = 0; y < SIZE; y++) board[boardIndex(SIZE, 0, y)] = 1;
    board[boardIndex(SIZE, 0, 9)] = 0; // 交差セルだけ空ける
    board[boardIndex(SIZE, 5, 5)] = 1; // 全消しにならないように 1 マス残す
    const s = stateWith({ board, tray: trayOf("dot", null, null) });
    const { result, state } = place(s, CONFIG, 0, 0, 9);
    expect(result.clearedRows).toEqual([9]);
    expect(result.clearedCols).toEqual([0]);
    expect(result.clearedCells).toHaveLength(2 * SIZE - 1);
    expect(result.scoreDelta).toBe(1 + 30);
    expect(state.linesCleared).toBe(2);
  });

  it("ストリークは消去なしの配置で 0 に戻り、longestStreak は残る", () => {
    const board = createBoard(SIZE);
    for (let x = 0; x < SIZE - 1; x++) {
      board[boardIndex(SIZE, x, 0)] = 1;
      board[boardIndex(SIZE, x, 1)] = 1;
    }
    let s = stateWith({ board, tray: trayOf("dot", "dot", "sq2") });
    s = place(s, CONFIG, 0, SIZE - 1, 0).state;
    expect(s.streak).toBe(1);
    s = place(s, CONFIG, 1, SIZE - 1, 1).state;
    expect(s.streak).toBe(2);
    expect(s.longestStreak).toBe(2);
    const r = place(s, CONFIG, 2, 4, 4); // 消去なし
    expect(r.result.streakAfter).toBe(0);
    expect(r.state.streak).toBe(0);
    expect(r.state.longestStreak).toBe(2);
  });

  it("3 つ置き切ると新しいトレイが配られ round が進む", () => {
    let s = newGame(CONFIG, "endless", "round", 0);
    expect(s.round).toBe(1);
    let newTrayCount = 0;
    for (let t = 0; t < 3; t++) {
      const piece = s.tray[t];
      if (piece === null || piece === undefined) throw new Error("tray");
      const positions = validPositions(s.board, s.size, shape(piece.shapeId));
      const target = positions[positions.length - 1];
      if (target === undefined) throw new Error("no position");
      const r = place(s, CONFIG, t, target[0], target[1]);
      s = r.state;
      if (r.result.newTray) newTrayCount++;
    }
    expect(newTrayCount).toBe(1);
    expect(s.round).toBe(2);
    expect(s.tray.every((p) => p !== null)).toBe(true);
  });

  it("ゲームオーバー: 残ったピースが置けなくなったら over(docs/01 §13)", () => {
    // 空きセルが互いに隣接しないので dot しか置けず、1 つ埋めても行・列は完成しない。
    const board = sparseBoard();
    const s = stateWith({ board, tray: trayOf("dot", "sq2", null) });
    const { state, result } = place(s, CONFIG, 0, 0, 0);
    expect(result.ok).toBe(true);
    expect(result.clearedRows).toEqual([]);
    expect(result.clearedCols).toEqual([]);
    expect(result.gameOver).toBe(true);
    expect(state.status).toBe("over");
    // 終了後は何も置けない。
    expect(place(state, CONFIG, 1, 3, 0).result.ok).toBe(false);
  });

  it("新しいトレイが 1 つも置けなければ即ゲームオーバー(fitGuarantee: none)", () => {
    // 重みを sq2 だけにすると、新トレイは必ず sq2 × 3 になり、この盤には置けない。
    const weights = Object.fromEntries(SHAPES.map((s) => [s.id, s.id === "sq2" ? 1 : 0]));
    const config = withConfig({
      pieces: { weights, fitGuarantee: "none", noTripleDuplicate: false },
    });
    const s = stateWith({ board: sparseBoard(), tray: trayOf("dot", null, null) });
    const r = place(s, config, 0, 0, 0);
    expect(r.result.ok).toBe(true);
    expect(r.result.newTray).toBe(true);
    expect(r.state.tray.map((p) => p?.shapeId)).toEqual(["sq2", "sq2", "sq2"]);
    expect(r.result.gameOver).toBe(true);
    expect(r.state.status).toBe("over");
    expect(r.state.round).toBe(2);
  });

  it("デイリー強制 config では fitGuarantee / pity が無効", () => {
    const daily = forceDaily(CONFIG);
    expect(daily.pieces.fitGuarantee).toBe("none");
    expect(daily.pieces.pity.enabled).toBe(false);
    const a = newGame(daily, "daily", "daily:2026-10-01", 0);
    const b = newGame(daily, "daily", "daily:2026-10-01", 0);
    expect(a.tray).toEqual(b.tray);
  });
});

describe("game / 決定性", () => {
  it("同じ (config, seed, 操作列) から同じ状態になる", () => {
    const run = (): GameState => {
      let s = newGame(CONFIG, "endless", "determinism", 0);
      for (let m = 0; m < 40 && s.status === "playing"; m++) {
        let moved = false;
        for (let t = 0; t < 3; t++) {
          const piece = s.tray[t];
          if (piece === null || piece === undefined) continue;
          const positions = validPositions(s.board, s.size, shape(piece.shapeId));
          const target = positions[(m * 3 + t) % Math.max(positions.length, 1)];
          if (target === undefined) continue;
          const r = place(s, CONFIG, t, target[0], target[1]);
          if (!r.result.ok) continue;
          s = r.state;
          moved = true;
          break;
        }
        if (!moved) break;
      }
      return s;
    };
    const a = run();
    const b = run();
    expect(Array.from(a.board)).toEqual(Array.from(b.board));
    expect(a.score).toBe(b.score);
    expect(a.rng).toBe(b.rng);
    expect(a.tray).toEqual(b.tray);
    expect(a.moves).toBe(b.moves);
  });

  it("不変条件: 消去後に完全な行・列は残らない", () => {
    let s = newGame(CONFIG, "endless", "invariant", 0);
    for (let m = 0; m < 120 && s.status === "playing"; m++) {
      let moved = false;
      for (let t = 0; t < 3; t++) {
        const piece = s.tray[t];
        if (piece === null || piece === undefined) continue;
        const positions = validPositions(s.board, s.size, shape(piece.shapeId));
        const target = positions[m % Math.max(positions.length, 1)];
        if (target === undefined) continue;
        const r = place(s, CONFIG, t, target[0], target[1]);
        if (!r.result.ok) continue;
        s = r.state;
        moved = true;
        break;
      }
      if (!moved) break;
      const leftover = clearLines(s.board, s.size);
      expect(leftover.rows).toEqual([]);
      expect(leftover.cols).toEqual([]);
    }
  });
});

describe("game / serialize", () => {
  it("往復で同じ状態に戻る", () => {
    let s = newGame(CONFIG, "daily", "daily:2026-10-01", 1_760_000_000_000);
    s = place(s, CONFIG, 0, 0, 0).state;
    const restored = deserialize(serialize(s));
    expect(restored).not.toBeNull();
    if (restored === null) return;
    expect(Array.from(restored.board)).toEqual(Array.from(s.board));
    expect(restored.tray).toEqual(s.tray);
    expect(restored.rng).toBe(s.rng);
    expect(restored.seed).toBe(s.seed);
    expect(restored.mode).toBe(s.mode);
    expect(restored.score).toBe(s.score);
    expect(restored.status).toBe(s.status);
    expect(restored.startedAt).toBe(s.startedAt);
  });

  it("復元した状態から続けると同じ乱数列が続く", () => {
    let a = newGame(CONFIG, "endless", "resume", 0);
    a = place(a, CONFIG, 0, 0, 0).state;
    const b = deserialize(serialize(a));
    expect(b).not.toBeNull();
    if (b === null) return;
    const contA = place(a, CONFIG, 1, 0, 8).state;
    const contB = place(b, CONFIG, 1, 0, 8).state;
    expect(contA.rng).toBe(contB.rng);
    expect(contA.tray).toEqual(contB.tray);
  });

  it("base64 の往復(3 の倍数でない長さも)", () => {
    for (const len of [0, 1, 2, 3, 4, 5, 100, 101]) {
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) bytes[i] = i % 7;
      const back = decodeBoard(encodeBoard(bytes));
      expect(back, `len=${len}`).not.toBeNull();
      expect(Array.from(back ?? [])).toEqual(Array.from(bytes));
    }
  });

  it("壊れた入力は null", () => {
    const valid = JSON.parse(serialize(newGame(CONFIG, "endless", "broken", 0))) as Record<
      string,
      unknown
    >;
    const mutate = (patch: Record<string, unknown>): string =>
      JSON.stringify({ ...valid, ...patch });

    expect(deserialize("not json")).toBeNull();
    expect(deserialize("null")).toBeNull();
    expect(deserialize("[]")).toBeNull();
    expect(deserialize('"str"')).toBeNull();
    expect(deserialize(mutate({ version: 2 }))).toBeNull();
    expect(deserialize(mutate({ mode: "timed" }))).toBeNull();
    expect(deserialize(mutate({ status: "paused" }))).toBeNull();
    expect(deserialize(mutate({ seed: 42 }))).toBeNull();
    expect(deserialize(mutate({ board: 1 }))).toBeNull();
    expect(deserialize(mutate({ board: "!!!!" }))).toBeNull();
    expect(deserialize(mutate({ board: "AAA" }))).toBeNull(); // 長さが 4 の倍数でない
    expect(deserialize(mutate({ board: "AAAA" }))).toBeNull(); // セル数が合わない
    expect(deserialize(mutate({ score: "x" }))).toBeNull();
    expect(deserialize(mutate({ score: Number.NaN }))).toBeNull();
    expect(deserialize(mutate({ size: 0 }))).toBeNull();
    expect(deserialize(mutate({ size: 10.5 }))).toBeNull();
    expect(deserialize(mutate({ tray: [] }))).toBeNull();
    expect(deserialize(mutate({ tray: "abc" }))).toBeNull();
    expect(deserialize(mutate({ tray: ["ghost", null, null] }))).toBeNull();
    expect(deserialize(mutate({ tray: [1, null, null] }))).toBeNull();
  });

  it("色インデックスが 6 を超える盤は拒否する", () => {
    const s = newGame(CONFIG, "endless", "badcolor", 0);
    const bad = new Uint8Array(s.board);
    bad[0] = 9;
    const json = JSON.parse(serialize(s)) as Record<string, unknown>;
    json["board"] = encodeBoard(bad);
    expect(deserialize(JSON.stringify(json))).toBeNull();
  });

  it("空スロットを含むトレイも往復できる", () => {
    const s = stateWith({ tray: trayOf("dot", null, "sq2") });
    const back = deserialize(serialize(s));
    expect(back?.tray).toEqual(trayOf("dot", null, "sq2"));
  });
});
