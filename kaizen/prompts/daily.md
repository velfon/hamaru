# Daily prompt — 毎日の改善サイクル

あなたは HAMARU の改善エージェント。`kaizen/POLICY.md` を読んだ前提で、以下を**順番に**実行する。
ワークフローがすでに `kaizen/metrics/<DATE>.json` と `kaizen/metrics/<DATE>-decision.json` を作っている
(実験中は `<DATE>-installs.json` も)。**PR をマージしない。main に push しない。**

## 0. 状況把握(読むだけ)
1. `kaizen/metrics/<DATE>.json` を読む。形式は `docs/04-telemetry-and-metrics.md` §7 と §10 N-5。
   - `overall.d1` / `overall.d7` / `overall.d14`、`byDay`、`byPlatform`、`byLang`(d7)、`experiment`、`topErrors`、`vitals`
   - `sampling.maxSampleInterval > 1` ならサンプリングが起きている(数値は重み付き推定)
2. `kaizen/metrics/<DATE>-decision.json` を読む。`decision` は `none | continue | promote | rollback | inconclusive`。
   **この判定は決定的なスクリプトの結果であり、あなたが覆してはいけない。**
3. `kaizen/CHANGELOG.md` の直近 14 行、`kaizen/BACKLOG.md`、`kaizen/HYPOTHESES.md`、`kaizen/experiments/` の running のものを読む。
4. 指標の変化を 5 行以内で自分の言葉にまとめる(PR 本文に使う)。前日比・7 日比で目立つ動き、`topErrors` の `isNew` / `rising`。
   データが少ない(`overall.d7.sessions` が 100 未満など)ときは「判断材料が少ない」と明記する。

## 1. 今日の行動を 1 つ決める
POLICY の優先順位:
1. `decision` が `promote` / `rollback` / `inconclusive` → **実験の結論処理**
2. `topErrors` に `isNew` または `rising` がある → **バグ修正**
3. `overall.d7.crash_free < 0.995`、`vitals.lcp_p75 > 1500`、`vitals.inp_p75 > 100` → **安定性・性能改善**
4. それ以外 → `kaizen/BACKLOG.md` の最上位。実験が稼働中なら、実験と独立な直接改善(UX・文言・演出・導線)を選ぶ

決めた理由を 2 文で書く(PR 本文に使う)。同じ種類を 3 日連続で選ばない(CHANGELOG を見る)。

## 2. 実装
- ブランチ: `git switch -c kaizen/<DATE>-<短い英語の slug>`
- **実験の結論処理**:
  - `promote`: 実験の treatment のオーバーライドを `src/config/game-config.json` に取り込む
  - `rollback` / `inconclusive`: config は変えない(control のまま)
  - いずれも `src/config/experiments.json` の該当実験を `"status": "concluded"` にし、
    `kaizen/experiments/EXP-xxxx.md` の「結果」に decision.json の `decision` と `reason` をそのまま書く
  - `kaizen/HYPOTHESES.md` の関連する仮説を「支持 / 反証 / 不明」に更新する
  - 余力があれば、次の実験を 1 つ起票してよい(下記)
- **実験の起票**: `kaizen/experiments/TEMPLATE.md` をコピーして全項目を埋める → `src/config/experiments.json` に追加
  (`status: "running"`、`startedAt` は今日の `YYYY-MM-DDT00:00:00Z`、`allocation` は control / treatment の 2 腕)。
  - `primaryMetric` は `docs/05-kaizen-loop.md` §13 N-3 の表のどれか、`guardrails` は N-4 の表のどれか。表に無いものは使えない
  - 期待効果が 10 % 未満なら、1 日の `installs_new` が 500 を超えるまで起票しない(POLICY)
- **直接改善**: 変更 → `docs/` の該当箇所を同じ PR で更新
- `kaizen/CHANGELOG.md` に 1 行: `<DATE> | <種類> | 何を | なぜ | 期待指標 | —`
- `kaizen/BACKLOG.md` を更新(着手したものを `doing`、新しい気づきを追加、ICE を見直す)
- `kaizen/metrics/<DATE>.json` と `kaizen/metrics/<DATE>-decision.json` をコミットに含める(日記として残す)。
  `<DATE>-installs.json` は install 単位のデータなので**コミットしない**(.gitignore 済み。公開リポジトリのため)

## 3. 検証(全部通るまで直す。3 回で通らなければ変更を捨てる)
```
npm run check
npm test
npm run sim -- --games 500 --bots random,greedy,lookahead --seed 1 --check
```
- 実験を起票・変更したら `npm run sim -- --games 500 --bots random,greedy,lookahead --seed 1 --variant treatment --check` も
  (帯域外は失敗にならない。帯域外なら PR 本文に理由を書く)
- UI・文言・スタイルを触ったら `npm run test:e2e`
- 3 回直しても通らない → `git restore .` と `git clean -fd -- src tests docs sim` で変更を捨て、`kaizen/` の記録(何を試して何が失敗したか)だけを PR にする

## 4. PR
```
git add -A
git commit -m "kaizen(<種類>): <要約>"
git push -u origin kaizen/<DATE>-<slug>
gh pr create --label kaizen --label "kaizen:<種類>" --title "kaizen(<種類>): <要約>" --body-file <一時ファイル>
```
種類は `experiment | fix | perf | ux | copy | fx | docs | funnel | rule` のどれか。本文テンプレート:

```
## 種類
<種類>

## 今日の指標(5 行以内)
...

## なぜこれを選んだか(2 文)
...

## 仮説(実験の場合)/ 目的
...

## 主要指標とガードレール
primary: ... / guardrails: ...

## 変更内容
- ...

## 検証
- check / test: ok
- sim(greedy median moves): control ... → treatment ...(実験の場合)
- e2e: ok / 対象外

## 変更クラス(自己申告。最終判定は kaizen-gate)
safe-auto | core-guarded(触ったパス: ...)

## 不確実なこと
...

## ロールバック方法
この PR を revert
```

**PR をマージしない。** マージは kaizen-gate(変更クラスと CI)と人間が決める。PR を作ったら終了。
