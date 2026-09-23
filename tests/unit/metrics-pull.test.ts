/**
 * metrics:pull(docs/04 §5〜§7、docs/07 M4「固定の入力 JSON に対する単体テスト」)。
 *
 * 合成データ(集計日 2026-10-15、窓 14 日)。期待値は手計算:
 *
 *   install  platform lang  初回日   セッション(日 / starts / games / abandon / 分 / error / daily)
 *   A        ios      ja    10-12    s1 10-12 / 1 / 3 / 1 / 10 / 0      s2 10-13 / 1 / 2 / 0 / 5 / 1
 *   B        android  en    10-13    s3 10-13 / 1 / 1 / 0 /  2 / 0 / daily start+result+share
 *   C        desktop  en    (古い)   s4 10-14 / 1 / 0 / 0 /  0 / 0
 *   D        desktop  en    10-14    s6 10-14 / 1 / 0 / 0 /  0 / 0
 *
 *   sessions=5 games=6 → games_per_session 1.2、abandon 1/6、crash_free 4/5
 *   installs_active=4、installs_new=3(A,B,D)
 *   d1_return: コホート A(10-12), B(10-13)。D は 10-16 が未到来で除外。A だけ翌日に再訪 → 0.5
 *   session_minutes_median: [0,0,2,5,10] → 2
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  d1Return,
  histQuantile,
  mergeSessions,
  weightedQuantile,
  type SessionRow,
} from "../../scripts/metrics/aggregate";
import { buildReport, type MetricsReport } from "../../scripts/metrics/report";
import {
  cloudflareFetcher,
  pullRaw,
  queryPaged,
  SqlApiError,
  type SqlFetcher,
} from "../../scripts/metrics/runner";
import {
  dt,
  durationHistSql,
  firstSeenSql,
  PAGE_SIZE,
  parseRows,
  scoreHistSql,
  sessionRowsSql,
  topErrorsSql,
  vitalsHistSql,
} from "../../scripts/metrics/sql";
import { parseArgs, runPull } from "../../scripts/metrics-pull";

const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), "hamaru-metrics-"));

const DAY = 86_400;
const day = (d: string): number => Date.parse(`${d}T00:00:00Z`) / 1000;
const NOW = Date.parse("2026-10-15T18:05:00Z");

const A = "aaaaaaaa-0000-4000-8000-000000000001";
const B = "bbbbbbbb-0000-4000-8000-000000000002";
const C = "cccccccc-0000-4000-8000-000000000003";
const D = "dddddddd-0000-4000-8000-000000000004";

type R = Record<string, unknown>;

function session(o: Partial<R> & { install: string; session: string; day: number }): R {
  return {
    platform: "desktop",
    lang: "en",
    exp: "",
    variant: "",
    w: 1,
    starts: 1,
    games: 0,
    abandons: 0,
    game_ms: 0,
    errors: 0,
    daily_starts: 0,
    daily_results: 0,
    shares: 0,
    ...o,
  };
}

const SESSIONS: R[] = [
  session({
    install: A,
    session: "s1",
    day: day("2026-10-12"),
    platform: "ios",
    lang: "ja",
    exp: "EXP-0001",
    variant: "control",
    games: 3,
    abandons: 1,
    game_ms: 600_000,
  }),
  session({
    install: A,
    session: "s2",
    day: day("2026-10-13"),
    platform: "ios",
    lang: "ja",
    exp: "EXP-0001",
    variant: "control",
    games: 2,
    game_ms: 300_000,
    errors: 1,
  }),
  session({
    install: B,
    session: "s3",
    day: day("2026-10-13"),
    platform: "android",
    exp: "EXP-0001",
    variant: "treatment",
    games: 1,
    game_ms: 120_000,
    daily_starts: 1,
    daily_results: 1,
    shares: 1,
  }),
  session({ install: C, session: "s4", day: day("2026-10-14") }),
  session({ install: D, session: "s6", day: day("2026-10-14") }),
];

const FIRST_SEEN: R[] = [
  { install: A, first_ts: day("2026-10-12") + 3600 },
  { install: B, first_ts: day("2026-10-13") + 7200 },
  { install: D, first_ts: day("2026-10-14") + 60 },
];

const DURATIONS: R[] = [
  {
    day: day("2026-10-12"),
    platform: "ios",
    lang: "ja",
    exp: "EXP-0001",
    variant: "control",
    bucket: 36,
    n: 2,
  },
  {
    day: day("2026-10-13"),
    platform: "android",
    lang: "en",
    exp: "EXP-0001",
    variant: "treatment",
    bucket: 40,
    n: 1,
  },
];
const SCORES: R[] = [
  { day: day("2026-10-12"), platform: "ios", lang: "ja", exp: "", variant: "", bucket: 10, n: 1 },
  { day: day("2026-10-12"), platform: "ios", lang: "ja", exp: "", variant: "", bucket: 20, n: 1 },
  { day: day("2026-10-13"), platform: "ios", lang: "ja", exp: "", variant: "", bucket: 30, n: 1 },
];
const VITALS: R[] = [
  { day: day("2026-10-13"), platform: "ios", lang: "ja", name: "LCP", bucket: 20, n: 3 },
  { day: day("2026-10-13"), platform: "ios", lang: "ja", name: "LCP", bucket: 30, n: 1 },
  { day: day("2026-10-13"), platform: "ios", lang: "ja", name: "CLS", bucket: 2, n: 1 },
];
const ERRORS: R[] = [
  { stack_hash: "3fa9", message: "TypeError: x", first_version: "abc1234", n: "14", n_recent: "5" },
];

/** SQL の中身で応答を振り分ける偽の API。数値は文字列で返す行も混ぜる。 */
function fakeApi(overrides: { sessions?: R[] } = {}): { fetcher: SqlFetcher; sql: string[] } {
  const sql: string[] = [];
  const lines = (rows: R[]) => rows.map((r) => JSON.stringify(r)).join("\n");
  const fetcher: SqlFetcher = async (q) => {
    sql.push(q);
    const firstPage = !/OFFSET [1-9]/.test(q);
    if (q.includes("AS starts")) return firstPage ? lines(overrides.sessions ?? SESSIONS) : "";
    if (q.includes("AS first_ts")) return firstPage ? lines(FIRST_SEEN) : "";
    if (q.includes("floor(double4")) return firstPage ? lines(DURATIONS) : "";
    if (q.includes("floor(double1 ")) return firstPage ? lines(SCORES) : "";
    if (q.includes("double11")) return firstPage ? lines(VITALS) : "";
    if (q.includes("AS stack_hash")) return lines(ERRORS);
    if (q.includes("argMax(blob3")) return JSON.stringify({ version: "abc1234", rows: "42" });
    throw new Error(`想定外の SQL: ${q}`);
  };
  return { fetcher, sql };
}

