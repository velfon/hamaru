/**
 * 変更クラスの判定(docs/05 §5、docs/06 §1 G7)。
 *
 *   safe-auto     CI 緑なら自動マージしてよい
 *   core-guarded  CI 緑 かつ golden 不変 かつ 差分 150 行以内なら自動、それ以外は人間
 *   human-only    自動マージしない。改善エージェント(bot)が触れたら CI 失敗
 *
 * PR 全体のクラスは**最も厳しいもの**。どの規則にも当たらないパスは human-only(安全側)。
 *
 *   tsx scripts/change-class.ts --base <sha> --head <sha> [--labels a,b] [--author login]
 *                               [--bots github-actions[bot],claude[bot]] [--json out.json]
 *
 * GitHub Actions では `GITHUB_EVENT_PATH` の PR からラベルと作者を読む。
 * 違反があれば exit 1。`GITHUB_STEP_SUMMARY` / `GITHUB_OUTPUT` があれば結果を書く。
 */
import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

export type ChangeClass = "safe-auto" | "core-guarded" | "human-only";

const RANK: Record<ChangeClass, number> = { "safe-auto": 0, "core-guarded": 1, "human-only": 2 };

/** 末尾 `/**` はそのディレクトリ以下、それ以外は完全一致。上から順に最初に当たった規則を使う。 */
export const RULES: ReadonlyArray<[pattern: string, cls: ChangeClass]> = [
  // human-only(明示。safe-auto の規則より先に評価する)
  ["kaizen/POLICY.md", "human-only"],
  ["kaizen/prompts/**", "human-only"],
  ["tests/unit/golden/**", "human-only"],
  ["sim/baseline.json", "human-only"],
  ["worker/**", "human-only"],
  [".github/**", "human-only"],
  ["package.json", "human-only"],
  ["package-lock.json", "human-only"],
  ["wrangler.jsonc", "human-only"],
  ["public/_headers", "human-only"],
  ["vite.config.ts", "human-only"],
  // core-guarded
  ["src/core/**", "core-guarded"],
  ["src/telemetry/**", "core-guarded"],
  ["src/storage/**", "core-guarded"],
  ["sim/run.ts", "core-guarded"],
  // safe-auto
  ["src/config/**", "safe-auto"],
  ["src/i18n/**", "safe-auto"],
  ["src/styles/**", "safe-auto"],
  ["src/ui/**", "safe-auto"],
  ["public/icons/**", "safe-auto"],
  ["docs/**", "safe-auto"],
  ["kaizen/**", "safe-auto"],
  ["tests/**", "safe-auto"],
  ["sim/bots/**", "safe-auto"],
];

export const GOLDEN = "tests/unit/golden/**";
export const BASELINE = "sim/baseline.json";

/** 行数の上限に数えないパス(記録・スナップショット・ロックファイル)。 */
export const LINE_EXEMPT = ["kaizen/**", GOLDEN, BASELINE, "package-lock.json"];

export const LIMITS = { safeAuto: 400, coreGuarded: 150 } as const;

export const LABELS = {
  kaizen: "kaizen",
  goldenUpdate: "golden: update",
  baselineUpdate: "sim-baseline: update",
} as const;

export const DEFAULT_BOTS = ["github-actions[bot]", "claude[bot]"];

export function matches(path: string, pattern: string): boolean {
  if (pattern.endsWith("/**")) return path.startsWith(pattern.slice(0, -2));
  return path === pattern;
}

export function classOf(path: string): ChangeClass {
  for (const [pattern, cls] of RULES) if (matches(path, pattern)) return cls;
  return "human-only";
}

export interface FileChange {
  path: string;
  /** バイナリは 0。 */
  added: number;
  deleted: number;
}

export interface ClassifyInput {
  files: readonly FileChange[];
  labels: readonly string[];
  author: string;
  bots: readonly string[];
}

