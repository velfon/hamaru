/**
 * config / experiments の zod スキーマ(docs/02 §4)。
 *
 * **範囲外はビルド失敗**。これは改善エージェントの暴走に対する第一の物理的な壁なので、
 * 数値には必ず上下限を付ける。
 */
import { z } from "zod";
import { SHAPE_IDS } from "../core/shapes";
import type { ResolvedConfig } from "../core/types";

// 本番の CSP は `script-src` に 'unsafe-eval' を含まない(public/_headers)。
// zod は既定で `new Function("")` を試して JIT の可否を調べ、例外は握りつぶすが、
// ブラウザはそれを securitypolicyviolation として報告する。jitless で試行自体を止める
// (docs/02 §11 N-7)。検証結果は変わらない。
z.config({ jitless: true });

const shapeIdSchema = z.enum([...SHAPE_IDS] as [string, ...string[]]);

/** 形状の重み。0〜5(docs/02 §4.1)。 */
const weightSchema = z.number().min(0).max(5);

const weightsSchema = z
  .record(shapeIdSchema, weightSchema)
  .refine((w) => Object.values(w).some((v) => v > 0), {
    message: "weights は少なくとも 1 つが 0 より大きい必要があります",
  });

const fitGuaranteeSchema = z.enum(["none", "oneOfThree"]);

/** 盤サイズ。UI は 10 固定だが core は N×N 対応(docs/01 §2)。 */
const sizeSchema = z.number().int().min(6).max(12);

const pitySchema = z.strictObject({
  enabled: z.boolean(),
  threshold: z.number().min(0).max(1),
  smallBoost: z.number().min(1).max(5),
});

const piecesSchema = z.strictObject({
  weights: weightsSchema,
  noTripleDuplicate: z.boolean(),
  fitGuarantee: fitGuaranteeSchema,
  pity: pitySchema,
});

const streakSchema = z.strictObject({
  step: z.number().min(0).max(1),
  max: z.number().min(1).max(10),
});

const scoringSchema = z.strictObject({
  perCell: z.number().min(0).max(100),
  lineBase: z.number().min(0).max(1000),
  streak: streakSchema,
  boardClearBonus: z.number().min(0).max(100_000),
});

const inputSchema = z.strictObject({
  touchLiftOffset: z.number().min(0).max(200),
  previewClears: z.boolean(),
});

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD 形式で指定してください");

const dailySchema = z.strictObject({
  epoch: dateSchema,
  shareGaugeMax: z.number().min(1).max(1_000_000),
});

const fxSchema = z.strictObject({
  clearDurationMs: z.number().min(0).max(2000),
  snapDurationMs: z.number().min(0).max(2000),
});

export const gameConfigSchema = z.strictObject({
  schemaVersion: z.literal(1),
  board: z.strictObject({ size: sizeSchema }),
  pieces: piecesSchema,
  scoring: scoringSchema,
  input: inputSchema,
  daily: dailySchema,
  fx: fxSchema,
});

export type GameConfig = z.infer<typeof gameConfigSchema>;

/**
 * 実験のオーバーライド = game-config スキーマの deep partial(docs/02 §4.2)。
 * zod v4 は `.deepPartial()` を廃止したので手書きする。
 */
export const configOverrideSchema = z.strictObject({
  board: z.strictObject({ size: sizeSchema }).partial().optional(),
  pieces: z
    .strictObject({
      weights: z.partialRecord(shapeIdSchema, weightSchema),
      noTripleDuplicate: z.boolean(),
      fitGuarantee: fitGuaranteeSchema,
      pity: pitySchema.partial(),
    })
    .partial()
    .optional(),
  scoring: z
    .strictObject({
      perCell: scoringSchema.shape.perCell,
      lineBase: scoringSchema.shape.lineBase,
      streak: streakSchema.partial(),
      boardClearBonus: scoringSchema.shape.boardClearBonus,
    })
    .partial()
    .optional(),
  input: inputSchema.partial().optional(),
  daily: dailySchema.partial().optional(),
  fx: fxSchema.partial().optional(),
});

export type ConfigOverride = z.infer<typeof configOverrideSchema>;

const EXPERIMENT_ID_RE = /^EXP-\d{4}$/;
const ISO_INSTANT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

export const experimentSchema = z
  .strictObject({
    id: z.string().regex(EXPERIMENT_ID_RE, "id は EXP-0001 の形式"),
    status: z.enum(["draft", "running", "concluded"]),
    startedAt: z.string().regex(ISO_INSTANT_RE, "ISO 8601 UTC の瞬間で指定").optional(),
    hypothesis: z.string().min(1),
    primaryMetric: z.string().min(1),
    guardrails: z.array(z.string().min(1)),
    minUsersPerArm: z.number().int().min(1).max(1_000_000),
    maxDays: z.number().int().min(1).max(90),
    allocation: z.record(z.string().min(1), z.number().min(0).max(1)),
    variants: z.record(z.string().min(1), configOverrideSchema),
    lockedInDaily: z.boolean(),
  })
  .refine(
    (e) => {
      const sum = Object.values(e.allocation).reduce((a, b) => a + b, 0);
      return Math.abs(sum - 1) < 1e-9;
    },
    { message: "allocation の合計は 1 である必要があります" },
  )
  .refine(
    (e) => {
      const a = Object.keys(e.allocation).sort();
      const v = Object.keys(e.variants).sort();
      return a.length === v.length && a.every((k, i) => k === v[i]);
    },
    { message: "allocation と variants のキーが一致しません" },
  );

export type Experiment = z.infer<typeof experimentSchema>;

export const experimentsFileSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    experiments: z.array(experimentSchema),
  })
  .refine((f) => f.experiments.filter((e) => e.status === "running").length <= 1, {
    message: "status: running の実験は同時に 1 つまでです(docs/02 §4.2)",
  })
  .refine((f) => new Set(f.experiments.map((e) => e.id)).size === f.experiments.length, {
    message: "実験 ID が重複しています",
  });

export type ExperimentsFile = z.infer<typeof experimentsFileSchema>;

/**
 * 既定 config をパースする。
 * 戻り値の型を `ResolvedConfig` にすることで、スキーマと core の型契約の一致を
 * **コンパイル時に**検証している(docs/02 §11 N-1)。
 */
export function parseGameConfig(input: unknown): ResolvedConfig {
  return gameConfigSchema.parse(input);
}

export function safeParseGameConfig(
  input: unknown,
): { ok: true; config: ResolvedConfig } | { ok: false; error: string } {
  const r = gameConfigSchema.safeParse(input);
  return r.success ? { ok: true, config: r.data } : { ok: false, error: z.prettifyError(r.error) };
}

export function parseExperiments(input: unknown): ExperimentsFile {
  return experimentsFileSchema.parse(input);
}

export function safeParseExperiments(
  input: unknown,
): { ok: true; file: ExperimentsFile } | { ok: false; error: string } {
  const r = experimentsFileSchema.safeParse(input);
  return r.success ? { ok: true, file: r.data } : { ok: false, error: z.prettifyError(r.error) };
}
