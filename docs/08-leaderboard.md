# 08. ランキング — HAMARU

2026-09-18 追加。v1 の「やらないこと」だったグローバルリーダーボード(docs/00 §5 v1.1)を実装する。
レベルモードは別の設計書で扱う(ランキングの対象外。ユーザー判断)。

## 1. 決めたこと(ユーザー判断 2026-09-18)

| 項目 | 決定 |
|---|---|
| ランキングの種類 | デイリー / ウィークリー / マンスリー / 全期間 |
| 順位の基準 | デイリー = その日のデイリーの得点。週・月・全期間 = **期間中のデイリー得点の合計** |
| 対象になる得点 | デイリーの**その日のベスト**(何度でも挑戦できる)。エンドレスは対象外 |
| 名前 | 既定は**自動の匿名名**(例「青磁の陶工 4821」)。任意で**ニックネーム**を付けられる |

合計にしたのは、毎日遊ぶほど上がる仕組みが再訪(`d1_return`)に効くため。エンドレスは人ごとに問題が違い、
実験で設定も変わるので、公平な比較と得点の検証ができない。

**2026-09-21 の変更(ユーザー判断)**: 当初は「その日の初回だけが公式」だった。
ブロックパズルのランキングは「ベストスコア・回数無制限」が定石で、1 回で終わる作りは
繰り返し遊ぶ動機を消してしまう(順位の付くデイリーは 1 回で終わり、何度でも遊べるエンドレスには
順位が無い、という状態だった)。**その日のベスト**に変え、挑戦回数も表示する。
代わりに「同じ盤を繰り返して詰める」遊びに性格が変わることは受け入れる。

## 2. 得点の検証(不正対策の中心)

クライアントは得点を送らない。**置いた手の列**を送り、Worker が core の `replay()`(`src/core/replay.ts`)で
同じゲームを再生して得点を確定する。

- シードは `daily:<日付>` で全員共通。config は `resolveConfig(DEFAULT_CONFIG, DEFAULT_EXPERIMENTS, installId, "daily")`
  をクライアントと同じ関数で解決する(Worker は同じ JSON をバンドルしている)
- 受け付けるのは**ゲームオーバーまで打ち切った手の列**だけ(途中の手の列は 400)
- 日付は UTC の**今日か昨日**だけ(日付をまたいで遊んだ人のための猶予。docs/01 §13)
- 1 人 1 日 **1 行**。送信のたびに `attempts` を 1 増やし、**それまでのベストより高いときだけ**
  得点・消去数・手数・時刻を差し替える。同点なら**先に達した方**を残す(順位の同点処理と揃える)
- 合計(`totals`)は **「今回の得点 − それまでのその日のベスト」** だけ足す。
  日数(`days`)はその日の初回だけ増やす。更新前の値を読む必要があるので、
  SQL は「合計の更新 → その日の行の更新」の順に並べる(1 つの `batch` = 1 トランザクション)
- 1 日の送信は **50 回まで**(`MAX_ATTEMPTS_PER_DAY`)。超えたら 429 `too_many_attempts`。
  再生の CPU と D1 の書き込みを守るための上限で、普通に遊ぶ分には当たらない
- 手の数の上限は 2000(`MAX_REPLAY_MOVES`)。本文の上限は 32 KB
- 計測: 最長の greedy ボットのデイリー(161 手)の再生は 0.24 ms(M シリーズ Mac)。Workers 無料枠の CPU 10 ms に十分収まる
- クライアントとサーバの版がずれて再生結果が合わない(ルール変更の直後など)と、手が不正になり 422。
  クライアントは「この記録は送信できませんでした」と出す。デイリーのルール変更は golden で人間承認なので稀

残るリスク: 正しく遊んだ手の列を**ボットで作る**ことは防げない(ボットは本物のゲームを解いているだけなので、
得点としては正しい)。上位がボットで埋まったら、週次レトロで人間に判断を仰ぐ(§8)。

## 3. 識別子とプライバシー

- サーバに保存する識別子は `player = SHA-256(installId)` の 16 進。installId そのものは保存しない
- API は player も installId も**返さない**。順位表に出るのは名前と得点だけ
- 名前: ニックネームがあればそれ、無ければ player から決まる**自動の匿名名**
  (形容の番号・職の番号・4 桁の数。表示の言語はクライアントが決める。§5)
- 参加は既定で ON。設定の「ランキングに参加する」を OFF にすると送信しない
- 設定の「データを削除」は、ランキングに参加したことがあればサーバのデータ(player の全行)も削除する
- テレメトリ(Analytics Engine)とは別のデータ。About 画面に追記する(§7)

