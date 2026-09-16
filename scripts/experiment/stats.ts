/**
 * Welch の t 検定(docs/05 §6.3)。外部の統計ライブラリには依存しない。
 *
 * t 分布の両側 p 値は正則化不完全ベータ関数で求める:
 *   P(|T| > |t|) = I_{df / (df + t²)}(df / 2, 1 / 2)
 * 不完全ベータは連分数(Lentz 法)で評価する。参照値は tests/unit/experiment-eval.test.ts
 * (独立に数値積分で求めた値と照合)。
 */

/** ln Γ(x)(Lanczos 近似、g = 7, n = 9)。x > 0。 */
export function logGamma(x: number): number {
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6,
    1.5056327351493116e-7,
  ];
  if (x < 0.5) {
    // 反射公式
    return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
  }
  const z = x - 1;
  let a = c[0] as number;
  const t = z + 7.5;
  for (let i = 1; i < 9; i++) a += (c[i] as number) / (z + i);
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(a);
}

/** 不完全ベータの連分数部分(Numerical Recipes の betacf を Lentz 法で)。 */
function betaContinuedFraction(x: number, a: number, b: number): number {
  const MAX_ITER = 500;
  const EPS = 1e-15;
  const TINY = 1e-300;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < TINY) d = TINY;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= MAX_ITER; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < TINY) d = TINY;
    c = 1 + aa / c;
    if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < TINY) d = TINY;
    c = 1 + aa / c;
    if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) return h;
  }
  return h;
}

/** 正則化不完全ベータ関数 I_x(a, b)。 */
export function regularizedBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const lnFront =
    logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x);
  const front = Math.exp(lnFront);
  // 収束の速い側で評価する。
  if (x < (a + 1) / (a + b + 2)) return (front * betaContinuedFraction(x, a, b)) / a;
  return 1 - (front * betaContinuedFraction(1 - x, b, a)) / b;
}

/** t 分布の両側 p 値 P(|T| > |t|)。 */
export function tTwoSidedP(t: number, df: number): number {
  if (!Number.isFinite(t)) return 0;
  if (t === 0) return 1;
  return regularizedBeta(df / (df + t * t), df / 2, 0.5);
}

/** t 分布の上側分位 t_{p}(例: p = 0.975 → 両側 95 % の臨界値)。二分法。 */
export function tQuantile(p: number, df: number): number {
  if (p <= 0.5) throw new Error("tQuantile は p > 0.5 のみ");
  const target = 2 * (1 - p); // 両側 p 値がこれになる |t|
  let lo = 0;
  let hi = 1;
  while (tTwoSidedP(hi, df) > target) hi *= 2;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    if (tTwoSidedP(mid, df) > target) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

export interface WelchResult {
  n0: number;
  n1: number;
  mean0: number;
  mean1: number;
  sd0: number;
  sd1: number;
  /** mean1 − mean0 */
  diff: number;
  /** 分散が両腕とも 0 で差がある場合は null(t は無限大)。 */
  t: number | null;
  df: number;
  p: number;
  /** diff の 95 % 信頼区間。 */
  ciLow: number;
  ciHigh: number;
}

function meanVar(xs: readonly number[]): { mean: number; variance: number } {
  const n = xs.length;
  const mean = xs.reduce((s, x) => s + x, 0) / n;
  const variance = xs.reduce((s, x) => s + (x - mean) ** 2, 0) / (n - 1);
  return { mean, variance };
}

/**
 * Welch の t 検定(control = a、treatment = b)。各腕 2 件未満なら null。
 */
export function welch(a: readonly number[], b: readonly number[]): WelchResult | null {
  if (a.length < 2 || b.length < 2) return null;
  const x = meanVar(a);
  const y = meanVar(b);
  const va = x.variance / a.length;
  const vb = y.variance / b.length;
  const se = Math.sqrt(va + vb);
  const diff = y.mean - x.mean;
  const base = {
    n0: a.length,
    n1: b.length,
    mean0: x.mean,
    mean1: y.mean,
    sd0: Math.sqrt(x.variance),
    sd1: Math.sqrt(y.variance),
    diff,
  };
  if (se === 0) {
    const df = a.length + b.length - 2;
    return diff === 0
      ? { ...base, t: 0, df, p: 1, ciLow: 0, ciHigh: 0 }
      : { ...base, t: null, df, p: 0, ciLow: diff, ciHigh: diff };
  }
  const t = diff / se;
  const df = (va + vb) ** 2 / (va ** 2 / (a.length - 1) + vb ** 2 / (b.length - 1));
  const p = tTwoSidedP(t, df);
  const q = tQuantile(0.975, df);
  return { ...base, t, df, p, ciLow: diff - q * se, ciHigh: diff + q * se };
}