const EXPERIMENTS = {
  schemaVersion: 1,
  experiments: [
    {
      id: "EXP-0001",
      status: "running",
      startedAt: "2026-10-12T00:00:00Z",
      hypothesis: "test",
      primaryMetric: "games_per_session",
      guardrails: ["crash_free"],
      minUsersPerArm: 300,
      maxDays: 14,
      allocation: { control: 0.5, treatment: 0.5 },
      variants: { control: {}, treatment: { sakate: { growEvery: 3 } } },
      lockedInDaily: true,
    },
  ],
};

async function report(): Promise<MetricsReport> {
  const raw = await pullRaw(fakeApi().fetcher, {
    fromMs: day("2026-10-01") * 1000,
    toMs: day("2026-10-15") * 1000,
    recentFromMs: day("2026-10-14") * 1000,
  });
  return buildReport(raw, { date: "2026-10-15", days: 14, nowMs: NOW, experiment: null }).report;
}

describe("SQL(AE の方言)", () => {
  const r = { fromMs: day("2026-10-01") * 1000, toMs: day("2026-10-15") * 1000 };
  const all = [
    sessionRowsSql(r),
    firstSeenSql(r, r.fromMs),
    durationHistSql(r),
    scoreHistSql(r),
    vitalsHistSql(r),
    topErrorsSql(r, r.fromMs),
  ];

  it("JOIN / UNION / WITH を使わない(1 クエリ 1 テーブル)", () => {
    for (const q of all) expect(q).not.toMatch(/\b(JOIN|UNION|WITH)\b/i);
  });

  it("日時は toDateTime('YYYY-MM-DD HH:MM:SS')(UTC)", () => {
    expect(dt(Date.parse("2026-10-01T00:00:00Z"))).toBe("toDateTime('2026-10-01 00:00:00')");
  });

  it("if() の分岐は同じ型(浮動小数)にそろえる(AE は Double と Integer の混在を 422 で拒否する)", () => {
    expect(vitalsHistSql(r)).toContain("if(blob10 = 'CLS', 0.005, if(blob10 = 'INP', 8.0, 50.0))");
    for (const q of all) {
      for (const m of q.matchAll(/if\([^,]+,\s*([^,()]+),\s*([^,()]+)\)/g)) {
        expect(/^\d+$/.test((m[1] ?? "").trim()) === /^\d+$/.test((m[2] ?? "").trim()), m[0]).toBe(
          true,
        );
      }
    }
  });

  it("件数はすべて _sample_interval で重み付けする", () => {
    for (const q of [durationHistSql(r), scoreHistSql(r), vitalsHistSql(r), topErrorsSql(r, 0)]) {
      expect(q).toContain("_sample_interval");
    }
    expect(sessionRowsSql(r)).toContain("max(_sample_interval) AS w");
  });
});

