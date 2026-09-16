/**
 * 変更クラス(docs/05 §5、docs/06 §1 G7)。
 */
import { describe, expect, it } from "vitest";
import {
  classify,
  classOf,
  DEFAULT_BOTS,
  LABELS,
  parseNumstat,
  type FileChange,
} from "../../scripts/change-class";

const BOT = "github-actions[bot]";
const f = (path: string, added = 10, deleted = 0): FileChange => ({ path, added, deleted });
const run = (files: FileChange[], labels: string[] = [LABELS.kaizen], author = BOT) =>
  classify({ files, labels, author, bots: DEFAULT_BOTS });

describe("classOf", () => {
  it.each([
    ["src/config/experiments.json", "safe-auto"],
    ["src/ui/screens/home.ts", "safe-auto"],
    ["src/i18n/ja.json", "safe-auto"],
    ["docs/01-game-spec.md", "safe-auto"],
    ["kaizen/BACKLOG.md", "safe-auto"],
    ["kaizen/experiments/EXP-0001.md", "safe-auto"],
    ["tests/e2e/game.spec.ts", "safe-auto"],
    ["sim/bots/greedy.ts", "safe-auto"],
    ["src/core/board.ts", "core-guarded"],
    ["src/telemetry/client.ts", "core-guarded"],
    ["sim/run.ts", "core-guarded"],
    ["kaizen/POLICY.md", "human-only"],
    ["kaizen/prompts/daily.md", "human-only"],
    ["tests/unit/golden/daily-2026-10-01.json", "human-only"],
    ["sim/baseline.json", "human-only"],
    ["worker/index.ts", "human-only"],
    [".github/workflows/ci.yml", "human-only"],
    ["package.json", "human-only"],
    ["wrangler.jsonc", "human-only"],
    ["public/_headers", "human-only"],
    // 規則に無いパスは安全側
    ["scripts/metrics-pull.ts", "human-only"],
    ["CLAUDE.md", "human-only"],
    ["index.html", "human-only"],
  ])("%s → %s", (path, cls) => {
    expect(classOf(path)).toBe(cls);
  });

  it("前方一致はディレクトリ境界で判定する(src/core2 は core ではない)", () => {
    expect(classOf("src/core2/x.ts")).toBe("human-only");
    expect(classOf("kaizenX/a.md")).toBe("human-only");
  });
});

describe("classify", () => {
  it("最も厳しいクラスを採る", () => {
    expect(run([f("src/ui/a.ts"), f("src/core/b.ts")]).class).toBe("core-guarded");
    expect(run([f("src/ui/a.ts"), f("worker/x.ts")], [LABELS.kaizen], "someone").class).toBe(
      "human-only",
    );
  });

  it("safe-auto の bot PR は 400 行まで自動マージ(kaizen/ は数えない)", () => {
    const ok = run([f("src/ui/a.ts", 300, 100), f("kaizen/metrics/2026-10-15.json", 5000)]);
    expect(ok.lines).toBe(400);
    expect(ok.automerge).toBe(true);
    const tooBig = run([f("src/ui/a.ts", 301, 100)]);
    expect(tooBig.automerge).toBe(false);
    expect(tooBig.violations).toEqual([]);
  });

  it("core-guarded は 150 行まで、かつ golden 不変なら自動", () => {
    expect(run([f("src/core/board.ts", 100, 50)]).automerge).toBe(true);
    expect(run([f("src/core/board.ts", 100, 51)]).automerge).toBe(false);
  });

  it("bot が human-only に触れたら違反(CI 失敗)", () => {
    const r = run([f("src/ui/a.ts"), f(".github/workflows/ci.yml")]);
    expect(r.violations).toEqual([
      "改善エージェントは .github/workflows/ci.yml を変更できません(human-only)",
    ]);
    expect(r.automerge).toBe(false);
  });

  it("人間の PR は human-only に触れても違反ではないが、自動マージもしない", () => {
    const r = run([f("worker/index.ts")], [], "velfon");
    expect(r.violations).toEqual([]);
    expect(r.automerge).toBe(false);
  });

  it("golden / baseline の変更はラベルが無ければ誰でも違反", () => {
    const golden = run([f("tests/unit/golden/daily-2026-10-01.json")], [], "velfon");
    expect(golden.goldenChanged).toBe(true);
    expect(golden.violations[0]).toContain(LABELS.goldenUpdate);
    expect(
      run([f("tests/unit/golden/x.json")], [LABELS.goldenUpdate], "velfon").violations,
    ).toEqual([]);
    expect(run([f("sim/baseline.json")], [], "velfon").violations[0]).toContain(
      LABELS.baselineUpdate,
    );
  });

  it("kaizen ラベルの無い bot PR は自動マージしない", () => {
    expect(run([f("src/ui/a.ts")], []).automerge).toBe(false);
  });

  it("変更なしは safe-auto・0 行", () => {
    const r = run([]);
    expect(r.class).toBe("safe-auto");
    expect(r.lines).toBe(0);
  });
});

describe("parseNumstat", () => {
  it("通常・バイナリ・改名", () => {
    const text = [
      "12\t3\tsrc/ui/a.ts",
      "-\t-\tpublic/icons/icon-192.png",
      "4\t4\tsrc/{core => ui}/moved.ts",
      "1\t0\told.md => docs/new.md",
      "",
    ].join("\n");
    expect(parseNumstat(text)).toEqual([
      { path: "src/ui/a.ts", added: 12, deleted: 3 },
      { path: "public/icons/icon-192.png", added: 0, deleted: 0 },
      { path: "src/ui/moved.ts", added: 4, deleted: 4 },
      { path: "src/core/moved.ts", added: 0, deleted: 0 },
      { path: "docs/new.md", added: 1, deleted: 0 },
      { path: "old.md", added: 0, deleted: 0 },
    ]);
  });

  it("human-only のファイルを safe-auto の場所へ改名しても、旧パスで違反になる", () => {
    const files = parseNumstat("0\t0\t{worker => src/ui}/index.ts\n");
    expect(files.map((x) => x.path)).toEqual(["src/ui/index.ts", "worker/index.ts"]);
    const r = run(files);
    expect(r.class).toBe("human-only");
    expect(r.violations[0]).toContain("worker/index.ts");
  });
});
