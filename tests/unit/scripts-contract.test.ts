/**
 * package.json のスクリプトの約束事(docs/02 §11 N-10 / N-12)。
 * - 配信物を作るビルドは必ず `validate:config` を先に通す(ブラウザは config を再検証しないため)
 * - デプロイではクライアント(VITE_APP_VERSION)と Worker(APP_VERSION)の両方に同じ版を入れる
 *   (テレメトリの version と /api/health の version を一致させる。topErrors の isNew 判定に使う)
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as {
  scripts: Record<string, string>;
};

describe("package.json scripts", () => {
  it.each(["build", "deploy"])("%s は vite build より前に validate:config を通す", (name) => {
    const script = pkg.scripts[name] ?? "";
    const validate = script.indexOf("validate:config");
    const build = script.search(/vite build|npm run build/);
    expect(validate, script).toBeGreaterThanOrEqual(0);
    expect(validate, script).toBeLessThan(build);
  });

  it("cf:dev は build(= validate:config 込み)を使う", () => {
    expect(pkg.scripts["cf:dev"]).toMatch(/^npm run build && /);
  });

  it("deploy はクライアントと Worker に同じ版(GIT_SHA)を入れる", () => {
    const script = pkg.scripts["deploy"] ?? "";
    expect(script).toContain("VITE_APP_VERSION=${GIT_SHA:-dev} vite build");
    expect(script).toContain("--var APP_VERSION:${GIT_SHA:-dev}");
  });
});
