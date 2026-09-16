import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, DEFAULT_EXPERIMENTS } from "../../src/config";
import gameConfigJson from "../../src/config/game-config.json";
import experimentsJson from "../../src/config/experiments.json";
import {
  allResolutions,
  assignVariant,
  deepMerge,
  forceDaily,
  resolveAssignment,
  resolveConfig,
  runningExperiment,
} from "../../src/config/resolve";
import {
  configOverrideSchema,
  safeParseExperiments,
  safeParseGameConfig,
} from "../../src/config/schema";
import type { Experiment, ExperimentsFile } from "../../src/config/schema";
import { SHAPE_IDS } from "../../src/core/shapes";

const clone = <T>(v: T): T => structuredClone(v);

const EXP: Experiment = {
  id: "EXP-0003",
  status: "running",
  startedAt: "2026-10-12T00:00:00Z",
  hypothesis: "pity.threshold を 0.6→0.5 にすると 1 ゲームの長さが伸びる",
  primaryMetric: "games_per_session",
  guardrails: ["crash_free"],
  minUsersPerArm: 300,
  maxDays: 14,
  allocation: { control: 0.5, treatment: 0.5 },
  variants: { control: {}, treatment: { pieces: { pity: { threshold: 0.5 } } } },
  lockedInDaily: true,
};

const fileWith = (...experiments: Experiment[]): ExperimentsFile => ({
  schemaVersion: 1,
  experiments,
});

describe("config / schema", () => {
  it("既定の game-config.json がスキーマを通る", () => {
    const r = safeParseGameConfig(gameConfigJson);
    expect(r.ok, r.ok ? "" : r.error).toBe(true);
    expect(DEFAULT_CONFIG.board.size).toBe(10);
    expect(DEFAULT_CONFIG.pieces.fitGuarantee).toBe("oneOfThree");
    expect(DEFAULT_CONFIG.pieces.noTripleDuplicate).toBe(true);
    expect(DEFAULT_CONFIG.pieces.pity).toEqual({ enabled: true, threshold: 0.6, smallBoost: 1.5 });
  });

  it("weights は 25 形状すべてを過不足なく持つ", () => {
    expect(Object.keys(DEFAULT_CONFIG.pieces.weights).sort()).toEqual([...SHAPE_IDS].sort());
    expect(Object.keys(DEFAULT_CONFIG.pieces.weights)).toHaveLength(25);
  });

  it("docs/01 §3 の重みと一致", () => {
    const w = DEFAULT_CONFIG.pieces.weights;
    expect(w).toEqual({
      dot: 1.0,
      h2: 1.0,
      h3: 1.0,
      h4: 0.8,
      h5: 0.5,
      v2: 1.0,
      v3: 1.0,
      v4: 0.8,
      v5: 0.5,
      sq2: 1.0,
      sq3: 0.35,
      c_ne: 0.7,
      c_nw: 0.7,
      c_se: 0.7,
      c_sw: 0.7,
      L_ne: 0.45,
      L_nw: 0.45,
      L_se: 0.45,
      L_sw: 0.45,
      t_n: 0.5,
      t_e: 0.5,
      t_s: 0.5,
      t_w: 0.5,
      r2x3: 0.4,
      r3x2: 0.4,
    });
  });

  it("範囲外の値は落ちる(docs/02 §4.1 の物理的な壁)", () => {
    const setPath = (obj: Record<string, unknown>, path: string, value: unknown): void => {
      const parts = path.split(".");
      let cur = obj;
      for (const p of parts.slice(0, -1)) cur = cur[p] as Record<string, unknown>;
      cur[parts[parts.length - 1] as string] = value;
    };
    const rejects = (path: string, value: unknown): boolean => {
      const c = clone(gameConfigJson) as unknown as Record<string, unknown>;
      setPath(c, path, value);
      return !safeParseGameConfig(c).ok;
    };

    expect(rejects("pieces.pity.threshold", 1.5)).toBe(true);
    expect(rejects("pieces.pity.threshold", -0.1)).toBe(true);
    expect(rejects("pieces.pity.smallBoost", 0.5)).toBe(true);
    expect(rejects("board.size", 5)).toBe(true);
    expect(rejects("board.size", 13)).toBe(true);
    expect(rejects("board.size", 10.5)).toBe(true);
    expect(rejects("pieces.weights.dot", 6)).toBe(true);
    expect(rejects("pieces.weights.dot", -1)).toBe(true);
    expect(rejects("scoring.streak.max", 0.5)).toBe(true);
    expect(rejects("scoring.streak.step", 2)).toBe(true);
    expect(rejects("scoring.boardClearBonus", -1)).toBe(true);
    expect(rejects("input.touchLiftOffset", 500)).toBe(true);
    expect(rejects("daily.epoch", "2026/10/01")).toBe(true);
    expect(rejects("daily.shareGaugeMax", 0)).toBe(true);
    expect(rejects("fx.clearDurationMs", 5000)).toBe(true);
    expect(rejects("schemaVersion", 2)).toBe(true);

    // 範囲内なら通ることも確認する(テストが常に true にならないように)。
    expect(rejects("pieces.pity.threshold", 0.5)).toBe(false);
    expect(rejects("board.size", 8)).toBe(false);
  });

  it("未知のキー・欠けたキー・不正な enum は落ちる", () => {
    const base = clone(gameConfigJson) as unknown as Record<string, unknown>;
    expect(safeParseGameConfig({ ...base, extra: 1 }).ok).toBe(false);
    const { fx: _fx, ...missing } = base;
    expect(safeParseGameConfig(missing).ok).toBe(false);
    const wrongEnum = clone(base) as { pieces: { fitGuarantee: string } };
    wrongEnum.pieces.fitGuarantee = "always";
    expect(safeParseGameConfig(wrongEnum).ok).toBe(false);
    expect(safeParseGameConfig(null).ok).toBe(false);
  });

  it("weights に未知の形状 ID があると落ちる / 形状が欠けても落ちる", () => {
    const extra = clone(gameConfigJson) as unknown as {
      pieces: { weights: Record<string, number> };
    };
    extra.pieces.weights["zzz"] = 1;
    expect(safeParseGameConfig(extra).ok).toBe(false);

    const missing = clone(gameConfigJson) as unknown as {
      pieces: { weights: Record<string, number> };
    };
    delete missing.pieces.weights["dot"];
    expect(safeParseGameConfig(missing).ok).toBe(false);
  });

  it("weights が全て 0 だと落ちる", () => {
    const zero = clone(gameConfigJson) as unknown as {
      pieces: { weights: Record<string, number> };
    };
    for (const id of SHAPE_IDS) zero.pieces.weights[id] = 0;
    expect(safeParseGameConfig(zero).ok).toBe(false);
  });
});

