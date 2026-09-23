/**
 * package.json のスクリプトの約束事(docs/02 §11 N-10 / N-12)。
 * - 配信物を作るビルドは必ず `validate:config` を先に通す(ブラウザは config を再検証しないため)
 * - デプロイではクライアント(VITE_APP_VERSION)と Worker(APP_VERSION)の両方に同じ版を入れる
 *   (テレメトリの version と /api/health の version を一致させる。topErrors の isNew 判定に使う)
 */
import { execFileSync } from "node:child_process";
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

describe("PWA の更新(docs/02 §11 N-14)", () => {
  const config = readFileSync(new URL("../../vite.config.ts", import.meta.url), "utf8");

  it("skipWaiting が有効(古い版が居座らない)", () => {
    expect(config).toMatch(/skipWaiting:\s*true/);
    expect(config).toMatch(/clientsClaim:\s*true/);
  });
});

describe("配信ヘッダ(docs/02 §10)", () => {
  const headers = readFileSync(new URL("../../public/_headers", import.meta.url), "utf8");
  const csp = headers.match(/Content-Security-Policy: (.+)/)?.[1] ?? "";

  it("CSP は既定で自分のオリジンだけを許す", () => {
    for (const directive of [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self'",
      "connect-src 'self'",
      "base-uri 'none'",
      "form-action 'none'",
      "frame-ancestors 'none'",
      "object-src 'none'",
    ]) {
      expect(csp).toContain(directive);
    }
  });

  it("インラインと eval は許さない(style 属性も使わない)", () => {
    expect(csp).not.toContain("unsafe-inline");
    expect(csp).not.toContain("unsafe-eval");
  });

  it("埋め込み・盗み見への基本の防御が入っている", () => {
    for (const header of [
      "X-Frame-Options: DENY",
      "X-Content-Type-Options: nosniff",
      "Referrer-Policy: strict-origin-when-cross-origin",
      "Cross-Origin-Opener-Policy: same-origin",
      "Cross-Origin-Resource-Policy: same-origin",
      "Strict-Transport-Security: max-age=31536000",
    ]) {
      expect(headers).toContain(header);
    }
  });
});

describe("style 属性を使わない(CSP の 'unsafe-inline' を外したため。docs/02 §10)", () => {
  it("src に style 属性の指定が残っていない", () => {
    const files = execFileSync("git", ["ls-files", "src"], { encoding: "utf8" })
      .split("\n")
      .filter((f) => f.endsWith(".ts"));
    const offenders = files.filter((f) => {
      const source = readFileSync(new URL(`../../${f}`, import.meta.url), "utf8");
      return /style:\s*[`"']/.test(source) || /setAttribute\(\s*["']style["']/.test(source);
    });
    expect(offenders).toEqual([]);
  });
});