describe("parseRows", () => {
  it("JSONEachRow", () => {
    expect(parseRows('{"a":1}\n{"a":"2"}\n')).toEqual([{ a: 1 }, { a: "2" }]);
  });
  it("FORMAT JSON の { data: [...] }", () => {
    expect(parseRows('{"meta":[],"data":[{"a":1},{"a":2}],"rows":2}')).toEqual([
      { a: 1 },
      { a: 2 },
    ]);
    expect(parseRows('{\n "meta": [],\n "data": [{"a": 1}]\n}')).toEqual([{ a: 1 }]);
  });
  it("空の応答は 0 行", () => {
    expect(parseRows("")).toEqual([]);
    expect(parseRows("\n")).toEqual([]);
  });
});

describe("分位", () => {
  it("histQuantile はビンの中央値で代表させる", () => {
    expect(
      histQuantile(
        [
          { bucket: 36, n: 2 },
          { bucket: 40, n: 1 },
        ],
        5000,
        0.5,
      ),
    ).toBe(182_500);
    expect(histQuantile([], 5000, 0.5)).toBeNull();
    expect(histQuantile([{ bucket: 1, n: 0 }], 5000, 0.5)).toBeNull();
  });
  it("weightedQuantile は重みを数える", () => {
    const v = [
      { value: 1, w: 1 },
      { value: 100, w: 3 },
    ];
    expect(weightedQuantile(v, 0.5)).toBe(100);
    expect(weightedQuantile([], 0.5)).toBeNull();
  });
});

describe("mergeSessions", () => {
  it("日をまたいだセッションは 1 行に束ね、最初の日と空でない実験を採る", () => {
    const base: SessionRow = {
      install: A,
      session: "x",
      dayMs: 2 * DAY * 1000,
      platform: "ios",
      lang: "ja",
      exp: "",
      variant: "",
      w: 1,
      starts: 1,
      games: 1,
      abandons: 0,
      gameMs: 1000,
      errors: 0,
      dailyStarts: 0,
      dailyResults: 0,
      shares: 0,
    };
    const merged = mergeSessions([
      {
        ...base,
        dayMs: 3 * DAY * 1000,
        starts: 0,
        games: 2,
        exp: "EXP-0001",
        variant: "treatment",
        w: 4,
      },
      base,
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      dayMs: 2 * DAY * 1000,
      starts: 1,
      games: 3,
      gameMs: 2000,
      exp: "EXP-0001",
      variant: "treatment",
      w: 4,
    });
  });
});

