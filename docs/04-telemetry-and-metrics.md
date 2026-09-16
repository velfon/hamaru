# 04. テレメトリと指標 — HAMARU

改善ループの「目」。ここが曖昧だと改善は運任せになる。イベント定義・保存形式・集計 SQL・出力 JSON を 1:1 で固定する。

## 1. 原則

1. **匿名**: 個人を特定する情報は一切送らない。install ID はクライアント生成の乱数 UUID。
2. **集計値だけ送る**: 1 手ごとのイベントは送らない(量が増え、意味は薄い)。ゲーム単位の要約を送る。
3. **1 イベント = 1 データポイント**: Analytics Engine の `writeDataPoint` に 1:1 で対応。
4. **列の順番は固定**: AE は順序付き配列なので、`blobs` / `doubles` の意味は本書の表で固定し、**変更は追記のみ**(既存の位置を変えない)。
5. **実験は全イベントに刻む**: `exp` / `variant` が無いイベントは分析できない。

## 2. 共通フィールド(全イベント)

| 名前 | 型 | 内容 |
|---|---|---|
| `event` | string | イベント名(§3) |
| `installId` | uuid | 匿名インストール ID |
| `sessionId` | string | セッション ID(起動ごと。30 分無操作で更新) |
| `ts` | number | クライアント時刻 epoch ms(参考。集計は AE の `timestamp` を使う) |
| `version` | string | アプリバージョン(git sha 短縮 7 桁) |
| `lang` | `ja` / `en` | 表示言語 |
| `platform` | string | `ios` / `android` / `desktop` / `other`(UA から粗く) |
| `exp` | string | 稼働中の実験 ID。無ければ `""` |
| `variant` | string | `control` / `treatment` / `""` |
| `mode` | string | `endless` / `daily` / `""` |

## 3. イベント一覧

| event | 発火タイミング | 固有フィールド |
|---|---|---|
| `session_start` | 起動、または 30 分無操作後の復帰 | `ref`: `direct` / `share` / `pwa` / `other`(URL `?r=` と `display-mode`) |
| `game_start` | 新規ゲーム開始 | `resumed`: 0/1、`isPractice`: 0/1 |
| `game_end` | ゲームオーバー、または「はじめから」で破棄 | `reason`: `over` / `abandon`、`score`、`lines`、`moves`、`durationMs`(アクティブ時間のみ。非表示中は止める)、`round`、`longestStreak`、`isPractice`、`fillRatioAtEnd` |
| `daily_result` | デイリーの公式記録確定(初回のみ) | `dailyNo`、`score`、`lines` |
| `share` | 共有ボタン押下 | `method`: `share` / `copy` |
| `error` | `window.onerror` / `unhandledrejection` / config フォールバック | `message`(先頭 200 文字)、`stackHash`(cyrb53 の 16 進)、`kind`: `js` / `promise` / `config` |
| `vital` | web-vitals 計測 | `name`: `LCP` / `INP` / `CLS`、`value` |

**送らないもの**: 1 手ごとの操作、ドラッグ座標、盤面の内容、IP、正確な UA。

## 4. Analytics Engine への写像

Dataset: `hamaru_events`。Worker 側で以下に詰め替える(`worker/events.ts`)。

| AE 列 | 内容 |
|---|---|
| `index1` | `installId`(**サンプリング単位が install になる**。ユーザ単位の分析が壊れない) |
| `blob1` | `event` |
| `blob2` | `sessionId` |
| `blob3` | `version` |
| `blob4` | `lang` |
| `blob5` | `platform` |
| `blob6` | `country`(`request.cf.country`。Worker が付与) |
| `blob7` | `exp` |
| `blob8` | `variant` |
| `blob9` | `mode` |
| `blob10` | イベント固有の文字列 1(`ref` / `reason` / `method` / `message` / `name`) |
| `blob11` | イベント固有の文字列 2(`stackHash` / `kind`) |
| `double1` | `score` |
| `double2` | `lines` |
| `double3` | `moves` |
| `double4` | `durationMs` |
| `double5` | `round` |
| `double6` | `longestStreak` |
| `double7` | `isPractice`(0/1) |
| `double8` | `resumed`(0/1) |
| `double9` | `fillRatioAtEnd` |
| `double10` | `dailyNo` |
| `double11` | `value`(vital) |
| `double12` | `ts` |

未使用の位置は `""` / `0` で埋める(順序固定のため)。

