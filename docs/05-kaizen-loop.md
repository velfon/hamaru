# 05. 自律改善システム(Kaizen Loop)— HAMARU

## 1. 目的と到達像

**毎日 1 回、Claude(Opus 5)が本番の指標を読み、小さな改善を 1 つ提案し、実装し、機械的なゲートを通し、出荷し、翌日以降その効果を測る。**
人間の仕事は、週 1 回のダイジェストを読むこと、`needs-human` の PR を見ること、必要なら止めることの 3 つ。

到達像を 1 行で: 「30 日後に見に来たら、ゲームが少しずつ良くなっていて、なぜ良くなったかが `kaizen/CHANGELOG.md` に全部書いてある」。

## 2. 原則

| 原則 | 意味 |
|---|---|
| **小さく** | 1 日 1 変更、差分 400 行以内。大きな変更は実験に分割 |
| **測ってから** | 変更は仮説と主要指標を**事前登録**する。後付けの解釈で「成功」にしない |
| **戻せる** | 全変更は revert PR で戻せる。状態を持つ変更(保存形式)は後方互換必須 |
| **説明できる** | 判断は決定的スクリプトが下し、LLM はその結果を「読む」だけ。統計判断を LLM にさせない |
| **人間が最後に勝つ** | 停止スイッチ、`needs-human` クラス、`POLICY.md` の優先 |
| **飽きない** | 同じ種類の改善ばかり続けない。バックログは種類(ルール / UX / 演出 / 性能 / 文言 / 導線)を回す |

## 3. 全体像

```
 ┌────────────────────────────────────────────────────────────────┐
 │  毎日 03:00 JST  (kaizen-daily.yml)                              │
 │                                                                  │
 │  1 measure   scripts/metrics-pull  → kaizen/metrics/<date>.json  │
 │  2 judge     scripts/experiment-eval → <date>-decision.json      │
 │  3 think     Claude: 指標・記憶(kaizen/)・docs を読む            │
 │  4 act       Claude: 1 つの変更を実装 (実験 or 直接改善)          │
 │  5 verify    npm run check/test/sim をローカルで通す              │
 │  6 propose   PR 作成(仮説・指標・変更クラス・sim 結果を本文に)   │
 └───────────────┬──────────────────────────────────────────────────┘
                 ▼
 ┌──────────── ci.yml (G1〜G8) ────────────┐
 │ 緑 & class=safe-auto & KAIZEN_AUTOMERGE │──► 自動マージ ──► deploy.yml ──► canary.yml
 │ 赤 or class=needs-human                 │──► 人間へ(PR にラベル・Issue)      │
 └─────────────────────────────────────────┘                                    │
                 ▲                                                              │
                 │      エラー率急増 → revert PR(自動マージ)                    │
                 └──────────────────────────────────────────────────────────────┘

 毎週 月 04:00 JST (kaizen-weekly.yml): 週次レトロ → kaizen/retro/<week>.md、BACKLOG 再優先付け、ダイジェスト Issue
```

## 4. 1 サイクルの詳細

### 4.1 measure(決定的)
`scripts/metrics-pull.ts --days 14` が [04 §7](04-telemetry-and-metrics.md) の JSON を生成。失敗(API エラー・データ 0 件)なら**ワークフローは Claude を起動せず終了**し、Issue `kaizen: metrics unavailable <date>` を作る(重複時は既存にコメント)。

### 4.2 judge(決定的)
`scripts/experiment-eval.ts` が稼働中の実験を判定(§6)。結果 `decision.json`:
```jsonc
{ "experiment": "EXP-0003", "decision": "promote" | "rollback" | "continue" | "inconclusive" | "none",
  "reason": "n=410/398, days=4, lift=+8.8% (95%CI +1.2..+16.4), p=0.023, guardrails ok",
  "stats": { "...": 0 } }
```