describe("buildReport(合成データ)", () => {
  it("d14 の全指標が手計算と一致する", async () => {
    const m = (await report()).overall["d14"];
    expect(m).toEqual({
      sessions: 5,
      installs_active: 4,
      installs_new: 3,
      games: 6,
      games_per_session: 1.2,
      median_game_seconds: 182.5,
      median_score: 1025,
      p90_score: 1525,
      abandon_rate: 0.1667,
      session_minutes_median: 2,
      d1_return: 0.5,
      daily_start_rate: 0.25,
      daily_completion: 1,
      share_rate: 1,
      crash_free: 0.8,
      lcp_p75: 1025,
      inp_p75: null,
      cls_p75: 0.0125,
    });
  });

  it("d1 窓(10-14)は C と D だけ。D の翌日は未到来なので d1_return は null", async () => {
    const m = (await report()).overall["d1"];
    expect(m?.sessions).toBe(2);
    expect(m?.games).toBe(0);
    expect(m?.games_per_session).toBe(0);
    expect(m?.installs_new).toBe(1);
    expect(m?.d1_return).toBeNull();
    expect(m?.median_game_seconds).toBeNull();
  });

  it("byDay は 14 日分。コホートの翌日再訪は日ごと", async () => {
    const r = await report();
    expect(r.byDay).toHaveLength(14);
    expect(r.byDay[0]?.date).toBe("2026-10-01");
    const byDate = Object.fromEntries(r.byDay.map((d) => [d.date, d]));
    expect(byDate["2026-10-12"]?.d1_return).toBe(1);
    expect(byDate["2026-10-13"]?.d1_return).toBe(0);
    expect(byDate["2026-10-14"]?.d1_return).toBeNull();
    expect(byDate["2026-10-13"]?.sessions).toBe(2);
  });

  it("byPlatform / byLang(d7)", async () => {
    const r = await report();
    expect(r.byPlatform["ios"]?.sessions).toBe(2);
    expect(r.byPlatform["android"]?.games).toBe(1);
    expect(r.byPlatform["desktop"]?.installs_active).toBe(2);
    expect(r.byPlatform["other"]?.sessions).toBe(0);
    expect(r.byPlatform["other"]?.games_per_session).toBeNull();
    expect(r.byLang["en"]?.sessions).toBe(3);
  });

  it("topErrors / version / vitals / windows", async () => {
    const r = await report();
    expect(r.version).toBe("abc1234");
    expect(r.topErrors).toEqual([
      {
        stackHash: "3fa9",
        message: "TypeError: x",
        n: 14,
        nRecent: 5,
        firstVersion: "abc1234",
        isNew: true,
        rising: true,
      },
    ]);
    expect(r.vitals).toEqual({ lcp_p75: 1025, inp_p75: null, cls_p75: 0.0125 });
    expect(r.windows["d1"]).toEqual({ from: "2026-10-14T00:00:00Z", to: "2026-10-15T00:00:00Z" });
    expect(r.experiment).toBeNull();
  });

  it("サンプリング: w=10 の install は 10 件として数える", async () => {
    const weighted = SESSIONS.map((s) => (s["install"] === B ? { ...s, w: 10 } : s));
    const raw = await pullRaw(fakeApi({ sessions: weighted }).fetcher, {
      fromMs: day("2026-10-01") * 1000,
      toMs: day("2026-10-15") * 1000,
      recentFromMs: day("2026-10-14") * 1000,
    });
    const r = buildReport(raw, {
      date: "2026-10-15",
      days: 14,
      nowMs: NOW,
      experiment: null,
    }).report;
    expect(r.overall["d14"]?.sessions).toBe(14);
    expect(r.overall["d14"]?.games).toBe(15);
    expect(r.overall["d14"]?.installs_active).toBe(13);
    expect(r.sampling.maxSampleInterval).toBe(10);
    // コホート: A(w=1, 再訪)と B(w=10, 未再訪) → 1 / 11
    expect(r.overall["d14"]?.d1_return).toBe(0.0909);
  });

  it("d1Return は 1 日目のセッションがない install を数えない", () => {
    const rows = mergeSessions([]);
    const data = {
      sessions: [],
      firstSeen: new Map([[A, day("2026-10-12") * 1000]]),
      durations: [],
      scores: [],
      vitals: [],
      errors: [],
      version: "",
    };
    expect(d1Return(data, rows, { fromMs: 0, toMs: day("2026-10-15") * 1000 })).toBeNull();
  });
});

