# HAMARU

10×10 の盤に 3 つのブロックを置き、列を揃えて消すパズル。**https://hamaru.lovenf.workers.dev**

広告なし・登録なし・1 秒起動。
公開後は Claude(Opus 5)が毎日、実プレイデータを見て小さな改善を提案・検証・出荷し続ける。

- 設計書: [docs/](docs/00-overview.md)(ここが正本)
- 自律改善の記憶: [kaizen/](kaizen/POLICY.md)
- ホスティング: Cloudflare Workers(Static Assets + Analytics Engine)

## 状態

| フェーズ | 状態 |
|---|---|
| 1. 設計 | 完了(2026-09-17) |
| 2. 実装 v1.0(Opus 5) | M0〜M6 のコードは完了。公開と改善ループの稼働は人間の準備待ち([docs/07 §5 N-7](docs/07-implementation-plan.md)) |
| 3. 自律改善ループ稼働 | 未稼働(`KAIZEN_ENABLED` 未設定) |

## 開発(実装後)

```bash
npm ci
npm run dev        # http://localhost:5173
npm run check      # config 検証・型・lint・i18n
npm test           # 単体
npm run sim        # ヘッドレスシミュレーション
npm run cf:dev     # 本番相当(Worker + 静的資産)http://localhost:8787
npm run test:e2e   # Playwright
npm run metrics:pull -- --dry-run   # 発行する SQL を表示
```