describe("config / experiments スキーマ", () => {
  it("既定の experiments.json は空配列で通る", () => {
    const r = safeParseExperiments(experimentsJson);
    expect(r.ok, r.ok ? "" : r.error).toBe(true);
    expect(DEFAULT_EXPERIMENTS.experiments).toEqual([]);
    expect(runningExperiment(DEFAULT_EXPERIMENTS)).toBeNull();
  });

  it("正しい実験定義は通る", () => {
    expect(safeParseExperiments(fileWith(EXP)).ok).toBe(true);
  });

  it("running が 2 つあると落ちる", () => {
    const second: Experiment = { ...clone(EXP), id: "EXP-0004" };
    const r = safeParseExperiments(fileWith(clone(EXP), second));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("running");
  });

  it("running 1 つ + concluded なら通る", () => {
    const done: Experiment = { ...clone(EXP), id: "EXP-0004", status: "concluded" };
    expect(safeParseExperiments(fileWith(clone(EXP), done)).ok).toBe(true);
  });

  it("ID 重複は落ちる", () => {
    const dup: Experiment = { ...clone(EXP), status: "draft" };
    expect(safeParseExperiments(fileWith(clone(EXP), dup)).ok).toBe(false);
  });

  it("allocation の合計が 1 でないと落ちる", () => {
    const bad = clone(EXP);
    bad.allocation = { control: 0.5, treatment: 0.4 };
    expect(safeParseExperiments(fileWith(bad)).ok).toBe(false);
  });

  it("allocation と variants のキーがずれると落ちる", () => {
    const bad = clone(EXP);
    bad.allocation = { control: 0.5, other: 0.5 };
    expect(safeParseExperiments(fileWith(bad)).ok).toBe(false);
  });

  it("ID 形式・maxDays の範囲を検証する", () => {
    const badId = clone(EXP);
    badId.id = "EXP-3";
    expect(safeParseExperiments(fileWith(badId)).ok).toBe(false);
    const badDays = clone(EXP);
    badDays.maxDays = 365;
    expect(safeParseExperiments(fileWith(badDays)).ok).toBe(false);
  });

  it("variants のオーバーライドは config の partial に一致する必要がある", () => {
    expect(configOverrideSchema.safeParse({}).success).toBe(true);
    expect(configOverrideSchema.safeParse({ pieces: { pity: { threshold: 0.5 } } }).success).toBe(
      true,
    );
    expect(configOverrideSchema.safeParse({ pieces: { weights: { dot: 2 } } }).success).toBe(true);
    // 範囲外・未知キーは partial でも落ちる。
    expect(configOverrideSchema.safeParse({ pieces: { pity: { threshold: 5 } } }).success).toBe(
      false,
    );
    expect(configOverrideSchema.safeParse({ nope: 1 }).success).toBe(false);
    expect(configOverrideSchema.safeParse({ pieces: { weights: { zzz: 1 } } }).success).toBe(false);

    const badVariant = clone(EXP);
    (badVariant.variants as Record<string, unknown>)["treatment"] = {
      pieces: { pity: { threshold: 9 } },
    };
    expect(safeParseExperiments(fileWith(badVariant)).ok).toBe(false);
  });
});