### 4.3 think(Claude)
入力: `kaizen/metrics/<date>.json`、`decision.json`、`kaizen/POLICY.md`、`kaizen/BACKLOG.md`、`kaizen/HYPOTHESES.md`、`kaizen/CHANGELOG.md`、直近 7 日の `kaizen/experiments/*.md`、`docs/`。
出力: 今日の行動の選択(1 つ)。優先順位:
1. `decision` が `promote` / `rollback` / `inconclusive` → **実験の結論処理**(config に反映 or 戻す、`experiments.json` を `concluded` に、`EXP-xxxx.md` に結果を追記)。この日はこれで終わり(結論処理 + 次の実験の起票まで可)。
2. `topErrors` に新規または増加中のエラー → **バグ修正**(直接改善)。
3. `crash_free` / vitals がガードレール外 → **性能・安定性改善**。
4. それ以外 → BACKLOG の最上位を **実験として起票・実装**(実験が稼働中なら、実験と独立な UX / 文言 / 演出の直接改善を選ぶ)。

### 4.4 act(Claude)
- ブランチ `kaizen/<date>-<slug>` を作る。
- 変更は 1 テーマ。無関係なリファクタ禁止。
- 実験なら `kaizen/experiments/EXP-<n>.md` を**テンプレート通り**に書き(§6.1)、`experiments.json` に `running` で追加。
- 直接改善なら `kaizen/CHANGELOG.md` に 1 行追加(日付、種類、何を、なぜ、期待する指標)。
- `kaizen/metrics/<date>.json` と `decision.json` をコミットに含める(日記として残す)。
- BACKLOG を更新(着手したものを `doing`、新しい気づきを追加)。

### 4.5 verify(Claude がローカルで)
`npm run check && npm test && npm run sim -- --games 500`(実験なら `--variant treatment` も)。落ちたら直す。3 回直しても落ちるなら**変更を捨て**、その日は `kaizen/` の更新のみの PR にする(「今日は出荷なし」も正当な結果)。

### 4.6 propose(Claude)
`gh pr create` で PR。本文テンプレート:
```
## 種類
experiment | fix | perf | ux | copy | fx | docs

## 仮説(実験の場合)/ 目的
...

## 主要指標とガードレール
primary: games_per_session / guardrails: crash_free, median_game_seconds

## 変更内容
- ...

## 検証
- check/test: ok
- sim(greedy median moves): control 71 → treatment 76 (+7%)
- golden: 変更なし

## 変更クラス
safe-auto  (触ったパス: src/config/experiments.json, kaizen/**)

## ロールバック方法
このPRを revert
```
ラベル: `kaizen`、種類ラベル。**Claude はマージしない**。マージ判断は `kaizen-gate.yml`(§5)。

## 5. 変更クラスと自動マージ方針

`scripts/change-class.ts` が PR の変更パスから判定する。クラスは**最も厳しいもの**が採用される。

| クラス | パス | 自動マージ |
|---|---|---|
| `safe-auto` | `src/config/**`, `src/i18n/**`, `src/styles/**`, `src/ui/**`, `public/icons/**`, `docs/**`, `kaizen/**`, `tests/**`, `sim/bots/**` | CI 緑なら **自動** |
| `core-guarded` | `src/core/**`, `src/telemetry/**`, `src/storage/**`, `sim/run.ts` | CI 緑 **かつ** golden 不変 **かつ** 差分 150 行以内なら自動。それ以外は `needs-human` |
| `human-only` | `worker/**`, `.github/**`, `package.json`, `package-lock.json`, `wrangler.jsonc`, `public/_headers`, `vite.config.ts`, `kaizen/POLICY.md`, `kaizen/prompts/**`, `sim/baseline.json`, `tests/unit/golden/**` | **しない**。bot 作者なら G7 で CI 失敗 |