### 制限との整合(2026-09 時点の Cloudflare ドキュメント)
- 1 データポイント: blob 20 個・double 20 個・index 1 個まで、blob 合計 16 KB、index 96 バイト。→ 本設計は blob 11、double 12。
- 1 リクエストで 250 点まで書き込み可。→ `/api/events` は 20 件上限。
- 無料枠: 書き込み 10 万点/日、SQL 読み取り 1 万クエリ/日。保持 3 ヶ月。
- 高負荷時は index 単位でサンプリングされ `_sample_interval` に倍率が入る。**全ての集計は `_sample_interval` で重み付け**する。

## 5. 指標定義(メトリクス ID)

改善ループが参照する指標は **ID で固定**し、`scripts/metrics-pull.ts` が全て計算する。

| ID | 定義 | 単位 | 方向 |
|---|---|---|---|
| `sessions` | `session_start` の重み付き件数 | 件 | 情報 |
| `installs_active` | 期間内に `session_start` を送った install 数 | 件 | 情報 |
| `installs_new` | 期間内が初回 `session_start` の install 数(直近 90 日で判定) | 件 | ↑ |
| `games` | `game_end`(`isPractice=0`)の件数 | 件 | ↑(北極星) |
| `games_per_session` | `games / sessions` | 比 | ↑ |
| `median_game_seconds` | `game_end.durationMs / 1000` の重み付き中央値(`reason=over`) | 秒 | 帯域 |
| `median_score` | `game_end.score` の中央値 | 点 | 帯域 |
| `p90_score` | 90 パーセンタイル | 点 | 情報 |
| `abandon_rate` | `reason=abandon` / 全 `game_end` | 比 | ↓ |
| `session_minutes_median` | セッション内 `game_end.durationMs` 合計の中央値 | 分 | ↑ |
| `d1_return` | 日 D に初回 session の install のうち、D+1 に session がある割合(D は期間の各日、当日除く) | 比 | ↑ |
| `daily_start_rate` | `game_start(mode=daily)` を送った install / `installs_active` | 比 | ↑ |
| `daily_completion` | `daily_result` install 数 / `game_start(mode=daily, isPractice=0)` install 数 | 比 | ↑ |
| `share_rate` | `share` 件数 / `daily_result` 件数 | 比 | ↑ |
| `crash_free` | `error` を含まない session / 全 session | 比 | ↑(ガードレール) |
| `lcp_p75` / `inp_p75` / `cls_p75` | vital の 75 パーセンタイル | ms / ms / 値 | ↓ |

ガードレール指標(実験で必ず監視): `crash_free`、`median_game_seconds`(帯域 120〜600 秒)、`abandon_rate`。

## 6. SQL(`scripts/metrics-pull.ts` が発行する)

エンドポイント: `POST https://api.cloudflare.com/client/v4/accounts/<ACCOUNT_ID>/analytics_engine/sql`、`Authorization: Bearer <TOKEN>`(Account Analytics: Read)。本文はクエリ文字列。
**SQL の正本は `scripts/metrics/sql.ts`**。`npm run metrics:pull -- --dry-run` で実際に発行する SQL を表示できる。

### 6.1 方言(2026-09 に Cloudflare の SQL リファレンスで確認)
| 項目 | 使えるもの / 使えないもの |
|---|---|
| 構文 | `SELECT … FROM <table> または (<subquery>) WHERE GROUP BY HAVING ORDER BY LIMIT OFFSET FORMAT`。**JOIN・UNION は不可**(1 クエリ 1 テーブル)。CTE(`WITH`)の記載なし → 使わない |
| 集計 | `count()` `count(DISTINCT x)` `sum` `avg` `min` `max` `countIf` `sumIf` `avgIf` `argMin` `argMax` `quantileExactWeighted(q)(x, w)` `topK` |
| 条件 | 小文字の `if(cond, a, b)` のみ(`multiIf` の記載なし) |
| 日時 | `toDateTime` `toStartOfDay` `toStartOfInterval` `toUnixTimestamp` `formatDateTime` `now` `today`。**`toDate` は無い** |
| 数学 | `intDiv` `floor` `ceil` `round` `log` `pow` |
| 出力 | `FORMAT JSON` / `JSONEachRow` / `TabSeparated` |

### 6.2 取得するもの(7 クエリ)
| クエリ | 粒度 | 使い道 |
|---|---|---|
| セッション行 | install × session × 日 × platform × lang × 実験 | sessions / games / abandon / crash_free / daily 系 / share / install 単位の実験データ |
| 初回日 | install(過去 90 日で初回が期間内のもの) | installs_new / d1_return |
| 所要時間ヒストグラム | 日 × platform × lang × 実験 × 5 秒ビン | median_game_seconds |
| スコアヒストグラム | 同 × 50 点ビン | median_score / p90_score |
| Vitals ヒストグラム | 日 × platform × lang × 名前 × ビン(LCP 50ms / INP 8ms / CLS 0.005) | lcp_p75 / inp_p75 / cls_p75 |
| エラー上位 | stackHash | topErrors |
| 最新バージョン | — | version |