describe("config / deepMerge", () => {
  it("プレーンオブジェクトを再帰的にマージし、それ以外は置き換える", () => {
    expect(deepMerge({ a: 1, b: { c: 2, d: 3 } }, { b: { c: 9 } })).toEqual({
      a: 1,
      b: { c: 9, d: 3 },
    });
    expect(deepMerge({ a: [1, 2] }, { a: [3] })).toEqual({ a: [3] });
    expect(deepMerge({ a: 1 }, { a: undefined })).toEqual({ a: 1 });
    expect(deepMerge({ a: { b: 1 } }, { a: 5 })).toEqual({ a: 5 });
    expect(deepMerge(1, 2)).toBe(2);
    expect(deepMerge(1, undefined)).toBe(1);
  });

  it("元のオブジェクトを変更しない", () => {
    const base = { pieces: { pity: { threshold: 0.6 } } };
    const merged = deepMerge(base, { pieces: { pity: { threshold: 0.4 } } });
    expect(base.pieces.pity.threshold).toBe(0.6);
    expect(merged.pieces.pity.threshold).toBe(0.4);
  });

  it("deep-merge の結果が再検証を通る", () => {
    const merged = deepMerge(clone(DEFAULT_CONFIG), {
      pieces: { pity: { threshold: 0.5 }, weights: { dot: 2 } },
      scoring: { streak: { max: 3 } },
    });
    const r = safeParseGameConfig(merged);
    expect(r.ok, r.ok ? "" : r.error).toBe(true);
    if (r.ok) {
      expect(r.config.pieces.pity.threshold).toBe(0.5);
      expect(r.config.pieces.pity.smallBoost).toBe(1.5); // 触っていない値は残る
      expect(r.config.pieces.weights["dot"]).toBe(2);
      expect(r.config.scoring.streak.max).toBe(3);
    }
  });
});

describe("config / assignVariant", () => {
  it("同じ installId・同じ実験なら常に同じバリアント", () => {
    for (const id of ["a", "b", "c-d-e", ""]) {
      const first = assignVariant(id, EXP);
      for (let i = 0; i < 5; i++) expect(assignVariant(id, EXP)).toBe(first);
    }
  });

  it("10 万 install の分布が allocation ±2 % 以内", () => {
    const n = 100_000;
    const counts: Record<string, number> = { control: 0, treatment: 0 };
    for (let i = 0; i < n; i++) {
      const v = assignVariant(`install-${i}`, EXP);
      counts[v] = (counts[v] ?? 0) + 1;
    }
    expect(counts["control"]! + counts["treatment"]!).toBe(n);
    expect(counts["control"]! / n).toBeGreaterThan(0.48);
    expect(counts["control"]! / n).toBeLessThan(0.52);
    expect(counts["treatment"]! / n).toBeGreaterThan(0.48);
    expect(counts["treatment"]! / n).toBeLessThan(0.52);
  });

  it("3 群・非対称 allocation でも ±2 % 以内", () => {
    const exp: Experiment = {
      ...clone(EXP),
      allocation: { a: 0.2, b: 0.3, c: 0.5 },
      variants: { a: {}, b: {}, c: {} },
    };
    const n = 100_000;
    const counts: Record<string, number> = { a: 0, b: 0, c: 0 };
    for (let i = 0; i < n; i++) {
      const v = assignVariant(`u${i}`, exp);
      counts[v] = (counts[v] ?? 0) + 1;
    }
    for (const [key, share] of Object.entries(exp.allocation)) {
      expect(Math.abs((counts[key] ?? 0) / n - share), key).toBeLessThan(0.02);
    }
  });

  it("allocation が空なら例外", () => {
    const broken = { ...clone(EXP), allocation: {}, variants: {} } as Experiment;
    expect(() => assignVariant("x", broken)).toThrow();
  });
});

