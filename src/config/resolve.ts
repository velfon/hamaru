/**
 * config + 実験オーバーライドの解決(docs/02 §4.3、§4.4)。
 */
import { cyrb53 } from "../core/rng";
import type { Mode, ResolvedConfig } from "../core/types";
// schema.ts(zod)は**型だけ**を import する。値を import するとブラウザのバンドルに zod が入る
// (docs/02 §11 N-10)。実行時の再検証は `validate` を渡したときだけ行う。
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

export type ConfigValidator = (
  input: unknown,
) => { ok: true; config: ResolvedConfig } | { ok: false; error: string };

/**
 * base config に実験オーバーライドを deep-merge し、デイリーの強制を適用する。
 * `validate` を渡したら再検証し、失敗なら base(デイリーなら強制適用後の base)へフォールバックして
 * `onError` を呼ぶ。
 *
 * ブラウザは `validate` を渡さない。全実験 × 全バリアント × 両モードの解決結果は
 * `npm run validate:config`(ビルドの前に必ず走る)が zod で検証済みなので、同じ入力から
 * 同じ結果になる実行時の解決は再検証しなくてよい(docs/02 §11 N-10)。
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
  validate?: ConfigValidator,
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

  if (validate === undefined) return merged;
  const parsed = validate(merged);
  if (!parsed.ok) {
    onError?.(`experiment ${exp.id} / ${assignment.variant} の解決結果が不正: ${parsed.error}`);
    return fallback;
  }
  return parsed.config;
}

/**
 * 全実験 × 全バリアント × 両モードの解決結果を並べる(`validate:config` 用)。
 * 実行時にあり得る config をすべて列挙するので、これを検証すれば実行時の再検証は要らない。
 */
export function allResolutions(
  base: ResolvedConfig,
  experiments: ExperimentsFile,
): Array<{ label: string; config: unknown }> {
  const out: Array<{ label: string; config: unknown }> = [
    { label: "base / endless", config: deepClone(base) },
    { label: "base / daily", config: forceDaily(deepClone(base)) },
  ];
  for (const exp of experiments.experiments) {
    if (exp.status === "concluded") continue;
    for (const [variant, override] of Object.entries(exp.variants)) {
      const merged = deepMerge(deepClone(base), override);
      out.push({ label: `${exp.id} / ${variant} / endless`, config: merged });
      out.push({
        label: `${exp.id} / ${variant} / daily`,
        config: forceDaily(exp.lockedInDaily ? deepClone(base) : merged),
      });
    }
  }
  return out;
}
