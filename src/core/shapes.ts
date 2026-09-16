/**
 * 形状カタログ(docs/01 §3)。回転なし。25 形状。
 *
 * 座標は原点 (0,0) を左上とする相対座標で、min(dx) === 0 かつ min(dy) === 0 に正規化する。
 * 色は形状カテゴリで固定(視認性のため同じ形は同じ色)。
 *
 * **この配列の順序は乱数列に影響する**(重み付き抽選が順に累積するため)。
 * docs/01 §3 の表の順序を正とし、並べ替えない(並べ替えると golden テストが壊れる)。
 */
import type { Cell, CellOffset, Shape } from "./types";

export type ShapeCategory = "dot" | "line" | "square" | "smallL" | "bigL" | "tee" | "rect";

/** カテゴリ → 色インデックス(docs/01 §3 「色」)。 */
export const CATEGORY_COLOR: Readonly<Record<ShapeCategory, Cell>> = {
  dot: 1,
  line: 1,
  square: 2,
  smallL: 3,
  bigL: 4,
  tee: 5,
  rect: 6,
};

interface ShapeDef {
  readonly id: string;
  readonly category: ShapeCategory;
  readonly cells: ReadonlyArray<CellOffset>;
}

/** 幅 w × 高さ h の充填矩形。 */
function rect(w: number, h: number): CellOffset[] {
  const cells: CellOffset[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      cells.push([x, y]);
    }
  }
  return cells;
}

// prettier-ignore
const DEFS: readonly ShapeDef[] = [
  { id: "dot", category: "dot", cells: rect(1, 1) },

  { id: "h2", category: "line", cells: rect(2, 1) },
  { id: "h3", category: "line", cells: rect(3, 1) },
  { id: "h4", category: "line", cells: rect(4, 1) },
  { id: "h5", category: "line", cells: rect(5, 1) },

  { id: "v2", category: "line", cells: rect(1, 2) },
  { id: "v3", category: "line", cells: rect(1, 3) },
  { id: "v4", category: "line", cells: rect(1, 4) },
  { id: "v5", category: "line", cells: rect(1, 5) },

  { id: "sq2", category: "square", cells: rect(2, 2) },
  { id: "sq3", category: "square", cells: rect(3, 3) },

  // 小 L: 2×2 から 1 セル欠け。名前の方位に 3 セルが寄る(= 反対の角が欠ける)。
  { id: "c_ne", category: "smallL", cells: [[0, 0], [1, 0], [1, 1]] }, // 欠け = 南西
  { id: "c_nw", category: "smallL", cells: [[0, 0], [1, 0], [0, 1]] }, // 欠け = 南東
  { id: "c_se", category: "smallL", cells: [[1, 0], [0, 1], [1, 1]] }, // 欠け = 北西
  { id: "c_sw", category: "smallL", cells: [[0, 0], [0, 1], [1, 1]] }, // 欠け = 北東

  // 大 L: 3×3 の L。名前の方位に「角」が来る。
  { id: "L_ne", category: "bigL", cells: [[0, 0], [1, 0], [2, 0], [2, 1], [2, 2]] },
  { id: "L_nw", category: "bigL", cells: [[0, 0], [1, 0], [2, 0], [0, 1], [0, 2]] },
  { id: "L_se", category: "bigL", cells: [[2, 0], [2, 1], [0, 2], [1, 2], [2, 2]] },
  { id: "L_sw", category: "bigL", cells: [[0, 0], [0, 1], [0, 2], [1, 2], [2, 2]] },

  // T: 名前の方位に突起が向く。
  { id: "t_n", category: "tee", cells: [[1, 0], [0, 1], [1, 1], [2, 1]] },
  { id: "t_e", category: "tee", cells: [[0, 0], [0, 1], [0, 2], [1, 1]] },
  { id: "t_s", category: "tee", cells: [[0, 0], [1, 0], [2, 0], [1, 1]] },
  { id: "t_w", category: "tee", cells: [[1, 0], [0, 1], [1, 1], [1, 2]] },

  { id: "r2x3", category: "rect", cells: rect(3, 2) }, // 2 行 × 3 列
  { id: "r3x2", category: "rect", cells: rect(2, 3) }, // 3 行 × 2 列
];

function build(def: ShapeDef): Shape {
  let w = 0;
  let h = 0;
  for (const [dx, dy] of def.cells) {
    if (dx + 1 > w) w = dx + 1;
    if (dy + 1 > h) h = dy + 1;
  }
  return { id: def.id, cells: def.cells, w, h, color: CATEGORY_COLOR[def.category] };
}

/** 25 形状。docs/01 §3 の表の順序。 */
export const SHAPES: readonly Shape[] = DEFS.map(build);

export const SHAPE_IDS: readonly string[] = SHAPES.map((s) => s.id);

const BY_ID = new Map<string, Shape>(SHAPES.map((s) => [s.id, s]));

export const SHAPES_BY_ID: ReadonlyMap<string, Shape> = BY_ID;

export const SHAPE_CATEGORY: ReadonlyMap<string, ShapeCategory> = new Map(
  DEFS.map((d) => [d.id, d.category]),
);

/** 形状 ID から形状を引く。未知の ID なら undefined。 */
export function getShape(id: string): Shape | undefined {
  return BY_ID.get(id);
}

/** 形状のセル数。 */
export function cellCount(shape: Shape): number {
  return shape.cells.length;
}