describe("runPull(端から端まで)", () => {
  const writeJson = (name: string, v: unknown): string => {
    const p = join(tmp, name);
    writeFileSync(p, JSON.stringify(v), "utf8");
    return p;
  };

  it("稼働中の実験があれば arms と installs.json を書く", async () => {
    const out = join(tmp, "out-exp");
    const opts = parseArgs(
      ["--date", "2026-10-15", "--out", out, "--experiments", writeJson("exp.json", EXPERIMENTS)],
      NOW,
    );
    const res = await runPull(opts, fakeApi().fetcher, NOW);
    expect(res.code).toBe(0);
    expect(res.written.map((p) => p.slice(out.length + 1))).toEqual([
      "2026-10-15.json",
      "2026-10-15-installs.json",
    ]);

    const r = JSON.parse(readFileSync(join(out, "2026-10-15.json"), "utf8")) as MetricsReport;
    expect(r.experiment?.days).toBe(3);
    expect(r.experiment?.arms["control"]).toEqual({
      installs: 1,
      sessions: 2,
      games: 5,
      games_per_session: { mean: 2.5, sd: null },
      crash_free: 0.5,
      median_game_seconds: 182.5,
      abandon_rate: 0.2,
    });
    expect(r.experiment?.arms["treatment"]?.games_per_session.mean).toBe(1);

    const installs = JSON.parse(readFileSync(join(out, "2026-10-15-installs.json"), "utf8"));
    expect(installs.experiment).toBe("EXP-0001");
    expect(
      installs.rows.map((x: R) => [x["install"], x["variant"], x["sessions"], x["games"]]),
    ).toEqual([
      [A, "control", 2, 5],
      [B, "treatment", 1, 1],
    ]);
  });

  it("実験の開始が窓より前なら、取得範囲を開始日まで広げる", async () => {
    const early = structuredClone(EXPERIMENTS);
    (early.experiments[0] as { startedAt: string }).startedAt = "2026-09-20T08:00:00Z";
    const api = fakeApi();
    const opts = parseArgs(
      [
        "--date",
        "2026-10-15",
        "--out",
        join(tmp, "out-early"),
        "--experiments",
        writeJson("early.json", early),
      ],
      NOW,
    );
    await runPull(opts, api.fetcher, NOW);
    expect(api.sql[0]).toContain("timestamp >= toDateTime('2026-09-20 00:00:00')");
  });

  it("session が 0 件なら exit 1 でファイルを書かない", async () => {
    const out = join(tmp, "out-empty");
    const opts = parseArgs(
      [
        "--date",
        "2026-10-15",
        "--out",
        out,
        "--experiments",
        writeJson("none.json", { schemaVersion: 1, experiments: [] }),
      ],
      NOW,
    );
    const res = await runPull(opts, fakeApi({ sessions: [] }).fetcher, NOW);
    expect(res.code).toBe(1);
    expect(res.written).toEqual([]);
    expect(res.message).toContain("session が 0 件");
  });

  it("引数の検証", () => {
    expect(() => parseArgs(["--days", "3"], NOW)).toThrow("7〜90");
    expect(() => parseArgs(["--date", "2026-13-01"], NOW)).toThrow("日付");
    expect(() => parseArgs(["--bogus"], NOW)).toThrow("不明な引数");
    expect(parseArgs([], NOW).date).toBe("2026-10-15");
  });
});