- 日付は `toUnixTimestamp(toStartOfDay(timestamp))` で数値として受け取る(応答の日時書式に依存しない)。
- 件数はすべて `_sample_interval` で重み付けする(セッション行は `max(_sample_interval)` を重みにする)。
- 行が多いクエリは `ORDER BY 全キー LIMIT 10000 OFFSET n` でページングする。
- **中央値・分位は SQL で計算しない**。窓(d1/d7/d14)・内訳(platform/lang/実験)ごとにクエリが増えるので、重み付きヒストグラムを 1 回取り、TS 側で分位を求める(精度はビン幅の半分)。
- **D1 リターンは TS 側で結合する**(JOIN 不可のため)。初回日の一覧とセッション行を突き合わせる。

例(セッション行。実物は `sql.ts`):
```sql
SELECT
  index1 AS install, blob2 AS session,
  toUnixTimestamp(toStartOfDay(timestamp)) AS day,
  blob5 AS platform, blob4 AS lang, blob7 AS exp, blob8 AS variant,
  max(_sample_interval) AS w,
  countIf(blob1 = 'session_start') AS starts,
  countIf(blob1 = 'game_end' AND double7 = 0) AS games,
  countIf(blob1 = 'game_end' AND double7 = 0 AND blob10 = 'abandon') AS abandons,
  sumIf(double4, blob1 = 'game_end') AS game_ms,
  countIf(blob1 = 'error') AS errors,
  countIf(blob1 = 'game_start' AND blob9 = 'daily' AND double7 = 0) AS daily_starts,
  countIf(blob1 = 'daily_result') AS daily_results,
  countIf(blob1 = 'share') AS shares
FROM hamaru_events
WHERE timestamp >= toDateTime('2026-10-01 00:00:00') AND timestamp < toDateTime('2026-10-15 00:00:00')
GROUP BY install, session, day, platform, lang, exp, variant
ORDER BY install, session, day, platform, lang, exp, variant
LIMIT 10000 OFFSET 0
FORMAT JSONEachRow
```

**未検証**: 本物の API にはまだ一度も投げていない(本番デプロイ前でデータが無いため)。関数名・構文はリファレンスで確認済みだが、応答の数値型(文字列か数値か)と `toDateTime('…')` の文字列引数は実データで確認すること。解析側は両方に耐えるように作ってある。

## 7. 出力 JSON(`kaizen/metrics/<YYYY-MM-DD>.json`)

改善エージェントはこのファイルだけを読めば判断できる形にする。

```jsonc
{
  "generatedAt": "2026-10-15T18:05:00Z",
  "version": "a1b2c3d",
  "windows": {
    "d1":  { "from": "2026-10-14T00:00:00Z", "to": "2026-10-15T00:00:00Z" },
    "d7":  { "...": "" },
    "d14": { "...": "" }
  },
  "overall": {
    "d1":  { "sessions": 812, "games": 2210, "games_per_session": 2.72, "median_game_seconds": 187, "crash_free": 0.998, "...": 0 },
    "d7":  { "...": 0 },
    "d14": { "...": 0 }
  },
  "byDay": [ { "date": "2026-10-01", "sessions": 0, "games": 0, "installs_new": 0, "d1_return": 0.21 } ],
  "byPlatform": { "ios": { "...": 0 }, "android": {}, "desktop": {} },
  "byLang": { "ja": {}, "en": {} },
  "experiment": {
    "id": "EXP-0003",
    "status": "running",
    "days": 4,
    "arms": {
      "control":   { "installs": 410, "games_per_session": { "mean": 2.61, "sd": 2.1 }, "crash_free": 0.997 },
      "treatment": { "installs": 398, "games_per_session": { "mean": 2.84, "sd": 2.3 }, "crash_free": 0.998 }
    }
  },
  "topErrors": [ { "stackHash": "3fa9c1e2b8d4a5f6", "message": "TypeError: ...", "n": 12, "firstVersion": "a1b2c3d" } ],
  "vitals": { "lcp_p75": 1180, "inp_p75": 64, "cls_p75": 0.01 }
}
```

実験判定の結果は `scripts/experiment-eval.ts` が `kaizen/metrics/<date>-decision.json` に書く([05 §6](05-kaizen-loop.md))。

## 8. プライバシー表記(About 画面に載せる文言の要点)

