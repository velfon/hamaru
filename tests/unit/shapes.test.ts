import { describe, expect, it } from "vitest";
import {
  CATEGORY_COLOR,
  SHAPES,
  SHAPES_BY_ID,
  SHAPE_CATEGORY,
  SHAPE_IDS,
  cellCount,
  getShape,
} from "../../src/core/shapes";

/** docs/01 §3 の表(形状の正)。 */
const TABLE: ReadonlyArray<[id: string, cells: number, w: number, h: number, color: number]> = [
  ["dot", 1, 1, 1, 1],
  ["h2", 2, 2, 1, 1],
  ["h3", 3, 3, 1, 1],
  ["h4", 4, 4, 1, 1],
  ["h5", 5, 5, 1, 1],
  ["v2", 2, 1, 2, 1],
  ["v3", 3, 1, 3, 1],
  ["v4", 4, 1, 4, 1],
  ["v5", 5, 1, 5, 1],
  ["sq2", 4, 2, 2, 2],
  ["sq3", 9, 3, 3, 2],
  ["c_ne", 3, 2, 2, 3],
  ["c_nw", 3, 2, 2, 3],
  ["c_se", 3, 2, 2, 3],
  ["c_sw", 3, 2, 2, 3],
  ["L_ne", 5, 3, 3, 4],
  ["L_nw", 5, 3, 3, 4],
  ["L_se", 5, 3, 3, 4],
  ["L_sw", 5, 3, 3, 4],
  ["t_n", 4, 3, 2, 5],
  ["t_e", 4, 2, 3, 5],
  ["t_s", 4, 3, 2, 5],
  ["t_w", 4, 2, 3, 5],
  ["r2x3", 6, 3, 2, 6],
  ["r3x2", 6, 2, 3, 6],
];

describe("shapes", () => {
  it("25 形状ちょうど、表と同じ ID・順序", () => {
    expect(SHAPES).toHaveLength(25);
    expect(SHAPE_IDS).toEqual(TABLE.map(([id]) => id));
  });

  it("ID が一意", () => {
    expect(new Set(SHAPE_IDS).size).toBe(SHAPE_IDS.length);
    expect(SHAPES_BY_ID.size).toBe(25);
  });

  it.each(TABLE)("%s: セル数・バウンディングボックス・色が表と一致", (id, cells, w, h, color) => {
    const shape = getShape(id);
    expect(shape, `${id} が存在しない`).toBeDefined();
    if (shape === undefined) return;
    expect(cellCount(shape)).toBe(cells);
    expect(shape.w).toBe(w);
    expect(shape.h).toBe(h);
    expect(shape.color).toBe(color);
  });

  it("原点に正規化されている(min dx = 0, min dy = 0)かつ重複セルがない", () => {
    for (const shape of SHAPES) {
      const xs = shape.cells.map(([dx]) => dx);
      const ys = shape.cells.map(([, dy]) => dy);
      expect(Math.min(...xs), `${shape.id} の min dx`).toBe(0);
      expect(Math.min(...ys), `${shape.id} の min dy`).toBe(0);
      expect(Math.max(...xs) + 1).toBe(shape.w);
      expect(Math.max(...ys) + 1).toBe(shape.h);
      const keys = new Set(shape.cells.map(([dx, dy]) => `${dx},${dy}`));
      expect(keys.size, `${shape.id} に重複セル`).toBe(shape.cells.length);
    }
  });

  it("色はカテゴリ規則に一致(線=1 正方形=2 小L=3 大L=4 T=5 長方形=6 dot=1)", () => {
    expect(CATEGORY_COLOR).toEqual({
      dot: 1,
      line: 1,
      square: 2,
      smallL: 3,
      bigL: 4,
      tee: 5,
      rect: 6,
    });
    for (const shape of SHAPES) {
      const category = SHAPE_CATEGORY.get(shape.id);
      expect(category, `${shape.id} のカテゴリ`).toBeDefined();
      if (category === undefined) continue;
      expect(shape.color).toBe(CATEGORY_COLOR[category]);
    }
  });

  it("小 L は 2×2 から 1 セル欠け、名前の方位に 3 セルが寄る", () => {
    const missing = (id: string): string => {
      const shape = getShape(id);
      if (shape === undefined) return "?";
      const all = ["0,0", "1,0", "0,1", "1,1"];
      const have = new Set(shape.cells.map(([dx, dy]) => `${dx},${dy}`));
      return all.find((k) => !have.has(k)) ?? "?";
    };
    expect(missing("c_nw")).toBe("1,1"); // 南東が欠ける
    expect(missing("c_ne")).toBe("0,1"); // 南西が欠ける
    expect(missing("c_sw")).toBe("1,0"); // 北東が欠ける
    expect(missing("c_se")).toBe("0,0"); // 北西が欠ける
  });

  it("docs/01 §3 の例と一致(c_nw / L_sw / t_s)", () => {
    expect(getShape("c_nw")?.cells).toEqual([
      [0, 0],
      [1, 0],
      [0, 1],
    ]);
    expect(getShape("L_sw")?.cells).toEqual([
      [0, 0],
      [0, 1],
      [0, 2],
      [1, 2],
      [2, 2],
    ]);
    expect(getShape("t_s")?.cells).toEqual([
      [0, 0],
      [1, 0],
      [2, 0],
      [1, 1],
    ]);
  });

  it("未知の ID は undefined", () => {
    expect(getShape("nope")).toBeUndefined();
  });
});
