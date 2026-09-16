/**
 * シード付き乱数(docs/01 §4.1)。
 *
 * 文字列シードを cyrb53 で 53 bit ハッシュし、その下位 32 bit で mulberry32 を初期化する。
 * 内部状態は number 1 つなので `GameState.rng` に保存でき、途中再開しても同じ列が続く。
 */

/**
 * cyrb53 ハッシュ。戻り値は 0 <= h < 2^53 の整数。
 * 出典: bryc によるパブリックドメイン実装。
 */
export function cyrb53(str: string, seed = 0): number {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

export interface Rng {
  /** [0, 1) の乱数を返し、内部状態を進める。 */
  next(): number;
  /** [0, n) の整数を返す。n <= 0 なら 0。 */
  nextInt(n: number): number;
  /** 現在の内部状態(mulberry32 の a)。`GameState.rng` に保存する値。 */
  getState(): number;
}

/** mulberry32。状態は符号なし 32 bit 整数。 */
export function rngFromState(state: number): Rng {
  let a = state | 0;
  const next = (): number => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    nextInt: (n: number): number => (n <= 0 ? 0 : Math.floor(next() * n)),
    getState: (): number => a >>> 0,
  };
}

/** 文字列シードから乱数器を作る。 */
export function createRng(seed: string): Rng {
  return rngFromState(cyrb53(seed) >>> 0);
}