`kaizen-gate.yml`(PR `opened` / `synchronize` / `check_suite completed`):
1. 作者が `github-actions[bot]`(claude-code-action の既定)で `kaizen` ラベルがある PR のみ対象。
2. クラスを判定してラベル付与(`class:safe-auto` 等)。
3. `safe-auto`(または条件を満たす `core-guarded`)かつ `vars.KAIZEN_AUTOMERGE == 'true'` → `gh pr merge --squash --auto`。
4. それ以外 → `needs-human` ラベル + Issue `kaizen: review needed` にリンク追記。

前提(人間が設定): `main` のブランチ保護で「必須チェック = ci の全ジョブ」「auto-merge 許可」「直接 push 禁止(管理者含む)」。

## 6. 実験の枠組み

### 6.1 事前登録テンプレート(`kaizen/experiments/TEMPLATE.md`)
```
# EXP-0003: pity.threshold 0.6 → 0.5
- 起票: 2026-10-12  / 状態: running
- 背景(指標): median_game_seconds が 150 秒と短く、abandon_rate 18 %。終盤の詰みが早い仮説。
- 仮説: 救済が早く入ると 1 ゲームが伸び、games_per_session が上がる。
- 変更: pieces.pity.threshold = 0.5(treatment のみ)
- 主要指標: games_per_session(install 単位の平均)
- ガードレール: crash_free ≥ control − 0.5pt / median_game_seconds 120〜600 / abandon_rate ≤ control + 3pt
- 最小サンプル: 300 install / 腕、最大 14 日
- 期待効果: +10 %(sim greedy median moves +7 % から推定)
- 判定基準: §6.3 の規則に従う。恣意的な早期終了はしない。
- 結果(judge が追記): ...
```

### 6.2 割り当て・露出
- 割り当ては install 単位で固定([02 §4.3](02-architecture.md))。
- 分析対象は「実験開始後に `session_start` を送った install」。開始前からの継続ユーザも含む(割り当ては決定的なので問題ない)。
- デイリーは `lockedInDaily` で保護。デイリーを対象にする実験は UI 側(導線・共有文言)のみ許可。

### 6.3 判定規則(`experiment-eval.ts`、決定的)
1. **ガードレール**: 両腕 100 install 以上で、いずれかのガードレールを treatment が破っている → `rollback`。
2. **サンプル到達**: 両腕が `minUsersPerArm` 以上かつ経過 3 日以上 → Welch の t 検定(install 単位の主要指標)。
   - `p < 0.05` かつ lift > 0 → `promote`
   - `p < 0.05` かつ lift < 0 → `rollback`
   - それ以外 → `continue`
3. **期限**: 経過 ≥ `maxDays` で未決 → `inconclusive`(control を維持)。
4. `promote` 時: treatment のオーバーライドを `game-config.json` に取り込み、`experiments.json` を `concluded`(`result: promote`)に。
5. 全判定に `lift`、95 % 信頼区間、p 値、n、日数を記録。

注記: 300 install/腕で検出できるのはおおむね 15〜20 % の相対差。小さな効果を狙う実験は `minUsersPerArm` を 1000〜2000 に上げる(BACKLOG の ICE で「規模」を見積もる)。トラフィックが少ない初期は、実験より**直接改善(バグ・性能・導線)**を優先し、実験は効果の大きそうなものに絞る。これも POLICY に書く。

### 6.4 実験の候補(初期 BACKLOG の種)
| 領域 | 候補 | 主要指標 |
|---|---|---|
| ルール | `pity.threshold` 0.6 / 0.5 / 0.7、`smallBoost` | games_per_session |
| ルール | `fitGuarantee` none vs oneOfThree(エンドレス) | median_game_seconds, abandon_rate |
| ルール | `sq3` の重み 0.35 → 0.25 | median_score, abandon_rate |
| 配点 | ストリーク `step` 0.25 → 0.5、`max` 2 → 3 | games_per_session |
| UX | 消去プレビュー ON/OFF | abandon_rate |
| UX | タッチ持ち上げオフセット 70 → 90 | abandon_rate(誤配置の代理) |
| 導線 | ホームでデイリーカードを最上段 vs エンドレスを最上段 | daily_start_rate |
| 共有 | 共有文言のゲージ有無 | share_rate |
| 演出 | 金継ぎ演出時間 320 → 220 ms | games_per_session |

