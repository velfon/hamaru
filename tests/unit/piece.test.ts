/**
 * かけらの形(docs/01 §5.3)。逆手には形状カタログが無いので、ここが形の正本。
 */
import { describe, expect, it } from "vitest";
import { largestGroup, normalize, pieceCellsAt, pieceSize, resize } from "../../src/core/piece";
import type { CellOffset } from "../../src/core/types";

const cells = (...pairs: Array<[number, number]>): CellOffset[] => pairs;

describe("normalize", () => {
  it("左上を (0,0) に寄せ、読み順に並べる", () => {
    expect(normalize(cells([5, 5], [4, 5], [4, 4]))).toEqual([
      [0, 0],
      [0, 1],
      [1, 1],
    ]);
  });

  it("空は空", () => {
    expect(normalize([])).toEqual([]);
  });

  it("負の座標も寄せる", () => {
    expect(normalize(cells([-2, -3], [-1, -3]))).toEqual([
      [0, 0],
      [1, 0],
    ]);
  });
});

describe("largestGroup", () => {
  it("いちばん大きなひとまとまりを返す", () => {
    // (0,0)-(1,0) の 2 マスと、離れた (5,5) の 1 マス
    const group = largestGroup(cells([0, 0], [1, 0], [5, 5]));
    expect(group).toHaveLength(2);
    expect(normalize(group)).toEqual([
      [0, 0],
      [1, 0],
    ]);
  });

  it("斜めはつながりとみなさない", () => {
    expect(largestGroup(cells([0, 0], [1, 1]))).toHaveLength(1);
  });

  it("ひとつなぎならそのまま", () => {
    expect(largestGroup(cells([0, 0], [1, 0], [1, 1]))).toHaveLength(3);
  });
});

describe("resize", () => {
  it("足りなければ読み順で隣を足す(つながったまま)", () => {
    const grown = resize(cells([0, 0]), 4);
    expect(grown).toHaveLength(4);
    expect(largestGroup(grown)).toHaveLength(4);
  });

  it("多ければ幅優先で削る(つながったまま)", () => {
    const shrunk = resize(cells([0, 0], [1, 0], [2, 0], [3, 0], [4, 0]), 2);
    expect(shrunk).toEqual([
      [0, 0],
      [1, 0],
    ]);
  });

  it("同じ入力からは必ず同じ形(乱数を使わない)", () => {
    for (const size of [1, 3, 5, 9]) {
      expect(resize(cells([0, 0], [0, 1]), size)).toEqual(resize(cells([0, 0], [0, 1]), size));
    }
  });

  it("0 以下や空でも 1 マスは返す", () => {
    expect(resize([], 3)).toEqual([[0, 0]]);
    expect(resize(cells([2, 2]), 0)).toEqual([[0, 0]]);
  });
});

describe("pieceSize / pieceCellsAt", () => {
  it("幅と高さ", () => {
    expect(pieceSize({ cells: cells([0, 0], [1, 0], [1, 1]), color: 1 })).toEqual({ w: 2, h: 2 });
  });

  it("盤の座標に置き換える", () => {
    expect(pieceCellsAt({ cells: cells([0, 0], [1, 0]), color: 1 }, 3, 4)).toEqual([
      [3, 4],
      [4, 4],
    ]);
  });
});