export interface ClassifyResult {
  class: ChangeClass;
  files: Array<{ path: string; class: ChangeClass }>;
  /** 上限判定に数える変更行数(追加 + 削除)。 */
  lines: number;
  byBot: boolean;
  goldenChanged: boolean;
  baselineChanged: boolean;
  violations: string[];
  automerge: boolean;
  reasons: string[];
}

export function classify(input: ClassifyInput): ClassifyResult {
  const files = input.files.map((f) => ({ path: f.path, class: classOf(f.path) }));
  const cls = files.reduce<ChangeClass>(
    (worst, f) => (RANK[f.class] > RANK[worst] ? f.class : worst),
    "safe-auto",
  );
  const lines = input.files
    .filter((f) => !LINE_EXEMPT.some((p) => matches(f.path, p)))
    .reduce((s, f) => s + f.added + f.deleted, 0);
  const byBot = input.bots.includes(input.author);
  const labels = new Set(input.labels);
  const goldenChanged = input.files.some((f) => matches(f.path, GOLDEN));
  const baselineChanged = input.files.some((f) => matches(f.path, BASELINE));

  const violations: string[] = [];
  if (byBot) {
    for (const f of files.filter((x) => x.class === "human-only")) {
      violations.push(`改善エージェントは ${f.path} を変更できません(human-only)`);
    }
  }
  if (goldenChanged && !labels.has(LABELS.goldenUpdate)) {
    violations.push(
      `golden を変更するには「${LABELS.goldenUpdate}」ラベルが必要です(ルール変更は人間承認)`,
    );
  }
  if (baselineChanged && !labels.has(LABELS.baselineUpdate)) {
    violations.push(`sim/baseline.json を変更するには「${LABELS.baselineUpdate}」ラベルが必要です`);
  }

  const reasons: string[] = [];
  let automerge = false;
  if (!byBot) reasons.push(`作者 ${input.author} は改善エージェントではない`);
  else if (!labels.has(LABELS.kaizen)) reasons.push(`「${LABELS.kaizen}」ラベルがない`);
  else if (violations.length > 0) reasons.push("違反がある");
  else if (cls === "safe-auto") {
    automerge = lines <= LIMITS.safeAuto;
    reasons.push(
      automerge
        ? `safe-auto、${lines} 行 ≤ ${LIMITS.safeAuto}`
        : `safe-auto だが ${lines} 行 > ${LIMITS.safeAuto}`,
    );
  } else if (cls === "core-guarded") {
    automerge = !goldenChanged && lines <= LIMITS.coreGuarded;
    reasons.push(
      automerge
        ? `core-guarded、golden 不変、${lines} 行 ≤ ${LIMITS.coreGuarded}`
        : `core-guarded だが ${goldenChanged ? "golden が変わった" : `${lines} 行 > ${LIMITS.coreGuarded}`}`,
    );
  } else {
    reasons.push("human-only");
  }

  return {
    class: cls,
    files,
    lines,
    byBot,
    goldenChanged,
    baselineChanged,
    violations,
    automerge,
    reasons,
  };
}

/**
 * `git diff --numstat` の出力 → FileChange[]。
 * 改名は**旧パスも 0 行の変更として含める**。新パスだけで判定すると、human-only のファイルを
 * safe-auto の場所へ移すだけでクラス判定をすり抜けられるため。
 */
export function parseNumstat(text: string): FileChange[] {
  const out: FileChange[] = [];
  for (const line of text.split("\n")) {
    const cols = line.split("\t");
    if (cols.length < 3) continue;
    const [added, deleted, ...rest] = cols;
    const { from, to } = renamed(rest.join("\t"));
    out.push({
      path: to,
      added: added === "-" ? 0 : Number(added),
      deleted: deleted === "-" ? 0 : Number(deleted),
    });
    if (from !== null) out.push({ path: from, added: 0, deleted: 0 });
  }
  return out;
}