## 7. ワークフロー定義

### 7.1 `kaizen-daily.yml`
```yaml
name: Kaizen daily
on:
  schedule:
    - cron: "0 18 * * *"          # 03:00 JST
  workflow_dispatch:
concurrency:
  group: kaizen
  cancel-in-progress: false
jobs:
  kaizen:
    if: vars.KAIZEN_ENABLED == 'true'
    runs-on: ubuntu-latest
    timeout-minutes: 60
    permissions:
      contents: write
      pull-requests: write
      issues: write
      id-token: write
    steps:
      - uses: actions/checkout@v6
        with: { fetch-depth: 0 }
      - uses: actions/setup-node@v6
        with: { node-version-file: .nvmrc, cache: npm }
      - run: npm ci
      - name: Pull metrics
        id: metrics
        run: npm run metrics:pull -- --days 14 --out kaizen/metrics
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
      - name: Evaluate experiment
        run: npm run experiment:eval -- --metrics kaizen/metrics --out kaizen/metrics
      - uses: actions/upload-artifact@v4
        with: { name: metrics-${{ github.run_id }}, path: kaizen/metrics }
      - uses: anthropics/claude-code-action@v1
        with:
          anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
          prompt: |
            REPO: ${{ github.repository }}
            DATE: ${{ steps.metrics.outputs.date }}
            You are the daily improvement agent for this game.
            First read kaizen/POLICY.md. Then follow kaizen/prompts/daily.md step by step.
            Today's metrics are already generated in kaizen/metrics/. Do not re-run metrics:pull.
          claude_args: |
            --model claude-opus-5
            --max-turns 80
            --allowedTools "Read,Write,Edit,MultiEdit,Glob,Grep,Bash(npm:*),Bash(npx:*),Bash(node:*),Bash(git:*),Bash(gh pr:*),Bash(gh issue:*),Bash(gh label:*)"
```
`metrics-pull` は `date` を `GITHUB_OUTPUT` に書き、データが無い日は `exit 78`(neutral)相当の処理として Issue を作って `exit 1` にし、後続を止める。

### 7.2 `kaizen-weekly.yml`
毎週日曜 19:00 UTC(月曜 04:00 JST)。`scripts/kaizen-digest.ts` が 7 日分の metrics と CHANGELOG からダイジェスト草稿を作り、Claude が `kaizen/prompts/weekly.md` に従ってレトロ(`kaizen/retro/<ISO week>.md`)を書き、BACKLOG を再優先付けし、PR(`safe-auto`)と Issue `Weekly digest <week>` を作る。Issue は人間向けで、5 行以内の要約 + 指標表 + 今週出荷したもの + 来週の狙い + 判断を仰ぎたいこと。

### 7.3 `canary.yml`
`deploy.yml` の成功後に `workflow_run` で起動。30 分待機 → `scripts/canary.ts` が直近 30 分の `crash_free` を過去 24 時間と比較。**エラー session が 20 以上かつ比率が基準の 3 倍超** → 直近の kaizen マージ commit を `git revert` した PR を作り、`kaizen` + `revert` ラベルで自動マージ(クラス判定は revert 元と同じ)。Issue `canary: auto-revert <sha>` を作る。

### 7.4 `deploy.yml`
`main` push(`paths-ignore: [docs/**, kaizen/**]`)→ check → test → build → `wrangler deploy` → health check。並列実行防止。

## 8. 安全装置(まとめ)

