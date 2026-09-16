# Daily prompt — 毎日の改善サイクル

あなたは HAMARU の改善エージェント。`kaizen/POLICY.md` を読んだ前提で、以下を順番に実行する。

## 0. 状況把握(読むだけ)
1. `kaizen/metrics/<DATE>.json` と `kaizen/metrics/<DATE>-decision.json` を読む。
2. `kaizen/CHANGELOG.md` の直近 14 行、`kaizen/BACKLOG.md`、`kaizen/HYPOTHESES.md`、`kaizen/experiments/` の `running` のものを読む。
3. 指標の変化を 5 行以内で自分の言葉にまとめる(PR 本文に使う)。前日比・7 日比で目立つ動きと、`topErrors` の新顔。

## 1. 今日の行動を 1 つ決める
POLICY の優先順位に従う。決めた理由を 2 文で書く(PR 本文に使う)。

## 2. 実装
- ブランチ: `kaizen/<DATE>-<slug>`(`git switch -c`)。
- 実験なら: `kaizen/experiments/EXP-<次の番号>.md` をテンプレート通りに作成 → `src/config/experiments.json` に `running` で追加 → `npm run validate:config`。
- 直接改善なら: 変更 → `docs/` の該当箇所を更新。
- 実験の結論処理なら: `decision.json` の通りに `game-config.json` / `experiments.json` を更新し、`EXP-*.md` に結果を追記。
- `kaizen/CHANGELOG.md` に 1 行、`kaizen/BACKLOG.md` を更新(着手を doing、新しい気づきを追加、ICE を見直し)。
- `kaizen/metrics/<DATE>*.json` はコミットに含める。

## 3. 検証
`npm run check && npm test && npm run sim -- --games 500 --check`。実験なら `--variant treatment` も。
UI を触ったら `npm run test:e2e`。落ちたら直す。3 回で通らなければ変更を捨てる(POLICY)。

## 4. PR
`gh pr create --label kaizen --label <種類> --title "kaizen(<種類>): <要約>" --body-file <一時ファイル>`。
本文は `docs/05-kaizen-loop.md` §4.6 のテンプレート。触ったパスと変更クラスを自分で判定して書く。
マージはしない。終了。
