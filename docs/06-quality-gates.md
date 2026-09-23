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
- `piece.test.ts`: `normalize` が左上寄せ + 読み順、`largestGroup` が最大連結成分(同数なら読み順で先)、`resize` がちょうど n マスかつ連結を保つ(拡大・縮小の両方)。
- `rng.test.ts`: 同じシードで同じ列、異なるシードで異なる列(1000 個の先頭 10 値の衝突なし)、状態の保存/復元で継続する。
- `board.test.ts`: `canPlace` の境界(端・角・重なり)、行列同時消去で交差セルが 1 回だけ消える、消去後に完全行列が残らない。
- `derive.test.ts`: `pieceSizeFor` の段(熱 0–1 → 1 マス … 上限で頭打ち)、窓が空なら 1 マス、**置いたマスは窓に入らない**、盤が同じなら同じかけら(決定性)、導いたかけらは必ず連結。
- `scoring.test.ts`: 表の値(1〜6 列)、ストリーク乗算と上限、全消しボーナス、丸め。
- `game.test.ts`: `place` の不変性、熱の増減(消したら 0)、次のかけらの大きさ、ゲームオーバー判定、`serialize/deserialize` 往復(version 2)、壊れた JSON で `null`。
- `daily.test.ts`: 日付→シード、通算番号(epoch = #1)、UTC 境界。

`src/config`:
- 既定 JSON がスキーマを通る。範囲外(例 `maxPiece: 99`)が落ちる。`running` 実験が 2 つで落ちる。deep-merge の結果が再検証を通る。`assignVariant` の分布が allocation ±2 % 以内(10 万 install)。

`src/telemetry` / `worker`: [04 §9](04-telemetry-and-metrics.md)。

`src/storage`: マイグレーション(v0→v1 のダミー)、壊れたキーだけ初期化、メモリフォールバック。

## 3. 黄金テスト(決定性)

- `tests/unit/golden/daily-2026-10-01.json`: シード `daily:2026-10-01` で `newGame` → 固定の操作列(50 手)を適用した後の `board`、`score`、`piece`、`heat`、`moves` を保存。
- `tests/unit/golden/endless-seed-42.json`: 同様。
- 不一致 = **ルールが変わった**ということ。意図的な場合は PR に `golden: update` ラベルを付け、`npm run golden:update` で更新し、`kaizen/CHANGELOG.md` に「ルール変更」と明記する。bot はこのラベルを付けられない(05 §5)。

## 4. シミュレーション(`sim/`)

### ボット
| 名前 | 方策 | 用途 |
|---|---|---|
| `random` | 置ける手からランダム | 下限。ルールの生存性(初手ゲームオーバー率) |
| `greedy` | 1 手の得点最大 + 消去優先、同点なら盤中央から遠い順 | 平均的な人間の近似 |
| `lookahead` | 深さ 3 のビーム探索(各手で上位 8 候補だけ展開)。逆手は次のかけらが盤から決まるので、**先読みが本当に効く** | 上限の近似 |

### 実行
```
npm run sim -- --games 2000 --bots random,greedy,lookahead --seed 1 [--config path] [--variant treatment]
```

逆手では先読みが本当に効くので、`lookahead` は 1 ゲームが 800 手級になり、他の 2 つより
2 桁遅い(実測 0.7 秒 / ゲーム)。**baseline は 3 ボットとも 2000 ゲームで作る**が、
CI は速いボットと分けて回数を変える(`random,greedy` を 2000、`lookahead` を 200)。
`--check` は baseline に無いボットを飛ばすので、分けて回しても同じ帯域で判定される。
出力 `sim/out/<name>.json`: 各ボットの `moves` / `score` / `lines` / `heat` の平均・中央値・p10・p90、`gameOverAtMove1` 率、`boardClear` 率、実行時間。

### 帯域(`sim/baseline.json`、制御群の既定 config で生成)
| 指標 | 判定 |
|---|---|
| `random.median_moves` | baseline ± 30 % |
| `greedy.median_moves` | baseline ± 30 % |
| `greedy.median_score` | baseline ± 30 % |
| `lookahead.median_moves` | baseline ± 30 % |
| `*.gameOverAtMove1` | = 0(最初のかけらは必ず 1 マスなので、0 でなければ壊れている) |
| クラッシュ / 例外 | 0 |

実験 PR は **両バリアントで sim を実行**し、treatment が帯域外なら PR 本文に理由を書き `sim-baseline: update` は付けない(実験なので baseline は変えない)。treatment が `random.median_moves` を baseline の 50 % 未満にする変更は**即失敗**(明らかに壊れている)。

## 5. E2E(Playwright)

| シナリオ | 内容 |
|---|---|
| `smoke` | ホーム表示 → エンドレス開始 → かけらをドラッグして配置 → スコア増加 |
| `clear` | 用意した状態(テスト用 `?state=` パラメータ、開発ビルドのみ)から 1 列消去 → 演出後に空セル |
| `gameover` | 詰みの状態から配置 → オーバーレイ → 「もう一度」で新規 |
| `resume` | 数手置いてリロード → 「続きから」で盤が復元 |
| `daily` | デイリー開始 → 終了 → 結果カード → 共有(クリップボード権限をモック) → ホームに「達成」 |
| `keyboard` | キーボードのみで 1 かけら配置(矢印 → Enter。選ぶ操作は無い) |
| `howto` | ホームから遊び方を開き、1 手置くと盤と手持ちが変わる / おまかせ・はじめから / **初回だけ**ゲームの前に挟まる |
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
| 空入力 | 盤が空で 1 マスを置く(窓が空 → 次も 1 マス) / 全消し直後 / localStorage が空 |
| 境界 | (9,9) に 1 マス / 横 5 マスを x=5 と x=6 / 10 列同時に埋まる状態からの配置 / スコアが 2^31 を超えない前提の確認(number なので問題ないがテストで明示) |
| エラー経路 | 壊れた保存データ / config の deep-merge で不正値 / `/api/events` が 500 を返す / `navigator.share` が reject / `vibrate` 未定義 |
| 時間 | UTC 日付境界でのデイリー / 途中で日付が変わる / 端末時計が過去 |
| 入力 | ドラッグ中の `pointercancel` / 二本目の指 / 盤外ドロップ / 画面回転 |

## 9. 実装ノート(実装フェーズで解消した曖昧さ)

### N-1. `sim/out/<name>.json` の `<name>` はボット名(§4)
1 回の実行で走らせたボットごとに `sim/out/random.json` / `greedy.json` / `lookahead.json` を書く。
各ファイルには実行条件(config パス・variant・seed・games)と、そのボットの
`moves` / `score` / `lines` / `heat` の mean・median・p10・p90・min・max、
`gameOverAtMove1` 率、`boardClear` 率、実行時間 (ms) が入る。
`sim/out/` は `.gitignore` 済み(生成物)。`sim/baseline.json` だけがコミット対象。

### N-2. baseline の生成は `--write-baseline`(§4)
§4 は「`sim/baseline.json`(制御群の既定 config で生成)」とだけ書いているので、
生成手段として `--write-baseline` フラグを足した。現在の baseline は
`npm run sim -- --games 2000 --bots random,greedy,lookahead --seed 1 --write-baseline` で生成している。
`sim-baseline: update` ラベルの付いた PR だけがこのファイルを更新してよい。

### N-3. `gameOverAtMove1` の定義(§4)
「1 手も置けずに終了した割合」(`state.moves === 0`)。逆手では最初のかけらが必ず 1 マスで、
開始盤も最大 `startTiles` マスしか埋まっていないので**常に 0** になる。
0 でなければルールか開始盤の生成が壊れている。
(旧ルールでは `round === 1` のまま終わった割合 = `gameOverAtRound1` だった。
逆手にラウンドという単位が無くなったので 2026-09-24 に改名した。)

### N-4. ボットの評価関数は core の `place` を使わない(§4)
候補手は 1 ゲームあたり数万回評価するため、`sim/evaluate.ts` に
**盤を書き換えて元に戻す**非確保の評価関数を置いた。得点計算そのものは
`src/core/scoring.ts` の `scorePlacement` を呼ぶので core と必ず一致し、
その一致は `tests/unit/sim.test.ts` の「core の place と同じ得点・消去数になる」で担保している。
実際に打つ手は core の `place` を通す。

### N-5. ボットの乱数はゲームの乱数と分離する(§4)
`random` ボットの選択に `GameState.rng` を使うと出題列が乱れるため、
ゲームごとに `bot:<gameSeed>` で初期化した別の乱数器を使う。
同じ `--seed` なら全ボットが同じ出題列に直面し、結果は完全に再現する。

### N-5. `telemetry` シナリオは M3 ではメモリ内キューを見る(§5)
§5 は「`/api/events` へのリクエストに `game_start` / `game_end` が含まれ、スキーマ検証を通る」と定めるが、
送信そのものは M4 の担当([07](07-implementation-plan.md) §1)。M3 の `track()` はメモリ内キューだけなので、
E2E は開発ビルドで公開している `window.__hamaru.telemetry()` を読み、
**イベント名・発火タイミング・[04](04-telemetry-and-metrics.md) §2 の共通フィールド**を検査する。
M4 で輸送を実装したら、同じ spec に `page.route` でのリクエスト捕捉を足す(検査対象は変わらない)。

### N-6. `offline` シナリオだけ本番ビルドに対して実行する(§5)
開発サーバはモジュールを都度配信するため precache の検証にならない。
Playwright の `webServer` を 2 つ(`vite dev` = 5173 / `vite preview` = 4173)立て、
`offline` と manifest の検査だけ 4173 を見る。他のシナリオはテスト用の `?state=` が必要なので 5173。
Service Worker の制御は Chromium のみで検査する(WebKit は §5 の「週次」に回す)。

### N-7. `?state=` は 1 回だけ効く(§5)
差し込んだ状態がそのまま URL に残り続けると、「はじめから」やリロードのたびに同じ状態へ戻ってしまう。
読み取った直後に `history.replaceState` で `state` パラメータを消し、
**初期状態の差し込み**としてだけ働くようにした(開発ビルド限定なのは §5 のとおり)。

### N-8. E2E のドラッグは常に `page.mouse`(§5)
Pixel 7 / iPhone 15 のエミュレーションでも Pointer Events は発火するため、
ドラッグ補助(`tests/e2e/helpers.ts`)はマウスで統一している。
このため `config.input.touchLiftOffset`(指の上にかけらを持ち上げる量)は E2E では効かず、
**実機のタッチ操作は手動確認**に残る(§5 のデバイス一覧は画面サイズの検証として機能している)。

### N-9. E2E は全テストで `/api/events` を横取りしてスキーマ検証する(§5)
`tests/e2e/helpers.ts` の自動フィクスチャが `context.route("**/api/events")` で送信を捕捉し、
本文を **Worker と同じ `batchSchema`** で検証して 204 を返す。違反が 1 件でもあればそのテストは失敗する
(これで epoch 前の `dailyNo` が負になる不具合を見つけた)。
WebKit では sendBeacon の Blob 本文を Playwright が読めない(`postData()` が null)ため、
**WebKit だけ sendBeacon を無効化して `fetch(keepalive)` 経路で送らせる**。Chromium は sendBeacon 経路を検証する。

### N-10. G4 の実験バリアントは「明らかな破壊」だけを落とす(§4)
`npm run sim -- --variant <name> --check` は帯域外でも失敗にしない(実験なので帯域を外れてよい)。
失敗にするのは **random.median_moves が baseline の 50 % 未満**と、**初手で詰むゲームがある**ときだけ
(`sim/report.ts` の `variantCheckOk`)。

### N-11. Lighthouse CI の設定(§6)
`lighthouserc.json`。モバイルは Lighthouse の既定(`preset` を指定しない)。`vite preview` の本番ビルドに対して
`/` と `/#/play` を 3 回ずつ測り、中央値で判定する。lhci はハッシュ違いの URL を同じ URL として集計するので、
アサーションは実質 1 URL・6 回分の中央値になる。`@lhci/cli` は依存に入れず、CI で `npx @lhci/cli@0.15.1` を使う。

### N-11. 遊び方はルートではなくホームのボタンで挟む(2026-09-24、docs/01 §9.7)
初回導線を `#/play` のルート側に置いたら、LCP が **1.39 → 1.65 秒**に落ちて §6 の予算(1500 ms)を割った。
Lighthouse は毎回まっさらなプロファイルで走るので、`#/play` の計測がまるごと遊び方の画面の計測になり、
その遅延読み込み(画面 + 文言)がそのまま LCP になっていた。

ついでに分かったこと: **この予算の余裕は 1 往復ぶんも無い**。
シミュレート回線では初回ペイロードが約 500 バイト増えるだけで往復境界をまたぎ、LCP が 150 ms 跳ねる
(実測: 遊び方の文言 14 キー × 2 言語 ≒ 1 KB を常時読み込みの i18n に入れただけで 1.39 → 1.54 秒)。
したがって:

- **長い文章を `src/i18n/{ja,en}.json` に足さない**。画面ごとの遅延ファイル(`about.*` / `howto.*`)に置く。
  この 2 つは**両言語ぶんが常に初回 JS に入る**ので、1 行足すと 2 行ぶん重くなる
- 1 人 1 回しか開かない画面(About・遊び方)は**画面のモジュールごと遅延**させる
- 予算を触る前に、まず初回ペイロードが増えていないかを疑う
