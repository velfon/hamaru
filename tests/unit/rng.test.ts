import { describe, expect, it } from "vitest";
import { createRng, cyrb53, rngFromState } from "../../src/core/rng";

const take = (n: number, seed: string): number[] => {
  const rng = createRng(seed);
  return Array.from({ length: n }, () => rng.next());
};

describe("rng", () => {
  it("同じシードなら同じ列", () => {
    expect(take(20, "daily:2026-10-01")).toEqual(take(20, "daily:2026-10-01"));
  });

  it("全ての値が [0, 1)", () => {
    for (const v of take(2000, "range")) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("1000 個の異なるシードで先頭 10 値が衝突しない", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      const key = take(10, `seed-${i}`).join(",");
      expect(seen.has(key), `seed-${i} が衝突`).toBe(false);
      seen.add(key);
    }
    expect(seen.size).toBe(1000);
  });

  it("状態の保存 / 復元で列が継続する", () => {
    const a = createRng("resume");
    const head = [a.next(), a.next(), a.next()];
    const state = a.getState();
    const tailA = [a.next(), a.next(), a.next()];

    const b = rngFromState(state);
    expect([b.next(), b.next(), b.next()]).toEqual(tailA);
    expect(head).not.toEqual(tailA);
  });

  it("getState は符号なし 32 bit 整数", () => {
    const rng = createRng("unsigned");
    for (let i = 0; i < 100; i++) {
      rng.next();
      const s = rng.getState();
      expect(Number.isInteger(s)).toBe(true);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThan(2 ** 32);
    }
  });

  it("nextInt は [0, n)。n <= 0 なら 0", () => {
    const rng = createRng("ints");
    for (let i = 0; i < 500; i++) {
      const v = rng.nextInt(7);
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(7);
    }
    expect(rng.nextInt(0)).toBe(0);
    expect(rng.nextInt(-3)).toBe(0);
  });

  it("cyrb53 は決定的で 53 bit に収まる", () => {
    expect(cyrb53("hamaru")).toBe(cyrb53("hamaru"));
    expect(cyrb53("hamaru")).not.toBe(cyrb53("hamaru!"));
    expect(cyrb53("a", 1)).not.toBe(cyrb53("a", 2));
    expect(cyrb53("")).toBe(cyrb53(""));
    for (const s of ["", "a", "hamaru", "daily:2026-10-01"]) {
      const h = cyrb53(s);
      expect(Number.isInteger(h)).toBe(true);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(Number.MAX_SAFE_INTEGER);
    }
  });

  it("平均が 0.5 付近に収束する(粗い一様性チェック)", () => {
    const values = take(20_000, "uniform");
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    expect(mean).toBeGreaterThan(0.48);
    expect(mean).toBeLessThan(0.52);
  });
});