- 送信するのは「匿名の端末 ID、プレイ結果の数値、エラー情報、表示速度」だけ。
- 端末 ID は乱数で、名前・メール・位置とは結びつかない。設定の「データを削除」で消える。
- IP アドレスは保存しない。国の情報だけを統計に使う。
- Global Privacy Control が有効なブラウザには何も送らない。
- データは Cloudflare 上に最長 3 ヶ月保存。

## 9. テレメトリのテスト

- 単体: 各イベントが §4 の位置に正しく詰め替えられる(`worker/events.test.ts`、ゴールデン比較)。
- 単体: クライアントのキューが 20 件で分割される、失敗時に localStorage へ退避する、200 件で古いものから捨てる。
- E2E: 1 ゲーム完了で `POST /api/events` が `game_start` → `game_end` を含むこと(Playwright の route で捕捉)。
- 契約テスト: `src/telemetry/events.ts` の型と `worker/schema.ts` の zod が一致(型レベル `Expect<Equal<...>>`)。

## 10. 実装ノート(実装フェーズで解消した曖昧さ)

### N-1. `error.kind` は blob12(§4)
§4 の表は blob11 に `stackHash` / `kind` の両方を割り当てていたが、`error` イベントは
**両方を同時に持つ**ので 1 列では足りない。既存の位置は動かさず、§1-4「追記のみ」に従って
**blob12 = `kind`** を足した。現在の使用数は blob 12 / double 12 / index 1。

| AE 列 | 内容 |
|---|---|
| `blob12` | イベント固有の文字列 3(`kind`) |

### N-2. `daily_result.dailyNo` は整数なら 0 以下も受け取る(§3)
epoch より前の日は `dailyNo` が 0 以下になる(docs/01 §14 N-8)。Worker が 1 件でも弾くと
バッチごと失われ `daily_completion` が欠けるので、スキーマは「整数」だけを要求する。

### N-3. SQL の方言に合わせて §6 を書き直した
設計時の §6 は ClickHouse の書き方(`quantileWeighted(0.5)(…)`、大文字の `IF`、`WITH` + `JOIN`)で、
Analytics Engine ではそのまま動かない。リファレンスで確認した範囲だけを使う形に §6 を改めた。

### N-4. 分位はヒストグラムから求める(§5 / §6)
`median_game_seconds`(5 秒ビン)・`median_score` / `p90_score`(50 点ビン)・vitals の p75 は、
ビンの中央値で代表させた近似値(誤差はビン幅の半分以内)。`session_minutes_median` はセッション行から直接求める。

### N-5. 出力 JSON の追加項目(§7)
§7 の形に次を足した(削除・改名はしていない)。型の正本は `scripts/metrics/report.ts` の `MetricsReport`。
- `schemaVersion`、`date`、`sampling.maxSampleInterval`(1 を超えたらサンプリングが起きている)
- `overall.*` / `byPlatform.*` / `byLang.*` は §5 の全指標 ID を持つ。分母が 0 の比は `null`
- `byPlatform` / `byLang` / `vitals` は **d7 窓**
- `byDay[]` は `date, sessions, games, installs_active, installs_new, games_per_session, crash_free, d1_return`(翌日がまだ終わっていない日は `null`)
- `experiment` は `id, status, startedAt, days, primaryMetric, guardrails, minUsersPerArm, maxDays, arms`。
  各 arm は `installs, sessions, games, games_per_session{mean, sd}, crash_free, median_game_seconds, abandon_rate`
- `topErrors[]` に `nRecent`(直近 1 日)、`isNew`(初出が現行バージョン)、`rising`(直近 1 日が期間平均の 2 倍以上かつ 3 件以上)
- 稼働中の実験があれば `<date>-installs.json`(install × variant の行)も書く。`experiment:eval` の入力

### N-6. `metrics:pull` の終了コード
認証情報が無い・API が失敗・最長の窓で session が 0 件のときは exit 1 でファイルを書かない
(kaizen-daily はここで止まり Claude を起動しない)。成功時に `GITHUB_OUTPUT` へ `date=<YYYY-MM-DD>` を書く。

### N-7. install 単位の行はコミットしない(§8 プライバシー)
リポジトリは public なので、`kaizen/metrics/` にコミットするのは集計値(`<date>.json`)と判定(`<date>-decision.json`)だけ。
実験判定の入力 `<date>-installs.json`(install ID ごとの行)は `.gitignore` に入れ、ワークフローの実行中だけ使う。
Actions の artifact からも除外する(public リポジトリの artifact は GitHub アカウントがあれば誰でも取得できるため)。
