# 03. デザインシステム — HAMARU

## 1. 方向性

**テーマ: 「釉薬(ゆうやく)のかかったタイルを、窯の中で並べる」**

ブロックはめ込みゲームの快感は「カチッと収まる」触覚にある。それを画面で表現するために、
ピースを**艶のある陶器タイル**、盤を**目地のある焼成トレイ**として描く。
列が消える瞬間は**金継ぎ**(割れ目に金が走る)を引用し、金色の線が走ってからタイルが砕けて消える。
これがこのゲームの「一つの記憶に残る要素(signature)」であり、演出予算はここに集中する。

避けるもの: 一般的なカジュアルゲームの「紺背景 + キャンディ色 + 丸ゴシック」。
本作は**深い墨緑の窯**に**低彩度で温かい釉薬色**を置く。派手さより「手触り」。

## 2. カラートークン(`src/styles/tokens.css`)

### ダーク(既定。窯の中)
| トークン | 値 | 用途 |
|---|---|---|
| `--kiln` | `#17262A` | ページ背景 |
| `--tray` | `#1F3136` | 盤の面(目地の色) |
| `--cell-empty` | `#26393F` | 空セル |
| `--cell-edge` | `#0F1A1D` | セルの落ち影 |
| `--ink` | `#F1EDE4` | 本文・数値 |
| `--ink-muted` | `#9DB0B0` | 補助テキスト |
| `--kintsugi` | `#E8C170` | 金継ぎ線・NEW BEST・ストリーク |
| `--danger` | `#D96C5F` | 置けないピースの暗転縁取り |

### ライト(釉薬見本帳)
| トークン | 値 |
|---|---|
| `--kiln` | `#EEE9DF` |
| `--tray` | `#DCD5C7` |
| `--cell-empty` | `#E6E0D3` |
| `--cell-edge` | `#C9C0AF` |
| `--ink` | `#1E2A2C` |
| `--ink-muted` | `#5D6E6E` |
| `--kintsugi` | `#B8892E` |
| `--danger` | `#B94E42` |

### 釉薬(ピース色。ライト/ダーク共通、`color` インデックス 1..6)
| # | トークン | 値 | 名前 | 形状カテゴリ |
|---|---|---|---|---|
| 1 | `--glaze-1` | `#E0855A` | 柿(かき) | 線・dot |
| 2 | `--glaze-2` | `#5FB3A1` | 青磁(せいじ) | 正方形 |
| 3 | `--glaze-3` | `#E4C25A` | 黄瀬戸(きぜと) | 小 L |
| 4 | `--glaze-4` | `#9A86C9` | 藤(ふじ) | 大 L |
| 5 | `--glaze-5` | `#D97A94` | 紅(べに) | T |
| 6 | `--glaze-6` | `#6B9FD6` | 瑠璃(るり) | 長方形 |

**色覚多様性**: 6 色は輝度差を確保しているが、形状で区別できるため色だけに依存しない。設定に「高コントラスト」は置かない(形状で十分)。

各タイルは `background: linear-gradient(160deg, color-mix(in oklab, var(--glaze-n), white 18%), var(--glaze-n) 55%, color-mix(in oklab, var(--glaze-n), black 12%))` と `inset 0 1px 0 rgba(255,255,255,.35)` の艶ハイライト、`box-shadow: 0 2px 0 var(--cell-edge)` の厚み。CSS 変数だけで表現し画像は使わない。

## 3. タイポグラフィ

| 役割 | 書体 | 理由 |
|---|---|---|
| 数値・見出し(スコア、ベスト、「NEW BEST」) | **Unbounded**(700 / 900、セルフホスト、数字と基本ラテンのみサブセット ≈ 25 KB) | 幅広で塊感のある字形がタイルと同じ「重さ」を持つ。数字が 1 桁ずつ「置かれた」ように見える |
| 本文 UI(ja / en) | システム UI スタック(`system-ui, -apple-system, "Hiragino Sans", "Noto Sans JP", sans-serif`) | 日本語 Web フォントは重い。UI 文言は短いので端末フォントで十分 |
| 補助ラベル・共有カード | 等幅(`ui-monospace, "SF Mono", Menlo, monospace`) | 共有テキストと画面を一致させる |

型スケール(`clamp` でモバイル→デスクトップ):
- `--fs-score`: `clamp(28px, 8vw, 44px)` Unbounded 900、`font-variant-numeric: tabular-nums`
- `--fs-title`: `clamp(24px, 6vw, 36px)` Unbounded 700、レタースペース `0.02em`
- `--fs-body`: `16px` / `--fs-small`: `13px`
- 行間 本文 1.5、見出し 1.1

スコアの変化は**数字ごとに 1 マス分下から滑り込む**(タイルが置かれる比喩)。`prefers-reduced-motion` では即時更新。

## 4. レイアウト

- 1 カラム、幅 `min(100vw, 560px)` を中央。左右余白 16px。
- 盤は正方形、一辺 = `min(100vw − 32px, 100dvh − ヘッダ 56px − トレイ 132px − 余白 24px, 520px)`。
- 盤とトレイの間 16px。トレイは 3 等分、各スロットは正方形(ピースは最大 5 セルなので `セル×0.6×5` に収まる)。
- セル間の目地 = セルサイズの 8 %(丸め)。角丸はセルの 14 %。
- セーフエリア: `padding-bottom: env(safe-area-inset-bottom)`。
- 横長(landscape、高さ < 500px): 盤を左、トレイを右に縦並び。

