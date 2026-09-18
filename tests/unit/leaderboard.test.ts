/**
 * ランキング API(docs/08)。wrangler の getPlatformProxy で**本物の(ローカルの)D1** を立て、
 * migrations/ の SQL を適用してから、Worker のハンドラを SQL ごと検証する。
 *
 * デイリーの手の列は sim の greedy / random ボットで実際に遊んで作る(= 本物の手)。
 */
import { readdirSync, readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getPlatformProxy } from "wrangler";
import { DEFAULT_CONFIG, DEFAULT_EXPERIMENTS, resolveConfig } from "../../src/config";
import { dailySeed } from "../../src/core/daily";
import { newGame, place } from "../../src/core/game";
import { createRng } from "../../src/core/rng";
import type { Move } from "../../src/core/replay";
import { greedyBot } from "../../sim/bots/greedy";
import { randomBot } from "../../sim/bots/random";
import type { Bot } from "../../sim/bots/types";
import {
  handleDelete,
  handleMe,
  handleProfile,
  handleSubmit,
  handleTop,
  sha256Hex,
  type Db,
  type LeaderboardEnv,
} from "../../worker/leaderboard";
import { matchKey, normalizeNickname } from "../../worker/nickname";

const ORIGIN = "https://hamaru.example.workers.dev";
const A = "aaaaaaaa-0000-4000-8000-000000000001";
const B = "bbbbbbbb-0000-4000-8000-000000000002";
const C = "cccccccc-0000-4000-8000-000000000003";

/** 2026-10-15(木)12:00 UTC。ISO 週は 2026-W42、月は 2026-10。 */
const NOW = Date.parse("2026-10-15T12:00:00Z");
const DAY = 86_400_000;

let proxy: Awaited<ReturnType<typeof getPlatformProxy>>;
let db: Db;
let env: LeaderboardEnv;

beforeAll(async () => {
  proxy = await getPlatformProxy({
    configPath: "tests/fixtures/wrangler.d1-test.jsonc",
    persist: false,
  });
  db = (proxy.env as unknown as { DB: Db }).DB;
  for (const file of readdirSync("migrations").sort()) {
    const sql = readFileSync(`migrations/${file}`, "utf8")
      .split("\n")
      .filter((l) => !l.trim().startsWith("--"))
      .join("\n");
    for (const stmt of sql
      .split(";")
      .map((s) => s.trim())
      .filter((s) => s !== "")) {
      await db.prepare(stmt).run();
    }
  }
  env = { DB: db };
}, 60_000);

afterAll(async () => {
  await proxy?.dispose();
});

beforeEach(async () => {
  await db.batch([
    db.prepare("DELETE FROM daily_scores"),
    db.prepare("DELETE FROM totals"),
    db.prepare("DELETE FROM players"),
  ]);
});

/* ------------------------------------------------------------------ */
/* 補助                                                                 */
/* ------------------------------------------------------------------ */

/** ボットにデイリーを最後まで遊ばせ、手の列と得点を返す。 */
function play(installId: string, date: string, bot: Bot): { moves: Move[]; score: number } {
  const config = resolveConfig(DEFAULT_CONFIG, DEFAULT_EXPERIMENTS, installId, "daily");
  let state = newGame(config, "daily", dailySeed(date), 0);
  const rng = createRng(`test:${installId}:${date}`);
  const moves: Move[] = [];
  while (state.status === "playing") {
    const m = bot.chooseMove(state, config, rng);
    if (m === null) break;
    moves.push([m.trayIndex, m.x, m.y]);
    state = place(state, config, m.trayIndex, m.x, m.y).state;
  }
  return { moves, score: state.score };
}