## 4. データ(Cloudflare D1、`hamaru`)

```sql
CREATE TABLE players (
  player      TEXT PRIMARY KEY,   -- SHA-256(installId) の 16 進
  nickname    TEXT,               -- NULL なら自動の匿名名
  nickname_at INTEGER,            -- ニックネームを最後に変えた時刻(epoch ms)
  created_at  INTEGER NOT NULL
);

CREATE TABLE daily_scores (
  date          TEXT NOT NULL,    -- YYYY-MM-DD(UTC)
  player        TEXT NOT NULL,
  score         INTEGER NOT NULL, -- その日のベスト
  lines         INTEGER NOT NULL, -- ベストを出した回の消去数
  moves         INTEGER NOT NULL,
  submission_id TEXT NOT NULL,    -- ベストを出した送信の乱数
  submitted_at  INTEGER NOT NULL, -- ベストに達した時刻(同点はこれが早い方が上)
  attempts      INTEGER NOT NULL DEFAULT 1,  -- その日の送信回数(migrations/0002)
  PRIMARY KEY (date, player)
);
CREATE INDEX daily_rank_v2 ON daily_scores (date, score DESC, submitted_at);

CREATE TABLE totals (
  period     TEXT NOT NULL,       -- 'week' | 'month' | 'all'
  key        TEXT NOT NULL,       -- '2026-W38' | '2026-09' | 'all'
  player     TEXT NOT NULL,
  total      INTEGER NOT NULL,
  days       INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (period, key, player)
);
CREATE INDEX totals_rank_v2 ON totals (period, key, total DESC, updated_at);
```

**記録は 2026-09-24 に仕切り直した**(`migrations/0003`)。ルールを逆手に全面刷新したので、
旧ルールの得点は新しい得点と比べられず、手の形式も `[トレイ, x, y]` → `[x, y]` に変わって
**サーバで再生し直せない**。古い行は `daily_scores_v1` / `totals_v1` に残したまま脇へ寄せ、
空の表から始めている。`players`(ニックネーム)はそのまま引き継ぐ — 名前は本人のもので、
ルールとは関係ないため。索引は旧表に名前が付いたままなので、新しい表は `*_v2` を使う。

- 週は **ISO 週**(月曜始まり、UTC)、月は UTC の暦月。キーはデイリーの**日付**から決める(送信時刻ではない)
- 送信は 1 回の `batch`(トランザクション)で、**この順に**実行する:
  1. その日が初めてなら `totals` に丸ごと足す(`WHERE NOT EXISTS (その日の行)`、`days + 1`)
  2. すでに行があって今回が高いなら、`total + 今回 − その日のベスト` に更新する(日数は増やさない)
  3. `daily_scores` を upsert(`attempts + 1`、高いときだけ得点などを差し替え)
  4. `players` に `INSERT … ON CONFLICT DO NOTHING`
  1・2 は**更新前の**その日の得点を読むので、必ず 3 より前に置く
- 順位 = 自分より得点(合計)が高い人数 + 1。同点は**先に達した人**が上(`submitted_at` / `updated_at`)
- 無料枠: 書き込み 10 万行/日(1 送信 = 最大 5 行)、読み取り 500 万行/日。順位表は 30 秒キャッシュする

## 5. 名前

### 5.1 自動の匿名名
player(16 進)の先頭から: 形容 = `hex[0..2] % 16`、職 = `hex[2..4] % 8`、番号 = `hex[4..8] % 10000`。
文言は i18n(`name.adj.<n>` / `name.noun.<n>`)で、釉薬と焼き物にちなむ(docs/03 の世界観)。

| # | 形容(ja / en) | # | 職(ja / en) |
|---|---|---|---|
| 0 | 柿 / Persimmon | 0 | 陶工 / Potter |
| 1 | 青磁 / Celadon | 1 | 窯守 / Kiln keeper |
| 2 | 黄瀬戸 / Kiseto | 2 | 絵付師 / Painter |
| 3 | 藤 / Wisteria | 3 | 轆轤師 / Thrower |
| 4 | 紅 / Crimson | 4 | 釉掛け / Glazer |
| 5 | 瑠璃 / Lapis | 5 | 目利き / Connoisseur |
| 6 | 天目 / Tenmoku | 6 | 窯元 / Kiln master |
| 7 | 志野 / Shino | 7 | 金継ぎ師 / Kintsugi artist |
| 8 | 織部 / Oribe | | |
| 9 | 備前 / Bizen | | |
| 10 | 萩 / Hagi | | |
| 11 | 唐津 / Karatsu | | |
| 12 | 信楽 / Shigaraki | | |
| 13 | 九谷 / Kutani | | |
| 14 | 伊万里 / Imari | | |
| 15 | 白磁 / White porcelain | | |

