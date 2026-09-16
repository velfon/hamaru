# HAMARU — 作業規約(実装者・改善エージェント共通)

## この リポジトリは何か
10×10 ブロックはめ込みパズル。Cloudflare Workers で配信、Analytics Engine で計測、
GitHub Actions 上の Claude が毎日改善する。設計の正本は `docs/`、改善の記憶は `kaizen/`。

## 最初に読む
- `docs/00-overview.md`(目的・KPI・判断)→ 作業対象に応じて `docs/01`〜`07`
- 改善エージェントは加えて `kaizen/POLICY.md` → `kaizen/prompts/*.md`

## 守ること
1. **設計書が正**。挙動を変えたら同じ PR で `docs/` を更新する。
2. `src/core` は純粋関数。DOM・`Date.now()`・`Math.random()` を使わない(eslint が止める)。
3. 調整値はコードに書かず `src/config/game-config.json` に置く。範囲は `schema.ts` で制約する。
4. テレメトリの列の意味(`docs/04` §4)は変えない。追記のみ。
5. デイリーの決定性(golden テスト)を壊す変更は人間承認。
6. 依存を増やさない。フォントを増やさない。サイズ予算(`docs/02` §9)を守る。
7. `worker/`, `.github/`, `package*.json`, `wrangler.jsonc`, `kaizen/POLICY.md`, `kaizen/prompts/` は改善エージェントは触らない。
8. コミット前に `npm run check && npm test`。UI を触ったら `npm run test:e2e`。
9. 未検証のことを「動く」と書かない。

## コマンド
```
npm run dev / build / preview
npm run check            # validate:config + typecheck + lint + i18n:check
npm test                 # vitest
npm run test:e2e         # playwright
npm run sim -- --games 2000 [--variant treatment] [--check]
npm run golden:update    # ルール変更時のみ(人間承認)
npm run metrics:pull -- --days 14
npm run experiment:eval
```

## ディレクトリ
`docs/02-architecture.md` §2 を参照。