const post = (path: string, body: unknown, origin = ORIGIN): Request =>
  new Request(`${ORIGIN}${path}`, {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

const get = (query: string): Request => new Request(`${ORIGIN}/api/leaderboard${query}`);

async function submit(installId: string, date: string, moves: Move[], now = NOW, e = env) {
  const res = await handleSubmit(
    post("/api/daily/submit", { installId, date, moves, version: "t" }),
    e,
    now,
  );
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

type Ranks = Record<
  string,
  { rank: number | null; score: number | null; count: number; days?: number }
>;

/* ------------------------------------------------------------------ */
/* 送信                                                                 */
/* ------------------------------------------------------------------ */

describe("POST /api/daily/submit", () => {
  const TODAY = "2026-10-15";

  it("手の列を再生した得点で記録し、4 つの期間の順位を返す", async () => {
    const g = play(A, TODAY, greedyBot);
    const r = await submit(A, TODAY, g.moves);
    expect(r.status).toBe(200);
    expect(r.body["accepted"]).toBe(true);
    expect(r.body["score"]).toBe(g.score);
    const ranks = r.body["ranks"] as Ranks;
    expect(ranks["daily"]).toEqual({ rank: 1, score: g.score, count: 1 });
    expect(ranks["week"]).toEqual({ rank: 1, score: g.score, count: 1, days: 1 });
    expect(ranks["month"]?.rank).toBe(1);
    expect(ranks["all"]?.score).toBe(g.score);
  });

  it("同じ日の 2 件目は無視し、合計を二重に足さない", async () => {
    const g = play(A, TODAY, greedyBot);
    await submit(A, TODAY, g.moves);
    const lower = play(A, TODAY, randomBot);
    const r = await submit(A, TODAY, lower.moves);
    expect(r.body["accepted"]).toBe(false);
    expect(r.body["score"]).toBe(g.score);
    expect((r.body["ranks"] as Ranks)["all"]).toEqual({
      rank: 1,
      score: g.score,
      count: 1,
      days: 1,
    });
  });

  it("得点の高い順。同点は先に記録した人が上", async () => {
    const hi = play(A, TODAY, greedyBot);
    const lo = play(B, TODAY, randomBot);
    expect(hi.score).toBeGreaterThan(lo.score);
    await submit(B, TODAY, lo.moves, NOW);
    await submit(A, TODAY, hi.moves, NOW + 1000);
    // C は B と同じ手・同じ得点だが後から
    const tie = await submit(C, TODAY, lo.moves, NOW + 2000);
    expect((tie.body["ranks"] as Ranks)["daily"]).toEqual({ rank: 3, score: lo.score, count: 3 });
    const me = await handleMe(
      post("/api/leaderboard/me", { installId: B, period: "daily" }),
      env,
      NOW,
    );
    expect(((await me.json()) as { rank: number }).rank).toBe(2);
  });

  it("週・月・全期間は日をまたいで合計する(日数も数える)", async () => {
    const d1 = play(A, "2026-10-14", greedyBot);
    const d2 = play(A, TODAY, greedyBot);
    await submit(A, "2026-10-14", d1.moves, NOW - DAY);
    const r = await submit(A, TODAY, d2.moves, NOW);
    const ranks = r.body["ranks"] as Ranks;
    expect(ranks["week"]).toEqual({ rank: 1, score: d1.score + d2.score, count: 1, days: 2 });
    expect(ranks["all"]?.score).toBe(d1.score + d2.score);
    expect(ranks["daily"]?.score).toBe(d2.score);
  });

  it("月曜は新しい週になる(ISO 週)", async () => {
    const sun = play(A, "2026-10-18", greedyBot);
    const mon = play(A, "2026-10-19", greedyBot);
    await submit(A, "2026-10-18", sun.moves, Date.parse("2026-10-18T12:00:00Z"));
    const r = await submit(A, "2026-10-19", mon.moves, Date.parse("2026-10-19T12:00:00Z"));
    const ranks = r.body["ranks"] as Ranks;
    expect(ranks["week"]?.score).toBe(mon.score);
    expect(ranks["month"]?.score).toBe(sun.score + mon.score);
  });

  it("昨日の日付は受け付け、2 日前は 400", async () => {
    const y = play(A, "2026-10-14", greedyBot);
    expect((await submit(A, "2026-10-14", y.moves)).status).toBe(200);
    const old = play(B, "2026-10-13", greedyBot);
    expect((await submit(B, "2026-10-13", old.moves)).body).toEqual({ error: "date" });
  });

  it("不正な手は 422、途中で終わった手の列は 400", async () => {
    const g = play(A, TODAY, greedyBot);
    const broken = g.moves.map((m, i) => (i === 3 ? ([m[0], 11, 11] as Move) : m));
    const bad = await submit(A, TODAY, broken);
    expect(bad.status).toBe(422);
    expect(bad.body["error"]).toBe("invalid_move");
    const partial = await submit(A, TODAY, g.moves.slice(0, 5));
    expect(partial.body).toEqual({ error: "not_finished" });
    const extra = await submit(A, TODAY, [...g.moves, [0, 0, 0]]);
    expect(extra.body["error"]).toBe("moves_after_end");
  });

  it("別の日の手の列を今日として送っても通らない(シードが違う)", async () => {
    const y = play(A, "2026-10-14", greedyBot);
    const r = await submit(A, TODAY, y.moves);
    expect([400, 422]).toContain(r.status);
  });

  it("本文の検証: Origin 403 / 巨大 413 / 形 400", async () => {
    const g = play(A, TODAY, greedyBot);
    const body = { installId: A, date: TODAY, moves: g.moves, version: "t" };
    expect(
      (await handleSubmit(post("/api/daily/submit", body, "https://evil.example"), env, NOW))
        .status,
    ).toBe(403);
    expect(
      (await handleSubmit(post("/api/daily/submit", "x".repeat(40_000)), env, NOW)).status,
    ).toBe(413);
    expect(
      (await handleSubmit(post("/api/daily/submit", { ...body, installId: "nope" }), env, NOW))
        .status,
    ).toBe(400);
    expect(
      (await handleSubmit(post("/api/daily/submit", { ...body, moves: [[3, 0, 0]] }), env, NOW))
        .status,
    ).toBe(400);
  });

  it("LEADERBOARD=off(プレビュー)は検証だけして書かない", async () => {
    const g = play(A, TODAY, greedyBot);
    const r = await submit(A, TODAY, g.moves, NOW, { ...env, LEADERBOARD: "off" });
    expect(r.body).toMatchObject({ accepted: false, preview: true, score: g.score });
    const n = await db.prepare("SELECT COUNT(*) AS n FROM daily_scores").first<{ n: number }>();
    expect(n?.n).toBe(0);
  });

  it("installId そのものは保存しない(SHA-256 だけ)", async () => {
    await submit(A, TODAY, play(A, TODAY, greedyBot).moves);
    const row = await db.prepare("SELECT player FROM daily_scores").first<{ player: string }>();
    expect(row?.player).toBe(await sha256Hex(A));
    expect(row?.player).not.toContain("aaaaaaaa");
  });
});

/* ------------------------------------------------------------------ */
/* 順位表・自分の順位                                                    */
/* ------------------------------------------------------------------ */

describe("GET /api/leaderboard と POST /api/leaderboard/me", () => {
  it("上位を得点順に返し、名前は自動の匿名名かニックネーム。ID は返さない", async () => {
    const TODAY = "2026-10-15";
    await submit(A, TODAY, play(A, TODAY, greedyBot).moves);
    await submit(B, TODAY, play(B, TODAY, randomBot).moves);
    await handleProfile(post("/api/profile", { installId: B, nickname: "こはる" }), env, NOW);

    const res = await handleTop(get("?period=daily"), env, NOW);
    expect(res.headers.get("cache-control")).toBe("public, max-age=30");
    const body = (await res.json()) as {
      key: string;
      count: number;
      top: Array<Record<string, unknown>>;
    };
    expect(body.key).toBe(TODAY);
    expect(body.count).toBe(2);
    expect(body.top.map((r) => r["rank"])).toEqual([1, 2]);
    expect(body.top[0]?.["name"]).toMatchObject({ auto: expect.any(Array) });
    expect(body.top[1]?.["name"]).toEqual({ nickname: "こはる" });
    expect(JSON.stringify(body)).not.toMatch(/aaaaaaaa|bbbbbbbb|player/);
  });

  it("週の順位表は合計と日数", async () => {
    await submit(A, "2026-10-14", play(A, "2026-10-14", greedyBot).moves, NOW - DAY);
    await submit(A, "2026-10-15", play(A, "2026-10-15", greedyBot).moves, NOW);
    const body = (await (await handleTop(get("?period=week"), env, NOW)).json()) as {
      key: string;
      top: Array<{ days: number }>;
    };
    expect(body.key).toBe("2026-W42");
    expect(body.top[0]?.days).toBe(2);
  });

  it("期間やキーの形が違えば 400、記録がなければ空", async () => {
    expect((await handleTop(get("?period=year"), env, NOW)).status).toBe(400);
    expect((await handleTop(get("?period=week&key=2026-10"), env, NOW)).status).toBe(400);
    const empty = (await (await handleTop(get("?period=all"), env, NOW)).json()) as {
      count: number;
      top: unknown[];
    };
    expect(empty).toMatchObject({ count: 0, top: [] });
  });

  it("記録のない人の自分の順位は null(名前は返す)", async () => {
    const res = await handleMe(
      post("/api/leaderboard/me", { installId: C, period: "month" }),
      env,
      NOW,
    );
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ period: "month", key: "2026-10", rank: null, count: 0 });
    expect(body["name"]).toMatchObject({ auto: expect.any(Array) });
  });
});

/* ------------------------------------------------------------------ */
/* ニックネーム・削除                                                    */
/* ------------------------------------------------------------------ */

describe("POST /api/profile と /api/profile/delete", () => {
  const set = (nickname: string | null, now = NOW, installId = A) =>
    handleProfile(post("/api/profile", { installId, nickname }), env, now);

  it("設定・60 秒の間隔・null で自動名に戻す", async () => {
    const ok = await set("  ろくろ　名人 ");
    expect(await ok.json()).toEqual({ name: { nickname: "ろくろ 名人" } });
    const tooSoon = await set("別の名前", NOW + 10_000);
    expect(tooSoon.status).toBe(429);
    const reset = await set(null, NOW + 61_000);
    expect(((await reset.json()) as { name: unknown }).name).toMatchObject({
      auto: expect.any(Array),
    });
  });

  it("不正な名前は 400(invalid / banned)", async () => {
    expect(await (await set("x")).json()).toEqual({ error: "invalid" });
    expect(await (await set("http://spam")).json()).toEqual({ error: "invalid" });
    expect(await (await set("公式スタッフ")).json()).toEqual({ error: "banned" });
  });

  it("削除すると本人の行が消え、他の人の順位が繰り上がる", async () => {
    const TODAY = "2026-10-15";
    await submit(A, TODAY, play(A, TODAY, greedyBot).moves);
    await submit(B, TODAY, play(B, TODAY, randomBot).moves);
    const res = await handleDelete(post("/api/profile/delete", { installId: A }), env);
    expect(res.status).toBe(204);
    const me = await handleMe(
      post("/api/leaderboard/me", { installId: B, period: "all" }),
      env,
      NOW,
    );
    expect(await me.json()).toMatchObject({ rank: 1, count: 1 });
    for (const table of ["daily_scores", "totals", "players"]) {
      const n = await db
        .prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE player = ?1`)
        .bind(await sha256Hex(A))
        .first<{ n: number }>();
      expect(n?.n, table).toBe(0);
    }
  });
});

describe("normalizeNickname", () => {
  it.each([
    ["ab", true],
    ["あいうえおかきくけこさし", true], // 12 文字
    ["あいうえおかきくけこさしす", false], // 13 文字
    ["名前_2-ー・x", true],
    ["a.b", false],
    ["a@b", false],
    ["😀😀", false],
    ["   ", false],
  ])("%s → %s", (input, ok) => {
    expect(normalizeNickname(input).ok).toBe(ok);
  });

  it("全角英数は半角に、カタカナの禁止語も弾く", () => {
    expect(normalizeNickname("ＡＢＣ１２")).toEqual({ ok: true, value: "ABC12" });
    expect(normalizeNickname("ウンコ太郎")).toEqual({ ok: false, error: "banned" });
    expect(normalizeNickname("F u c k")).toEqual({ ok: false, error: "banned" });
    expect(matchKey("Ｆ-u c・K")).toBe("fuck");
  });
});
