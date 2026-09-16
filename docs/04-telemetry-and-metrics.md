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

エンドポイント: `POST https://api.cloudflare.com/client/v4/accounts/<ACCOUNT_ID>/analytics_engine/sql`、`Authorization: Bearer <TOKEN>`(Account Analytics: Read)。本文はクエリ文字列。AE の SQL は ClickHouse 方言のサブセット。**関数名は実装時に公式リファレンスで確認**する(特に分位関数)。

### 6.1 期間・実験ごとの基本集計
```sql
SELECT
  blob7  AS exp,
  blob8  AS variant,
  blob1  AS event,
  SUM(_sample_interval) AS n,
  COUNT(DISTINCT index1) AS installs
FROM hamaru_events
WHERE timestamp >= toDateTime('2026-10-01 00:00:00')
  AND timestamp <  toDateTime('2026-10-15 00:00:00')
GROUP BY exp, variant, event
```

### 6.2 ゲーム指標(中央値は重み付き)
```sql
SELECT
  blob8 AS variant,
  SUM(_sample_interval) AS games,
  quantileWeighted(0.5)(double4 / 1000, _sample_interval) AS median_game_seconds,
  quantileWeighted(0.5)(double1, _sample_interval)        AS median_score,
  quantileWeighted(0.9)(double1, _sample_interval)        AS p90_score,
  SUM(_sample_interval * IF(blob10 = 'abandon', 1, 0)) / SUM(_sample_interval) AS abandon_rate
FROM hamaru_events
WHERE blob1 = 'game_end' AND double7 = 0
  AND timestamp >= toDateTime('...') AND timestamp < toDateTime('...')
GROUP BY variant
```

### 6.3 install 単位の指標(実験判定の入力)
実験判定はユーザ(install)を単位とするため、**install ごとの集計行**を取り、統計検定はスクリプト側で行う。
```sql
SELECT
  index1 AS install,
  ANY(blob8) AS variant,
  SUM(_sample_interval * IF(blob1 = 'session_start', 1, 0)) AS sessions,
  SUM(_sample_interval * IF(blob1 = 'game_end' AND double7 = 0, 1, 0)) AS games,
  SUM(_sample_interval * IF(blob1 = 'game_end', double4, 0)) / 60000 AS minutes,
  MAX(IF(blob1 = 'error', 1, 0)) AS had_error
FROM hamaru_events
WHERE blob7 = 'EXP-0003'
  AND timestamp >= toDateTime('<startedAt>')
GROUP BY install
```
行数上限に注意(AE の応答上限は実装時に確認。超える場合は日付で分割して取得)。

### 6.4 D1 リターン
```sql
-- 日ごとの初回 install と翌日再訪
WITH first_seen AS (
  SELECT index1 AS install, MIN(toDate(timestamp)) AS d0
  FROM hamaru_events WHERE blob1 = 'session_start'
  GROUP BY install
)
SELECT d0,
  COUNT() AS cohort,
  SUM(returned) AS returned
FROM (
  SELECT f.install, f.d0,
    MAX(IF(toDate(e.timestamp) = f.d0 + 1, 1, 0)) AS returned
  FROM first_seen f
  LEFT JOIN hamaru_events e ON e.index1 = f.install AND e.blob1 = 'session_start'
  GROUP BY f.install, f.d0
)
GROUP BY d0 ORDER BY d0
```
AE が JOIN / CTE をサポートしない場合は、`first_seen` と日別 install 一覧を別クエリで取り、スクリプト側で結合する(**実装時に確認し、動く方に寄せる**)。

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