/** `src/{a => b}/x.ts` や `old => new` の改名表記を旧パスと新パスに分ける。 */
function renamed(path: string): { from: string | null; to: string } {
  const brace = /^(.*)\{(.*) => (.*)\}(.*)$/.exec(path);
  if (brace !== null) {
    const join = (mid: string) => `${brace[1]}${mid}${brace[4]}`.replace("//", "/");
    return { from: join(brace[2] as string), to: join(brace[3] as string) };
  }
  const i = path.indexOf(" => ");
  return i < 0 ? { from: null, to: path } : { from: path.slice(0, i), to: path.slice(i + 4) };
}

interface Args {
  base: string;
  head: string;
  labels: string[];
  author: string;
  bots: string[];
  json: string | null;
}

function parseArgs(argv: readonly string[]): Args {
  const event = readEvent();
  const args: Args = {
    base: event?.base ?? "origin/main",
    head: event?.head ?? "HEAD",
    labels: event?.labels ?? [],
    author: event?.author ?? "",
    bots: (process.env["KAIZEN_BOT_LOGINS"] ?? "").split(",").filter((s) => s !== ""),
    json: null,
  };
  if (args.bots.length === 0) args.bots = [...DEFAULT_BOTS];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const v = (): string => {
      const x = argv[++i];
      if (x === undefined) throw new Error(`${arg} に値がありません`);
      return x;
    };
    if (arg === "--base") args.base = v();
    else if (arg === "--head") args.head = v();
    else if (arg === "--labels")
      args.labels = v()
        .split(",")
        .filter((s) => s !== "");
    else if (arg === "--author") args.author = v();
    else if (arg === "--bots")
      args.bots = v()
        .split(",")
        .filter((s) => s !== "");
    else if (arg === "--json") args.json = v();
    else throw new Error(`不明な引数: ${arg}`);
  }
  return args;
}

function readEvent(): { base: string; head: string; labels: string[]; author: string } | null {
  const path = process.env["GITHUB_EVENT_PATH"];
  if (path === undefined || path === "") return null;
  try {
    const event = JSON.parse(readFileSync(path, "utf8")) as {
      pull_request?: {
        base: { sha: string };
        head: { sha: string };
        labels: Array<{ name: string }>;
        user: { login: string };
      };
    };
    const pr = event.pull_request;
    if (pr === undefined) return null;
    return {
      base: pr.base.sha,
      head: pr.head.sha,
      labels: pr.labels.map((l) => l.name),
      author: pr.user.login,
    };
  } catch {
    return null;
  }
}

function main(): number {
  const args = parseArgs(process.argv.slice(2));
  const numstat = execFileSync("git", ["diff", "--numstat", "-M", `${args.base}...${args.head}`], {
    encoding: "utf8",
  });
  const result = classify({
    files: parseNumstat(numstat),
    labels: args.labels,
    author: args.author,
    bots: args.bots,
  });

  const summary = [
    `### 変更クラス: \`${result.class}\``,
    "",
    `- 変更行数(記録・スナップショット除く): ${result.lines}`,
    `- 作者: ${args.author || "(不明)"}${result.byBot ? "(改善エージェント)" : ""}`,
    `- 自動マージ: ${result.automerge ? "可" : "不可"}(${result.reasons.join("、")})`,
    ...(result.violations.length > 0
      ? ["", "**違反**", ...result.violations.map((v) => `- ${v}`)]
      : []),
    "",
    "| パス | クラス |",
    "|---|---|",
    ...result.files.map((f) => `| \`${f.path}\` | ${f.class} |`),
  ].join("\n");
  console.log(summary);

  const stepSummary = process.env["GITHUB_STEP_SUMMARY"];
  if (stepSummary) appendFileSync(stepSummary, summary + "\n");
  const output = process.env["GITHUB_OUTPUT"];
  if (output) {
    appendFileSync(
      output,
      `class=${result.class}\nautomerge=${result.automerge}\nlines=${result.lines}\n`,
    );
  }
  if (args.json !== null) writeFileSync(args.json, JSON.stringify(result, null, 2) + "\n");

  return result.violations.length > 0 ? 1 : 0;
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  process.exitCode = main();
}
