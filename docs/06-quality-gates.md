# 06. 品質ゲートとテスト戦略 — HAMARU

自律改善ループが安全に回るかどうかは、**ゲートが LLM の判断に依存しないこと**で決まる。全ゲートは決定的なスクリプトであり、PR の作者が人間でも Claude でも同じ基準で落とす。

## 1. ゲート一覧(`ci.yml`、PR 必須チェック)

| # | ジョブ | 内容 | 落ちる条件 |
|---|---|---|---|
| G1 | `check` | `validate:config`(zod)、`typecheck`、`lint`、`i18n:check`、`prettier --check` | いずれか失敗 |
| G2 | `unit` | vitest(`tests/unit/**`, `src/**/*.test.ts`)。カバレッジ: `src/core` は行 95 % 以上 | 失敗、またはカバレッジ未達 |
| G3 | `golden` | 決定性・デイリー黄金テスト(§3) | スナップショット不一致(`golden: update` ラベルが無い限り) |
| G4 | `sim` | ヘッドレスシミュレーション(§4)。`sim/baseline.json` の帯域と比較 | 帯域外(`sim-baseline: update` ラベルが無い限り)、クラッシュ、初手ゲームオーバー > 0 |
| G5 | `e2e` | Playwright(§5)。モバイル(Pixel 7 / iPhone 15 エミュレーション)+ デスクトップ | 失敗 |
| G6 | `budget` | ビルド後のサイズ予算(02 §9)、Lighthouse CI(性能・a11y ≥ 95) | 超過 |
| G7 | `change-class` | 変更パスからクラスを判定(05 §5)。bot 作者が `human-only` に触れていたら失敗 | 違反 |
| G8 | `audit` | `npm audit --audit-level=high` | high 以上 |

全ジョブ合計 10 分以内を目標(改善ループの 1 サイクル内で複数回回すため)。

## 2. 単体テスト(必須項目)

