# HAMARU

10×10 の盤に 3 つのブロックを置き、列を揃えて消すパズル。広告なし・登録なし・1 秒起動。
公開後は Claude(Opus 5)が毎日、実プレイデータを見て小さな改善を提案・検証・出荷し続ける。

- 設計書: [docs/](docs/00-overview.md)(ここが正本)
- 自律改善の記憶: [kaizen/](kaizen/POLICY.md)
- ホスティング: Cloudflare Workers(Static Assets + Analytics Engine)

## 状態

| フェーズ | 状態 |
|---|---|
| 1. 設計 | 完了(2026-09-17) |
| 2. 実装 v1.0(Opus 5) | 進行中 — M0 骨組み / M1 コア / M2 シミュレーション 完了、M3 UI 以降が未着手([docs/07-implementation-plan.md](docs/07-implementation-plan.md)) |
| 3. 自律改善ループ稼働 | 未着手 |

## 開発(実装後)

```bash
npm ci
npm run dev        # http://localhost:5173
npm run check      # config 検証・型・lint・i18n
npm test           # 単体
npm run sim        # ヘッドレスシミュレーション
npm run build && npx wrangler dev   # 本番相当
```