describe("runner", () => {
  it("queryPaged は 1 ページが満杯なら次のページを取りに行く", async () => {
    const offsets: string[] = [];
    const row = JSON.stringify({ a: 1 });
    const full = Array(PAGE_SIZE).fill(row).join("\n");
    const rows = await queryPaged(
      async (q) => {
        const offset = /OFFSET (\d+)/.exec(q)?.[1] ?? "?";
        offsets.push(offset);
        return offset === "0" ? full : `${row}\n${row}`;
      },
      "SELECT 1 AS a FROM hamaru_events",
      "a",
    );
    expect(offsets).toEqual(["0", String(PAGE_SIZE)]);
    expect(rows).toHaveLength(PAGE_SIZE + 2);
  });

  it("cloudflareFetcher は SQL を本文に、トークンを Bearer で送る", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fake = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response('{"x":1}', { status: 200 });
    }) as unknown as typeof fetch;
    const text = await cloudflareFetcher("acc123", "tok", fake)("SELECT 1");
    expect(text).toBe('{"x":1}');
    expect(calls[0]?.url).toBe(
      "https://api.cloudflare.com/client/v4/accounts/acc123/analytics_engine/sql",
    );
    expect(calls[0]?.init.method).toBe("POST");
    expect(calls[0]?.init.body).toBe("SELECT 1");
    expect((calls[0]?.init.headers as Record<string, string>)["Authorization"]).toBe("Bearer tok");
  });

  it("cloudflareFetcher は失敗応答で SqlApiError を投げる", async () => {
    const fake = (async () => new Response("bad auth", { status: 403 })) as unknown as typeof fetch;
    await expect(cloudflareFetcher("a", "t", fake)("SELECT 1")).rejects.toBeInstanceOf(SqlApiError);
  });
});

describe("CLI", () => {
  const run = (args: string[], env: NodeJS.ProcessEnv) => {
    try {
      const stdout = execFileSync("npx", ["tsx", "scripts/metrics-pull.ts", ...args], {
        cwd: repoRoot,
        encoding: "utf8",
        env,
        stdio: ["ignore", "pipe", "pipe"],
      });
      return { code: 0, output: stdout };
    } catch (e) {
      const err = e as { status?: number; stdout?: string; stderr?: string };
      return { code: err.status ?? 1, output: `${err.stdout ?? ""}${err.stderr ?? ""}` };
    }
  };
  const baseEnv = (): NodeJS.ProcessEnv => {
    const env = { ...process.env };
    delete env["CLOUDFLARE_API_TOKEN"];
    delete env["CLOUDFLARE_ACCOUNT_ID"];
    delete env["GITHUB_OUTPUT"];
    return env;
  };

  it("認証情報が無ければ理由を出して exit 1", () => {
    const r = run(["--date", "2026-10-15", "--out", join(tmp, "cli")], baseEnv());
    expect(r.code).toBe(1);
    expect(r.output).toContain("CLOUDFLARE_API_TOKEN と CLOUDFLARE_ACCOUNT_ID が必要です");
  }, 60_000);

  it("--dry-run は認証なしで SQL を表示する", () => {
    const r = run(["--dry-run", "--date", "2026-10-15"], baseEnv());
    expect(r.code).toBe(0);
    expect(r.output).toContain("FROM hamaru_events");
    expect(r.output).toContain("FORMAT JSONEachRow");
  }, 60_000);
});
