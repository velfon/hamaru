/**
 * config + 実験オーバーライドの解決(docs/02 §4.3、§4.4)。
 */
import { cyrb53 } from "../core/rng";
import type { Mode, ResolvedConfig } from "../core/types";
import { safeParseGameConfig } from "./schema";
import type { ConfigOverride, Experiment, ExperimentsFile } from "./schema";

const BUCKETS = 10_000;

type Json = Record<string, unknown>;

function isPlainObject(v: unknown): v is Json {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** プレーンオブジェクトだけ再帰的にマージし、それ以外は置き換える。 */
export function deepMerge<T>(base: T, override: unknown): T {
  if (!isPlainObject(base) || !isPlainObject(override)) {
    return (override === undefined ? base : override) as T;
  }
  const out: Json = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (value === undefined) continue;
    out[key] = isPlainObject(value) && isPlainObject(out[key]) ? deepMerge(out[key], value) : value;
  }
  return out as T;
}

function deepClone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

/**
 * 割り当て(docs/02 §4.3)。
 * `cyrb53(installId + ":" + exp.id) % 10000` を allocation の累積で区分する。
 * allocation のキー順(JSON の記述順)が区分の順序になる。
 */
export function assignVariant(installId: string, exp: Experiment): string {
  const keys = Object.keys(exp.allocation);
  const last = keys[keys.length - 1];
  if (last === undefined) {
    throw new Error(`experiment ${exp.id} に allocation がありません`);
  }
  const bucket = cyrb53(`${installId}:${exp.id}`) % BUCKETS;
  let acc = 0;
  for (const key of keys) {
    acc += (exp.allocation[key] ?? 0) * BUCKETS;
    if (bucket < acc) return key;
  }
  return last;
}

/** `status: "running"` の実験(最大 1 つ)。 */
export function runningExperiment(experiments: ExperimentsFile): Experiment | null {
  return experiments.experiments.find((e) => e.status === "running") ?? null;
}

export interface Assignment {
  exp: string;
  variant: string;
}

/**
 * このインストールに適用される実験とバリアント。
 * デイリーかつ `lockedInDaily` の実験は **適用しない**(公平性の要件。docs/01 §4.2)。
 */
export function resolveAssignment(
  experiments: ExperimentsFile,
  installId: string,
  mode: Mode,
): Assignment | null {
  const exp = runningExperiment(experiments);
  if (exp === null) return null;
  if (mode === "daily" && exp.lockedInDaily) return null;
  return { exp: exp.id, variant: assignVariant(installId, exp) };
}

/** デイリーの強制(docs/01 §4.2)。盤の状態に依存させないための公平性要件。 */
export function forceDaily(config: ResolvedConfig): ResolvedConfig {
  return deepMerge(config, {
    pieces: { fitGuarantee: "none", pity: { enabled: false } },
  });
}

/**
 * base config に実験オーバーライドを deep-merge し、デイリーの強制を適用して再検証する。
 * 再検証に失敗したら base(デイリーなら強制適用後の base)へフォールバックし、`onError` を呼ぶ。
 *
 * 実装ノート(docs/02 §11 N-2): 02 §4.4 は「失敗なら error イベントを送る」とあるが、
 * config 層は telemetry を import できない(依存方向)。代わりに `onError` コールバックを受け、
 * 送信の責務は呼び出し側(UI/telemetry)に置く。
 */
export function resolveConfig(
  base: ResolvedConfig,
  experiments: ExperimentsFile,
  installId: string,
  mode: Mode,
  onError?: (message: string) => void,
): ResolvedConfig {
  const fallback = mode === "daily" ? forceDaily(deepClone(base)) : deepClone(base);

  const assignment = resolveAssignment(experiments, installId, mode);
  if (assignment === null) return fallback;

  const exp = runningExperiment(experiments);
  /* c8 ignore next */
  if (exp === null) return fallback;

  const override: ConfigOverride | undefined = exp.variants[assignment.variant];
  if (override === undefined) {
    onError?.(`experiment ${exp.id}: variant ${assignment.variant} の定義がありません`);
    return fallback;
  }

  let merged = deepMerge(deepClone(base), override);
  if (mode === "daily") merged = forceDaily(merged);

  const parsed = safeParseGameConfig(merged);
  if (!parsed.ok) {
    onError?.(`experiment ${exp.id} / ${assignment.variant} の解決結果が不正: ${parsed.error}`);
    return fallback;
  }
  return parsed.config;
}