describe("config / resolveConfig", () => {
  const withExp = fileWith(EXP);

  it("実験が無ければ base のコピーを返す", () => {
    const r = resolveConfig(DEFAULT_CONFIG, DEFAULT_EXPERIMENTS, "install-1", "endless");
    expect(r).toEqual(DEFAULT_CONFIG);
    expect(r).not.toBe(DEFAULT_CONFIG);
  });

  it("running の実験のオーバーライドが deep-merge される", () => {
    const thresholds = new Set<number>();
    for (let i = 0; i < 200; i++) {
      const r = resolveConfig(DEFAULT_CONFIG, withExp, `install-${i}`, "endless");
      thresholds.add(r.pieces.pity.threshold);
      expect(r.pieces.pity.smallBoost).toBe(1.5);
    }
    expect([...thresholds].sort()).toEqual([0.5, 0.6]);
  });

  it("バリアントに応じた値になる", () => {
    const install = "install-1";
    const variant = assignVariant(install, EXP);
    const r = resolveConfig(DEFAULT_CONFIG, withExp, install, "endless");
    expect(r.pieces.pity.threshold).toBe(variant === "treatment" ? 0.5 : 0.6);
    expect(resolveAssignment(withExp, install, "endless")).toEqual({
      exp: "EXP-0003",
      variant,
    });
  });

  it("daily + lockedInDaily ではオーバーライドを適用しない", () => {
    for (let i = 0; i < 50; i++) {
      const r = resolveConfig(DEFAULT_CONFIG, withExp, `install-${i}`, "daily");
      expect(r.pieces.pity.threshold).toBe(0.6);
    }
    expect(resolveAssignment(withExp, "install-1", "daily")).toBeNull();
  });

  it("daily では fitGuarantee / pity が強制 OFF", () => {
    const r = resolveConfig(DEFAULT_CONFIG, DEFAULT_EXPERIMENTS, "install-1", "daily");
    expect(r.pieces.fitGuarantee).toBe("none");
    expect(r.pieces.pity.enabled).toBe(false);
    expect(r.pieces.pity.threshold).toBe(0.6); // 他の値は残る
    expect(DEFAULT_CONFIG.pieces.fitGuarantee).toBe("oneOfThree"); // base は不変
  });

  it("lockedInDaily: false なら daily でもオーバーライドが効くが強制は勝つ", () => {
    const exp: Experiment = {
      ...clone(EXP),
      lockedInDaily: false,
      allocation: { treatment: 1 },
      variants: {
        treatment: {
          pieces: { fitGuarantee: "oneOfThree", pity: { enabled: true, threshold: 0.5 } },
        },
      },
    };
    const r = resolveConfig(DEFAULT_CONFIG, fileWith(exp), "install-1", "daily");
    expect(r.pieces.pity.threshold).toBe(0.5);
    expect(r.pieces.fitGuarantee).toBe("none");
    expect(r.pieces.pity.enabled).toBe(false);
  });

  it("再検証に失敗したら base にフォールバックして onError を呼ぶ", () => {
    // スキーマを迂回して不正なオーバーライドを注入する(改善エージェントの暴走の模擬)。
    const exp = clone(EXP) as unknown as {
      allocation: Record<string, number>;
      variants: Record<string, unknown>;
    };
    exp.allocation = { treatment: 1 };
    exp.variants = { treatment: { board: { size: 99 } } };
    const messages: string[] = [];
    const r = resolveConfig(
      DEFAULT_CONFIG,
      fileWith(exp as unknown as Experiment),
      "install-1",
      "endless",
      (m) => messages.push(m),
      safeParseGameConfig,
    );
    expect(r.board.size).toBe(10);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("EXP-0003");
  });

  it("variant の定義が無ければフォールバックして onError を呼ぶ", () => {
    const exp = clone(EXP) as unknown as { variants: Record<string, unknown> };
    delete exp.variants["treatment"];
    delete exp.variants["control"];
    const messages: string[] = [];
    const r = resolveConfig(
      DEFAULT_CONFIG,
      fileWith(exp as unknown as Experiment),
      "install-1",
      "endless",
      (m) => messages.push(m),
    );
    expect(r).toEqual(DEFAULT_CONFIG);
    expect(messages[0]).toContain("variant");
  });

  it("onError を渡さなくても落ちない", () => {
    const exp = clone(EXP) as unknown as { variants: Record<string, unknown> };
    exp.variants = {};
    expect(() =>
      resolveConfig(DEFAULT_CONFIG, fileWith(exp as unknown as Experiment), "i", "endless"),
    ).not.toThrow();
  });

  it("draft / concluded の実験は適用されない", () => {
    for (const status of ["draft", "concluded"] as const) {
      const exp: Experiment = { ...clone(EXP), status };
      const r = resolveConfig(DEFAULT_CONFIG, fileWith(exp), "install-1", "endless");
      expect(r.pieces.pity.threshold).toBe(0.6);
    }
  });

  it("forceDaily は入力を変更しない", () => {
    const base = clone(DEFAULT_CONFIG);
    const daily = forceDaily(base);
    expect(base.pieces.fitGuarantee).toBe("oneOfThree");
    expect(daily.pieces.fitGuarantee).toBe("none");
  });
});

