/**
 * `npm run validate:config` が範囲外の値を検出することを、実際にスクリプトを起動して確認する
 * (docs/07 M1 受け入れ条件)。
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const TIMEOUT = 60_000;
const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), "hamaru-config-"));

function runValidate(args: string[]): { code: number; output: string } {
  try {
    const stdout = execFileSync("npx", ["tsx", "scripts/validate-config.ts", ...args], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, output: stdout };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { code: err.status ?? 1, output: `${err.stdout ?? ""}${err.stderr ?? ""}` };
  }
}

const writeTmp = (name: string, value: unknown): string => {
  const path = join(tmp, name);
  writeFileSync(path, JSON.stringify(value), "utf8");
  return path;
};

const baseConfig = (): Record<string, never> =>
  JSON.parse(readFileSync(join(repoRoot, "src/config/game-config.json"), "utf8"));

describe("validate:config", () => {
  it(
    "既定の config は通る(終了コード 0)",
    () => {
      const r = runValidate([]);
      expect(r.code).toBe(0);
      expect(r.output).toContain("config OK");
    },
    TIMEOUT,
  );

  it(
    "範囲外の値(sakate.maxPiece = 20)を検出して非ゼロ終了する",
    () => {
      const config = baseConfig() as unknown as { sakate: Record<string, number> };
      config.sakate["maxPiece"] = 20;
      const r = runValidate([writeTmp("bad-threshold.json", config)]);
      expect(r.code).toBe(1);
      expect(r.output).toContain("game-config");
    },
    TIMEOUT,
  );

  it(
    "範囲外の育ち方を検出する",
    () => {
      const config = baseConfig() as unknown as { sakate: Record<string, number> };
      config.sakate["growEvery"] = 99;
      const r = runValidate([writeTmp("bad-weight.json", config)]);
      expect(r.code).toBe(1);
    },
    TIMEOUT,
  );

  it(
    "running 実験が 2 つある experiments を検出する",
    () => {
      const exp = {
        id: "EXP-0001",
        status: "running",
        hypothesis: "h",
        primaryMetric: "m",
        guardrails: [],
        minUsersPerArm: 1,
        maxDays: 1,
        allocation: { control: 1 },
        variants: { control: {} },
        lockedInDaily: true,
      };
      const path = writeTmp("two-running.json", {
        schemaVersion: 1,
        experiments: [exp, { ...exp, id: "EXP-0002" }],
      });
      const r = runValidate(["src/config/game-config.json", path]);
      expect(r.code).toBe(1);
      expect(r.output).toContain("experiments");
    },
    TIMEOUT,
  );

  it(
    "ファイルが無ければ非ゼロ終了する",
    () => {
      const r = runValidate([join(tmp, "missing.json")]);
      expect(r.code).toBe(1);
    },
    TIMEOUT,
  );
});