`src/core`:
- `shapes.test.ts`: 25 形状、ID 一意、原点含有、`w/h` がセルと一致、色がカテゴリ規則に一致。
- `rng.test.ts`: 同じシードで同じ列、異なるシードで異なる列(1000 個の先頭 10 値の衝突なし)、状態の保存/復元で継続する。
- `board.test.ts`: `canPlace` の境界(端・角・重なり)、行列同時消去で交差セルが 1 回だけ消える、消去後に完全行列が残らない。
- `tray.test.ts`: 重みゼロの形状は出ない、`noTripleDuplicate`、`fitGuarantee: oneOfThree` で少なくとも 1 つ置ける、`pity` で小形状比率が上がる(統計的テスト: 10 000 回で比率が閾値以上)。
- `scoring.test.ts`: 表の値(1〜6 列)、ストリーク乗算と上限、全消しボーナス、丸め。
- `game.test.ts`: `place` の不変性、ゲームオーバー判定、`serialize/deserialize` 往復、壊れた JSON で `null`。
- `daily.test.ts`: 日付→シード、通算番号(epoch = #1)、UTC 境界。

`src/config`:
- 既定 JSON がスキーマを通る。範囲外(例 `threshold: 1.5`)が落ちる。`running` 実験が 2 つで落ちる。deep-merge の結果が再検証を通る。`assignVariant` の分布が allocation ±2 % 以内(10 万 install)。

`src/telemetry` / `worker`: [04 §9](04-telemetry-and-metrics.md)。

`src/storage`: マイグレーション(v0→v1 のダミー)、壊れたキーだけ初期化、メモリフォールバック。

## 3. 黄金テスト(決定性)

- `tests/unit/golden/daily-2026-10-01.json`: シード `daily:2026-10-01` で `newGame` → 固定の操作列(50 手)を適用した後の `board`、`score`、`tray`、`rng` を保存。
- `tests/unit/golden/endless-seed-42.json`: 同様。
- 不一致 = **ルールが変わった**ということ。意図的な場合は PR に `golden: update` ラベルを付け、`npm run golden:update` で更新し、`kaizen/CHANGELOG.md` に「ルール変更」と明記する。bot はこのラベルを付けられない(05 §5)。

## 4. シミュレーション(`sim/`)

### ボット
| 名前 | 方策 | 用途 |
|---|---|---|
| `random` | 置ける手からランダム | 下限。ルールの生存性(初手ゲームオーバー率) |
| `greedy` | 1 手の得点最大 + 消去優先、同点なら盤中央から遠い順 | 平均的な人間の近似 |
| `lookahead` | トレイ 3 つの順列 6 通りを試し合計得点最大(深さ 3) | 上限の近似 |

### 実行
```
npm run sim -- --games 2000 --bots random,greedy,lookahead --seed 1 [--config path] [--variant treatment]
```
出力 `sim/out/<name>.json`: 各ボットの `moves` / `score` / `lines` / `round` の平均・中央値・p10・p90、`gameOverAtRound1` 率、`boardClear` 率、実行時間。

### 帯域(`sim/baseline.json`、制御群の既定 config で生成)
| 指標 | 判定 |
|---|---|
| `random.median_moves` | baseline ± 30 % |
| `greedy.median_moves` | baseline ± 30 % |
| `greedy.median_score` | baseline ± 30 % |
| `lookahead.median_moves` | baseline ± 30 % |
| `*.gameOverAtRound1` | = 0(`fitGuarantee: oneOfThree` の場合) |
| クラッシュ / 例外 | 0 |

実験 PR は **両バリアントで sim を実行**し、treatment が帯域外なら PR 本文に理由を書き `sim-baseline: update` は付けない(実験なので baseline は変えない)。treatment が `random.median_moves` を baseline の 50 % 未満にする変更は**即失敗**(明らかに壊れている)。

## 5. E2E(Playwright)

| シナリオ | 内容 |
|---|---|
| `smoke` | ホーム表示 → エンドレス開始 → ピースをドラッグして配置 → スコア増加 |
| `clear` | 用意した状態(テスト用 `?state=` パラメータ、開発ビルドのみ)から 1 列消去 → 演出後に空セル |
| `gameover` | 詰みの状態から配置 → オーバーレイ → 「もう一度」で新規 |
| `resume` | 数手置いてリロード → 「続きから」で盤が復元 |
| `daily` | デイリー開始 → 終了 → 結果カード → 共有(クリップボード権限をモック) → ホームに「達成」 |
| `keyboard` | キーボードのみで 1 ピース配置 |
| `settings` | 言語切替で文言変更、テーマ切替、データ削除で統計が 0 |
| `telemetry` | `/api/events` へのリクエストに `game_start` / `game_end` が含まれ、スキーマ検証を通る |
| `offline` | SW 登録後にオフラインでリロードして起動 |
| `reduced-motion` | 軽減設定で配置・消去が即時反映 |

デバイス: `Pixel 7`、`iPhone 15`、`Desktop Chrome`。CI は Chromium のみ、週次で WebKit / Firefox。

## 6. 性能予算(Lighthouse CI)

`lighthouserc.json` で `categories:performance ≥ 0.95`、`accessibility ≥ 0.95`、`largest-contentful-paint ≤ 1500`、`interactive ≤ 2500`(モバイル・スロットリング既定)。`wrangler dev` で起動した本番ビルドに対して実行。

## 7. 本番ヘルスチェック(deploy 後)

- `GET /api/health` が 200 かつ `version` が今回の sha。
- トップページが 200 で `<title>HAMARU` を含む。
- `canary.yml`: デプロイ 30 分後にエラー率を判定([05 §8](05-kaizen-loop.md))。

## 8. エッジケース一覧(テストに必ず含める)

| 分類 | ケース |
|---|---|
| 空入力 | 盤が空で 3×3 を置く / トレイが全 null になった直後 / localStorage が空 |
| 境界 | (9,9) に dot / `h5` を x=5 と x=6 / 10 列同時に埋まる状態からの配置 / スコアが 2^31 を超えない前提の確認(number なので問題ないがテストで明示) |
| エラー経路 | 壊れた保存データ / config の deep-merge で不正値 / `/api/events` が 500 を返す / `navigator.share` が reject / `vibrate` 未定義 |
| 時間 | UTC 日付境界でのデイリー / 途中で日付が変わる / 端末時計が過去 |
| 入力 | ドラッグ中の `pointercancel` / 二本目の指 / 盤外ドロップ / 画面回転 |