| 装置 | 効果 |
|---|---|
| `KAIZEN_ENABLED` 変数 | daily / weekly を即停止(進行中の実験はそのまま) |
| `KAIZEN_AUTOMERGE` 変数 | 自動マージだけを止める(PR は作られ続ける) |
| ブランチ保護 | bot も人間も CI を迂回できない |
| G7 change-class | bot が `human-only` に触れば CI 失敗 |
| zod の範囲制約 | config を範囲外にすればビルド失敗 |
| sim 帯域 | ルールを壊せばマージ不可 |
| golden | デイリーの公平性を壊す変更は人間承認 |
| canary | 出荷後 30 分で自動 revert |
| 1 日 1 PR・400 行 | 変更量の物理的上限(`kaizen-gate` が行数を検査) |
| `--max-turns 80` / `timeout-minutes 60` | 暴走・コストの上限 |
| `--allowedTools` | ネットワーク・任意コマンドの禁止(curl 不可、npm scripts 経由のみ) |

## 9. `kaizen/POLICY.md`(エージェントの行動規範。要点)

1. 1 日 1 テーマ。迷ったら小さい方。出荷ゼロの日を恥じない。
2. 変更する前に `docs/` の該当箇所を読む。挙動を変えたら `docs/` も同じ PR で更新する。
3. **触ってはいけない**: `worker/`, `.github/`, `package*.json`, `wrangler.jsonc`, `POLICY.md`, `prompts/`, golden, baseline。必要なら Issue を書いて人間に頼む。
4. 統計判断は `decision.json` に従う。自分で p 値を計算して上書きしない。
5. テレメトリの列の意味を変えない(追記のみ)。
6. デイリーの乱数列・ルールを日中に変えない(golden が守る)。
7. 実験は同時 1 本。起票時にテンプレートの全項目を埋める。
8. 「良さそう」で出荷しない。指標で語れない変更(演出の好み等)は BACKLOG に置き、週次で人間に問う。
9. ユーザに謝らない、煽らない、暗いパターン(通知の強要・偽の希少性)を入れない。
10. 依存を追加しない。フォントを追加しない(サイズ予算)。
11. 秘密情報・環境変数に触れない。ネットワークは npm scripts 経由のみ。
12. 分からないことは PR 本文に「不確実」と書く。断定しない。

## 10. コストの目安

Opus 5(入力 $5 / 出力 $25 per 1M tokens、2026-09 時点)。daily 1 回あたり入力 ~300k(プロンプトキャッシュ込み)・出力 ~40k と見積もり、**約 $2〜3/回、月 $70〜100**。weekly を含めても月 $120 以内。Actions は public リポジトリなら無料、private なら月 2,000 分(daily 20 分 × 30 = 600 分 + canary 30 分 × 30 = 900 分 → 上限に近い。**private の場合は canary の待機を `schedule` 化する**)。

## 11. 失敗モードと対処

| 失敗 | 兆候 | 対処 |
|---|---|---|
| 同じ改善を繰り返す | CHANGELOG に同種が連続 | weekly で「種類のローテーション」を強制。BACKLOG に `lastKind` を持つ |
| 指標が動かないのに実験が続く | `continue` が 14 日 | `maxDays` で `inconclusive`。効果量の見積もりを厳しく |
| トラフィック不足 | 実験が常に inconclusive | POLICY §6.3 注記: 直接改善に切替、実験は大きな効果のみ |
| 演出の過剰追加 | CSS/JS サイズ増 | G6 予算。weekly で「一つ外す」レビュー項目 |
| テレメトリ欠損 | metrics 0 件 | daily は起動せず Issue。canary は判定を skip |
| AE のサンプリング | `_sample_interval > 1` | 全集計を重み付き。install 単位で index を切っているため分析単位は保たれる |
| 自動マージで壊れた | canary が revert | revert 後、原因 PR に `needs-human` を付け再挑戦を禁止(CHANGELOG に記録) |

## 12. 将来の拡張(設計に含めない、方向だけ)

- **Managed Agents への移行**: 定期デプロイ(cron)+ GitHub リポジトリ資源で同じループが Anthropic 側でホストできる。ゲートと POLICY はそのまま使える。
- **多腕実験**: トラフィックが 1 日 5,000 install を超えたら 3 腕を許可。
- **ユーザの声**: ゲームオーバー画面に 1 タップの「楽しかった / 難しすぎ / 簡単すぎ」を置き、テレメトリに加える(v1.1 候補、実験で導入)。