## 5. モーション

| 場面 | 仕様 | 時間 |
|---|---|---|
| 持ち上げ | トレイ縮尺 0.6 → 1.0、影が大きくなる | 120 ms, ease-out |
| 吸着(はまる) | ドロップ位置から目標セルへ移動 + 1 フレームだけ 1.04 倍→1.0 の「沈み」 | 90 ms |
| 戻る | トレイへ戻る | 180 ms, ease-in-out |
| 金継ぎ消去 | ① 消える行/列に沿って金線が 1 方向へ走る(`--kintsugi`、`clip-path` アニメ)② 線通過後、各タイルが 40 ms ずつずれて縮小+フェード | ① 160 ms ② 160 ms(計 `fx.clearDurationMs` = 320) |
| 全消し | 盤全体が一瞬 `--kintsugi` の縁光り + 「全消し +300」ラベル | 500 ms |
| ゲームオーバー | 置けないピースが `--danger` 縁取りで 600 ms かけて暗転 → オーバーレイがフェードイン | 600 + 200 ms |
| 消去プレビュー | 対象行列を `--kintsugi` 20 % で下塗り(点滅しない) | 即時 |

原則: **状態遷移は演出に依存しない**。演出はスキップ可能で、スキップしても最終 DOM は同じ。
`prefers-reduced-motion: reduce` または設定「軽減」では、移動系は 0 ms、消去はフェード 120 ms のみ。

## 6. コンポーネント

| コンポーネント | 仕様 |
|---|---|
| `Button` | 主: `--ink` 背景 / `--kiln` 文字、高さ 52px、角丸 14px、Unbounded 700 14px。副: 透明 + 1px `--ink-muted` 枠。`:focus-visible` は 3px `--kintsugi` アウトライン |
| `DailyCard` | 日付、状態(未挑戦/挑戦中/達成 + スコア)、連続日数、残り時間(`hh:mm`、1 分ごと更新)、主ボタン |
| `Toast` | 画面下部、2.4 秒、`aria-live="polite"` |
| `Dialog` | `<dialog>` 要素。ESC / 背景クリックで閉じる。破壊的操作は赤ではなく文言で警告 |
| `Overlay`(ゲームオーバー) | 盤の上に半透明 `--kiln` 85 %。数値は Unbounded |

## 7. コピー(文言)ガイド

- 短く、動詞から。「挑戦する」「続きから」「もう一度」「結果を共有」。
- 失敗を謝らない。「置ける場所がありません」ではなく、ゲームオーバー画面には結果だけを置く。
- 空状態は誘導。統計ゼロのとき「最初の 1 ゲームで記録が始まります」。
- 英語は sentence case。「Play endless」「Today's challenge」「Share result」。
- 数値は `Intl` で区切り。単位は英語では `pts` / `lines`、日本語では「点」「列」。

主要文言(ja / en の初期セット。`src/i18n/*.json` に置く):

| キー | ja | en |
|---|---|---|
| `home.play` | エンドレス | Play endless |
| `home.resume` | 続きから | Resume |
| `home.restart` | はじめから | Start over |
| `home.daily.title` | 今日の挑戦 | Today's challenge |
| `home.daily.play` | 挑戦する | Play today's |
| `home.daily.done` | 達成 {score} | Done · {score} |
| `home.daily.streak` | 連続 {n} 日 | {n}-day streak |
| `home.daily.next` | 次の問題まで {time} | Next in {time} |
| `game.score` | スコア | Score |
| `game.best` | ベスト | Best |
| `over.title` | ゲームオーバー | Game over |
| `over.newBest` | 自己ベスト更新 | New best |
| `over.retry` | もう一度 | Play again |
| `over.share` | 結果を共有 | Share result |
| `over.practice` | 練習で再挑戦 | Practice again |
| `over.home` | ホーム | Home |
| `toast.copied` | コピーしました | Copied |
| `settings.title` | 設定 | Settings |
| `settings.reset` | データを削除 | Delete all data |
| `settings.reset.confirm` | ベストスコアと統計を削除します。元に戻せません。 | This deletes your best score and stats. It can't be undone. |
| `a11y.placed` | {points} 点、{lines} 列消去 | {points} points, {lines} lines cleared |

## 8. アイコン・PWA

- アプリアイコン: `--kiln` 背景に 2×2 の釉薬タイル(柿・青磁・黄瀬戸・藤)を目地付きで配置。マスカブル対応(セーフゾーン 80 %)。
- `theme-color`: ダーク `#17262A` / ライト `#EEE9DF`(`media` 属性で切替)。
- スプラッシュは不要(起動 1 秒以内が目標)。

## 9. アクセシビリティ要件(CI で Lighthouse a11y ≥ 95)

- 盤は `role="grid"`、各セルは `role="gridcell"` + `aria-label="3行4列 空"`(選択中ピースがあるときのみ読み上げ対象に)。
- トレイのピースは `button` で `aria-label="ピース 1: 横 3 マス"`。
- キーボード操作は [01 §8.2](01-game-spec.md)。
- コントラスト: 本文 ≥ 4.5:1、大きな数値 ≥ 3:1(両テーマで検証)。
- フォーカスリングを消さない。