表示: ja「青磁の陶工 4821」/ en「Celadon Potter 4821」。

### 5.2 ニックネーム
- NFKC 正規化 → 前後の空白を除き、連続する空白を 1 つに
- 長さ 2〜12 文字(コードポイント)。使える文字は文字・数字・空白・`_` `-` `・` `ー`
- URL・メールアドレスに見えるものは不可。禁止語(`worker/nickname.ts` の短い一覧。記号と空白を除いて小文字で照合)を含むものは不可
- 変更は 60 秒に 1 回まで。空にすると自動の匿名名に戻る
- 監視と通報の仕組みは v1 では作らない。不適切な名前は人間が消す:
  ```bash
  npx wrangler d1 execute hamaru --remote --command "UPDATE players SET nickname = NULL WHERE nickname = '<名前>'"
  ```

## 6. API(Worker)

installId は URL に載せない(本文で送る)。すべて同一オリジンのみ(Origin 検査。`/api/events` と同じ)。

| メソッド・パス | 本文 / クエリ | 応答 |
|---|---|---|
| `POST /api/daily/submit` | `{ installId, date, moves: [[t,x,y], …], version }` | 200 `{ accepted, improved, score, best, attempts, lines, ranks }`。`score` は今回、`best` はその日のベスト。400 本文不正 / 422 再生不一致 / 429 その日の上限 |
| `GET /api/leaderboard?period=daily\|week\|month\|all&key=<任意>` | key 省略時は今日・今週・今月・all | 200 `{ period, key, count, top: [{ rank, name, score, days? }] }`(上位 50)。`cache-control: max-age=30` |
| `POST /api/leaderboard/me` | `{ installId, period, key? }` | 200 `{ rank, score, count, name }` または `{ rank: null }` |
| `POST /api/profile` | `{ installId, nickname: string \| null }` | 200 `{ name }` / 400 `{ error: "invalid" \| "banned" }` / 429 |
| `POST /api/profile/delete` | `{ installId }` | 204(player の全行を削除) |

`name` の形は `{ nickname: string } | { auto: [adj, noun, num] }`。表示はクライアントが言語に合わせて組み立てる。
`ranks` は `{ daily, week, month, all }` で、それぞれ `{ rank, score, count }`。
デイリーには `attempts`(その日の挑戦回数)、週・月・全期間には `days`(記録のある日数)が付く。
`GET /api/leaderboard?period=daily` の各行にも `attempts` が入る。

PR プレビュー(`LEADERBOARD=off`)では書き込み系が本番の D1 に書かない(送信は検証だけして `preview: true` を返す)。

## 7. 画面

- **ゲームオーバー(デイリー)**: 送信して「今日 12 位 / 348 人」と、
  「自己ベスト更新(3 回目)」または「今日のベスト 1,224(3 回目)」を出す。送信中は「記録しています…」、
  失敗時は「ランキングに記録できませんでした」(ゲーム結果そのものは端末に保存済み)。
  「ランキングを見る」と「もう一度挑戦」ボタン
- **ホームのデイリーカード**: 「ランキング」ボタン
- **ランキング画面 `#/ranking`**: タブ「今日 / 今週 / 今月 / 全期間」、上位 50、自分の行を強調、自分の順位(圏外でも)、
  自分の名前と「名前を変える」。読み込み中・空(「まだ記録がありません。今日の挑戦で最初の記録を」)・オフライン・失敗の状態
- **設定**: 「ランキングに参加する」(既定 ON)、「ニックネーム」(ランキング画面から開く)
- **About**: ランキングに保存するもの(匿名化した端末 ID、ニックネーム、デイリーの得点)を追記

## 8. 改善ループとの関係

- `worker/` と D1 のスキーマ(`migrations/`)は human-only のまま。エージェントは画面・文言だけ触れる
- 週次レトロで、上位の得点がボットらしい(全員より極端に高い・毎日同じ手数)ときは「人間に判断を仰ぎたいこと」に挙げる
- 効果の測り方: 公開前後の `d1_return`・`daily_start_rate`・`games` を比べる(実験ではなく導入前後の比較。
  全員に同時に出す機能なので A/B にしない)

## 9. 運用

- D1 の作成(1 回): `npx wrangler d1 create hamaru` → 出力の `database_id` を `wrangler.jsonc` に書く
- マイグレーション: `npx wrangler d1 migrations apply hamaru --remote`。deploy.yml はデプロイ前にこれを実行する
  (API トークンに **Account › D1: Edit** が要る。docs/07 §5 N-7)