describe("config / Node ローダ", () => {
  it("ファイルから読んだ config が JSON import と一致する", async () => {
    const { loadExperiments, loadGameConfig } = await import("../../src/config/load");
    expect(loadGameConfig()).toEqual(DEFAULT_CONFIG);
    expect(loadExperiments()).toEqual(DEFAULT_EXPERIMENTS);
  });

  it("存在しないパスは例外", async () => {
    const { loadGameConfig } = await import("../../src/config/load");
    expect(() => loadGameConfig("no/such/file.json")).toThrow();
  });
});

describe("config / ブラウザのバンドルに zod を入れない(docs/02 §11 N-10)", () => {
  const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");

  it.each(["src/config/index.ts", "src/config/resolve.ts"])(
    "%s は zod / schema を値として import しない",
    (path) => {
      const imports = read(path)
        .split("\n")
        .filter((l) => /^import\s/.test(l) || /^export \* from/.test(l));
      for (const line of imports) {
        if (/zod|schema/.test(line)) expect(line).toMatch(/^(import|export) type /);
      }
    },
  );

  it("validate を渡さなければ再検証しない(ビルド時に検証済みの前提)", () => {
    const exp = clone(EXP) as unknown as {
      allocation: Record<string, number>;
      variants: Record<string, unknown>;
    };
    exp.allocation = { treatment: 1 };
    exp.variants = { treatment: { board: { size: 99 } } };
    const r = resolveConfig(DEFAULT_CONFIG, fileWith(exp as unknown as Experiment), "i", "endless");
    expect(r.board.size).toBe(99);
  });

  it("allResolutions は base と、未完了の実験の全バリアント × 両モードを並べる", () => {
    const concluded = { ...clone(EXP), id: "EXP-0001", status: "concluded" as const };
    const labels = allResolutions(DEFAULT_CONFIG, {
      schemaVersion: 1,
      experiments: [concluded, clone(EXP)],
    }).map((x) => x.label);
    expect(labels).toEqual([
      "base / endless",
      "base / daily",
      "EXP-0003 / control / endless",
      "EXP-0003 / control / daily",
      "EXP-0003 / treatment / endless",
      "EXP-0003 / treatment / daily",
    ]);
  });

  it("allResolutions の結果はすべてスキーマを通る(現在の JSON)", () => {
    for (const { label, config } of allResolutions(DEFAULT_CONFIG, DEFAULT_EXPERIMENTS)) {
      expect(safeParseGameConfig(config).ok, label).toBe(true);
    }
  });
});