## 13. 実装ノート(実装フェーズで解消した曖昧さ)

### N-1. `experiment:eval` は判定だけを書き、config は変えない(§4.2 / §6.3-4)
§6.3-4 は「promote 時に treatment を `game-config.json` に取り込む」と書くが、§4.3 と `kaizen/prompts/daily.md` は
結論処理をエージェントの仕事としている。二重に書き換えないよう、スクリプトは `<date>-decision.json` を書くだけにした。
取り込み・`concluded` への変更・`EXP-*.md` への結果追記は、daily エージェントが decision.json に従って行う。

### N-2. 「改善」の向きは指標ごと(§6.3)
§6.3 は「lift > 0 → promote」と書くが、`abandon_rate` は下がるのが改善。主要指標ごとに向きを持たせ、
**p < 0.05 かつ改善方向 → promote、p < 0.05 かつ悪化方向 → rollback** とした。

### N-3. 主要指標は install 単位の値に写す(§6.3)
検定の単位は install。対応している主要指標と、install 1 件の値:

| primaryMetric | install の値 | 向き |
|---|---|---|
| `games_per_session` | games / sessions(sessions=0 は除外) | 上 |
| `games` | games | 上 |
| `session_minutes_median` | 分 / sessions(中央値の install 単位近似) | 上 |
| `abandon_rate` | abandons / games(games=0 は除外) | 下 |
| `crash_free` | 1 − エラーのあるセッション / セッション | 上 |
| `daily_start_rate` | デイリーを始めたら 1 | 上 |
| `daily_completion` | 始めた install で公式記録があれば 1(始めていなければ除外) | 上 |
| `share_rate` | shares / daily_results(0 は除外) | 上 |

これ以外を `experiments.json` に書くと `experiment:eval` は **exit 1**(黙って進めない)。

### N-4. ガードレール ID(§6.1 のテンプレート)
| ID | 条件(treatment) |
|---|---|
| `crash_free` | ≥ control − 0.005 |
| `median_game_seconds` | 120〜600 秒 |
| `abandon_rate` | ≤ control + 0.03 |
| `<指標>_min_<n>` / `<指標>_max_<n>`(指標は `crash_free` / `median_game_seconds` / `abandon_rate`) | 絶対値の下限 / 上限 |

値が `null`(データ不足)のガードレールは判定不能として通す(`skipped: true` を記録)。未知の ID は exit 1。

### N-5. 判定の細部
- 対応は **control + 1 腕の 2 腕**のみ(ADR-7)。それ以外は exit 1。
- 「install 数」は installs.json の行数(観測されたサンプル)。サンプリング時も検定は観測行で行う(一様抽出なので妥当)。
- p 値は Welch–Satterthwaite の自由度で t 分布から計算。外部ライブラリは使わない(`scripts/experiment/stats.ts`、
  独立に数値積分した参照値と 1e-6 の精度で一致することを単体テストで確認)。
- `lift` は (treatment − control) / control の %、95 % 信頼区間は差の CI を control の平均で割った近似。

### N-6. 自動マージは CI 完了を起点にし、マージ後にデプロイを明示的に起動する(§5 / §7)
GitHub の仕様で、**GITHUB_TOKEN で行った操作(マージ・push・PR 作成)は他のワークフローを起動しない**。
§5 の「`gh pr merge --auto` → main への push で deploy.yml」はこのため動かない。実装は次の形:
1. 改善エージェントの PR は **Claude GitHub App** 名義(`claude[bot]`)で作られるので CI は通常どおり走る。
2. `kaizen-gate.yml` は `workflow_run`(CI 完了)で起動し、**main のスクリプト**で PR の差分を判定する(PR のコードは実行しない)。
   head sha が一致し、`kaizen` ラベルがあり、`change-class` が自動マージ可で、`vars.KAIZEN_AUTOMERGE == 'true'` のときだけ
   `gh pr merge --squash --match-head-commit` し、続けて `gh workflow run deploy.yml`(workflow_dispatch は例外として起動する)。
3. それ以外は `class:<クラス>` と `needs-human` のラベル、理由のコメント(同じ head sha には 1 回だけ)。

### N-7. canary は deploy.yml の後続ジョブ。異常時はまず本番を wrangler rollback で戻す(§7.3)
§7.3 の `canary.yml`(`workflow_run`)は、起点のデプロイが GITHUB_TOKEN 由来だと起動しない恐れがあるので、
deploy.yml の `canary` ジョブ(`needs: deploy`)にした。30 分待って `npm run canary` で判定し、
`rollback` なら **`wrangler rollback --yes` で本番を直前の版へ即座に戻す**。そのうえで revert ブランチと PR、Issue を作る。
revert PR は GITHUB_TOKEN 名義なので CI が自動では走らない(`needs-human`)。本番はすでに戻っているので急がなくてよい。
判定規則は `scripts/canary.ts`(エラーのあった session ≥ 20 かつ率が直前 24 時間の 3 倍超、基準率の下限 0.1 %、直近に session が無ければ skip)。

### N-8. 改善エージェントの認証とツール(§7.1)
- 認証は `ANTHROPIC_API_KEY` か `CLAUDE_CODE_OAUTH_TOKEN`(どちらか一方)。GitHub 側は Claude GitHub App をリポジトリに入れる。
- `--model claude-opus-5`、daily は `--max-turns 80`、weekly は 40。
- `--allowedTools` は Read / Write / Edit / Glob / Grep と、`npm run` / `npm test` / `npx vitest` / `npx playwright test`、
  git の status / diff / log / switch / restore / clean / add / commit / push、gh の pr create / list / view と issue create / list / comment、`date` のみ。
  **`gh pr merge` と任意の `node` / `curl` は許可しない**。`git push` は許可するので、main への直接 push を防ぐのは**ブランチ保護**(必須)。
- 未マージの `kaizen` PR が残っていれば、その日は metrics を取らずに終わる(1 日 1 PR、積み上げない)。
- 週次の数字は `scripts/kaizen-digest.ts` が草稿に書き、エージェントは解釈だけを書く。

### N-9. ワークフローは `shell: bash` を明示する(§7)
GitHub Actions はシェル省略時に `bash -e` で実行し、`pipefail` が付かない。`npm run metrics:pull | tee log` の失敗を見逃して
指標なしで Claude が起動しかねないので、全ワークフローで `defaults.run.shell: bash`(= `bash -eo pipefail`)にした。
また Deploy の同時実行制限はワークフロー全体ではなく deploy ジョブに付け、canary の 30 分待ちが次のデプロイを止めないようにした。

### N-10. 1 日の作業はターン上限に収める(§4.5、2026-09-20)
初回の本番実行(9/20)は、エージェントが**80 ターンの上限に達して打ち切られ**、作業も PR も残らなかった
(10 分、6.68 ドル相当)。9/18・9/19 の失敗はこれとは別で、0.9 秒・費用 0・モデル使用実績なし = 利用枠による拒否。
モデルと認証そのものは `Agent check` ワークフロー(手動)で正常を確認した。

対処:
- `daily.md` の先頭に**予算**を書いた(40 回程度で PR、30 回を超えたらその時点でまとめる)。読むのは `cat` でまとめ、
  検証は `npm run check && npm test` の 1 コマンド + 触った範囲に応じた 1 コマンドだけ
- `--max-turns` を 140 に、`Bash(cat:*)` `Bash(sed:*)` `Bash(ls:*)` を許可(まとめ読み用)
- `show_full_output: true` で、途中で止まったときに何をしていたか追えるようにした
- 失敗した日は Issue `kaizen: agent run failed <日付>` を作る(気づけるように)
