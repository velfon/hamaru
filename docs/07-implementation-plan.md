# 07. 実装計画 — HAMARU

実装者(Claude Opus 5)向けの作業指示。**マイルストーンごとに受け入れ条件を満たしてからコミット**し、次へ進む。
各マイルストーンは 1 PR(または `main` 直コミット。M0 で保護を有効にするまでは直コミット可)。

## 0. 人間が先にやること(実装者はできない)

| # | 作業 | 備考 |
|---|---|---|
| H1 | GitHub リポジトリ作成(`velfon/hamaru` を想定、public 推奨) | public なら Actions 無料。private なら 05 §10 のコスト注記 |
| H2 | Cloudflare API トークン作成 | 権限: `Account.Workers Scripts: Edit`、`Account.Account Analytics: Read`、`Account.Workers KV Storage: Edit`(将来用、任意)、`User.User Details: Read`(wrangler が要求する場合) |
| H3 | GitHub Secrets 設定 | `CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID`、`ANTHROPIC_API_KEY` |
| H4 | GitHub Variables 設定 | `KAIZEN_ENABLED=false`(M6 まで)、`KAIZEN_AUTOMERGE=false` |
| H5 | ブランチ保護(M5 完了後) | `main`: 必須チェック = `check, unit, golden, sim, e2e, budget, change-class, audit`、auto-merge 有効、直接 push 禁止、`Allow GitHub Actions to create and approve pull requests` を ON |
| H6 | workers.dev サブドメインの確認 | `https://hamaru.<account>.workers.dev` |
| H7 | (任意)独自ドメイン | Cloudflare DNS 上のドメインを `wrangler.jsonc` の `routes` に追加 |

H2〜H4 が無くてもローカル開発(M1〜M3)は進められる。

## 1. マイルストーン

### M0. 骨組み(半日)
- `npm create vite@latest`(vanilla-ts)から開始し、[02 §2](02-architecture.md) の構成に整える。
- `tsconfig`(strict, noUncheckedIndexedAccess)、eslint flat config + `no-restricted-imports`(core の依存禁止)、prettier、vitest、`.nvmrc`。
- `CLAUDE.md`、`README.md`、`docs/` を配置(本書群をそのまま)。
- `package.json` scripts: `dev / build / preview / check / typecheck / lint / test / sim / validate:config / i18n:check / golden:update / metrics:pull / experiment:eval / deploy`(未実装のものは `echo TODO && exit 1`)。

**受け入れ**: `npm run check` と `npm test`(空テスト 1 本)が通る。

### M1. コア(1 日)
- `src/core/*` を [02 §3](02-architecture.md) の契約通りに実装。
- `src/config/game-config.json` + `schema.ts` + `resolve.ts`。`experiments.json` は空配列。
- [06 §2](06-quality-gates.md) の単体テストを全て書く。golden を生成(`tests/unit/golden/*.json`)。

**受け入れ**: カバレッジ `src/core` ≥ 95 %、golden 固定、`npm run validate:config` が範囲外を検出する。

### M2. シミュレーション(半日)
- `sim/bots/*`、`sim/run.ts`、`sim/report.ts`。`npm run sim -- --games 2000` が 60 秒以内。
- `sim/baseline.json` を生成し、帯域検査(`--check`)を実装。

**受け入れ**: `random.gameOverAtRound1 = 0`、3 ボットの順位が `random < greedy < lookahead`(中央値スコア)。

### M3. UI(2 日)
- **実装前に `frontend-design` スキルを読む**(ユーザ規約)。トークン・タイポ・モーションは [03](03-design-system.md) の値をそのまま使う。
- 画面: ホーム / ゲーム / ゲームオーバー / 設定 / About。ルータ、ストア、盤・トレイ描画、ドラッグ、キーボード、演出、共有、i18n、ストレージ、PWA。
- Unbounded をサブセット化してセルフホスト(`public/fonts/`、数字 + 基本ラテン + 記号、woff2)。
- E2E(Playwright)を [06 §5](06-quality-gates.md) の全シナリオ。

**受け入れ**: モバイル実機相当(Chrome DevTools エミュレーション)で 1 ゲーム通しで遊べる。E2E 全緑。Lighthouse(ローカル)Performance ≥ 95、a11y ≥ 95。JS gzip ≤ 60 KB。

### M4. テレメトリ + Worker(1 日)
- `src/telemetry/*`、`worker/*`、`wrangler.jsonc`、`public/_headers`。
- `wrangler dev` で `/api/events` が AE(ローカルはログ出力)に書く。
- `scripts/metrics-pull.ts`(SQL API)、`scripts/experiment-eval.ts`(Welch t 検定、判定規則)、それぞれ**固定の入力 JSON に対する単体テスト**を持つ。SQL の関数名は Cloudflare の SQL リファレンスで確認して実装する。

**受け入れ**: [04 §9](04-telemetry-and-metrics.md) のテスト全緑。本番デプロイ後、`metrics-pull` が実データで JSON を生成する(H2〜H3 が必要)。

### M5. CI/CD(半日)
- `ci.yml`(G1〜G8)、`deploy.yml`、PR プレビュー。`scripts/change-class.ts`、`scripts/size-budget.ts`、`lighthouserc.json`。
- 初回デプロイ。`https://hamaru.<account>.workers.dev` で遊べる。
- H5 のブランチ保護を人間に依頼(Issue を作る)。

**受け入れ**: PR を 1 本作って全ゲートが走り緑になる。`main` マージで自動デプロイ。

### M6. Kaizen ループ(1 日)
- `kaizen/`(POLICY, prompts, TEMPLATE, BACKLOG 初期値, HYPOTHESES, CHANGELOG)。
- `kaizen-daily.yml`、`kaizen-weekly.yml`、`kaizen-gate.yml`、`canary.yml`、`scripts/kaizen-digest.ts`、`scripts/canary.ts`。
- **ドライラン**: `workflow_dispatch` で daily を 1 回実行し、PR が「今日は出荷なし」または小さな改善で作られることを確認。`KAIZEN_AUTOMERGE=false` のまま人間がマージ。
- 2 回目のドライランで自動マージを ON にし、canary まで通す。

**受け入れ**: 05 §3 の図の全経路(通常・needs-human・revert)を 1 回ずつ手動で通した記録が `kaizen/CHANGELOG.md` にある。

### M7. 公開(人間)
- `KAIZEN_ENABLED=true`。初期トラフィック獲得(共有カード・SNS・知人)。
- 30 日後に [00 §4](00-overview.md) の目標と照合。

## 2. 実装者への指示

1. **設計書が正**。矛盾や不足を見つけたら、実装を止めずに最も単純な解釈で進め、`docs/` に追記して PR 本文に書く。
2. 各マイルストーンで `npm run check && npm test` を通してからコミット。コミットは小さく、メッセージは「何を・なぜ」。
3. 存在を確認していない API・関数・フラグを使わない(wrangler の `versions upload` の出力形式、AE SQL の関数名、`claude-code-action` の入力名は公式ドキュメントで確認)。
4. 依存は最小限。追加するときは PR 本文に理由と gzip サイズを書く。
5. UI 実装前に `frontend-design` スキルを読む。03 の値を使い、勝手に色や書体を変えない。
6. 「未検証」を「動きます」と言わない。E2E で通していない画面は受け入れに数えない。
7. `kaizen/` の初期 BACKLOG は [05 §6.4](05-kaizen-loop.md) の候補を ICE(Impact / Confidence / Ease、各 1〜5)付きで入れる。

## 3. リスクと対策

| リスク | 対策 |
|---|---|
| AE SQL API の方言差で集計が動かない | M4 で最初に `SELECT 1` から段階的に確認。JOIN 不可ならスクリプト側結合 |
| wrangler / claude-code-action の入力仕様変更 | 実装時に公式 README を読む。バージョンをタグで固定(`@v1`、wrangler は `package.json` で固定) |
| Unbounded のサブセット化で日本語文字が必要になる | 数値・見出しのみに限定。本文はシステムフォント |
| モバイル Safari のドラッグ挙動(スクロール・長押しメニュー) | `touch-action: none`、`-webkit-touch-callout: none`、`user-select: none`。E2E は WebKit を週次で |
| 初期トラフィックが少なく実験が回らない | 05 §6.3 注記。直接改善優先。共有導線を最初から入れる |
| Actions の private 分数 | public 推奨。private なら canary を schedule 化 |

## 4. 完了報告のフォーマット(各マイルストーン)

```
## M3 完了
- できたこと: ...
- 検証: E2E 10/10 緑、Lighthouse P=97 A=100、JS 48.2 KB gz
- 未検証 / 保留: WebKit での E2E は未実施
- 設計書との差分: 03 §5 の「戻る」を 180→160ms(理由: ...)。docs 更新済み
- 次: M4
```

## 5. 実装ノート(実装者が設計書の曖昧さを解消した記録)

### N-1. `npm run check` の構成はマイルストーンとともに育てる(M0)
M0 の「未実装スクリプトは `echo TODO && exit 1`」と、M0 受け入れ条件「`npm run check` が通る」は
そのままでは両立しない(`check` は `validate:config` と `i18n:check` を含むため)。
もっとも単純な解釈として、**`check` は「その時点で実装済みのサブチェックだけ」を連結する**ことにした。

| 時点 | `npm run check` の中身 |
|---|---|
| M0 | `typecheck && lint` |
| M1 | `validate:config && typecheck && lint` |
| M3(i18n 実装後) | `validate:config && typecheck && lint && i18n:check` |

未実装の `i18n:check` / `golden:update`(M1 で実装)/ `metrics:pull` / `experiment:eval` / `deploy` は
指示どおり `echo TODO && exit 1` のまま置いてある。

### N-2. `prettier --check` は `format:check` という別スクリプト(M0)
CLAUDE.md と 02 §8 は `check = validate:config + typecheck + lint + i18n:check` と定義しており
prettier を含まない。一方 06 §1 の G1 ジョブは `prettier --check` を含む。
スクリプト定義は 02 §8 に合わせ、prettier は `npm run format:check` として独立させた。
CI(M5)の `check` ジョブは `npm run check && npm run format:check` の 2 コマンドを実行する。

### N-3. カバレッジゲートは `npm run test:coverage`(M1)
02 §8 の `npm run test = vitest run` を維持し、カバレッジ付き実行は `npm run test:coverage`
(`vitest run --coverage`)とした。しきい値(`src/core/**` の行 95 %)は `vitest.config.ts` の
`coverage.thresholds` に定義済みで、G2 はこのスクリプトを実行する。

### N-4. M0 で作るディレクトリは M0〜M2 で必要なものだけ
02 §2 のツリーのうち、`src/ui`・`src/telemetry`・`src/storage`・`src/i18n`・`worker/`・
`.github/` などは中身のあるファイルを作る M3 以降で追加する(空ディレクトリは git に載らないため)。

### N-5. M3 で `check` に `i18n:check` が入り、`test:e2e` / `budget` が生えた
N-1 の表のとおり、M3 で i18n を実装したので
`npm run check = validate:config && typecheck && lint && i18n:check` になった。
加えて `npm run test:e2e`(Playwright)と `npm run budget`(`scripts/size-budget.ts`、
[02](02-architecture.md) §9 の予算検査。`npm run build` の後に実行する)を追加した。
`npm run metrics:pull` / `experiment:eval` / `deploy` は引き続き `echo TODO && exit 1`(M4 / M5)。

### N-6. M4 のスクリプトと確認状況
| コマンド | 内容 |
|---|---|
| `npm run metrics:pull -- [--days 14] [--date YYYY-MM-DD] [--dry-run]` | AE SQL → `kaizen/metrics/<date>.json`(+ 実験中は `-installs.json`) |
| `npm run experiment:eval -- [--date YYYY-MM-DD] [--now ISO]` | `<date>-decision.json` |
| `npm run cf:dev` | ビルドして `wrangler dev`(http://localhost:8787) |
| `npm run cf:types` | `worker-configuration.d.ts` を再生成 |
| `npm run deploy` | ビルドして `wrangler deploy --var APP_VERSION:$GIT_SHA` |

`wrangler dev` 上で `/api/health` 200、`/api/events` 204 / 400 / 403、`_headers` の CSP と immutable、404 ページ、
Chromium / WebKit での CSP 違反 0 件・Service Worker 登録・送信 204 を確認済み。
**本物の Analytics Engine への書き込みと SQL API は未確認**(デプロイと API トークンが要る。M5 で確認する)。

### N-7. 人間の準備作業(M5〜M6 の実装で確定した最新版。§0 より優先)
| # | 作業 | 状態(2026-09-17) |
|---|---|---|
| H1 | GitHub リポジトリ `velfon/hamaru`(public) | 済 |
| H2 | Cloudflare API トークン: **Account › Workers Scripts: Edit** と **Account › Account Analytics: Read** | 未 |
| H3 | GitHub Secrets: `CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID`、`ANTHROPIC_API_KEY` **または** `CLAUDE_CODE_OAUTH_TOKEN` | 未 |
| H4 | GitHub Variables: `KAIZEN_ENABLED=false`、`KAIZEN_AUTOMERGE=false`(任意で `PUBLIC_URL`、`KAIZEN_BOT_LOGINS`) | 未 |
| H5 | `main` のブランチ保護: 必須チェック `check, unit, golden, sim, e2e, budget, change-class, audit`、直接 push 禁止(管理者含む) | 未 |
| H6 | **Cloudflare ダッシュボードで Workers Analytics Engine を有効化**(これが無いと `wrangler deploy` が code 10089 で失敗する。有効化後も反映に 1〜2 分かかった) | 済(2026-09-17) |
| H7 | **Claude GitHub App** をリポジトリにインストール(https://github.com/apps/claude)。PR が `claude[bot]` 名義になり CI が走る | 未 |
| H8 | Settings › Actions › General: 「Allow GitHub Actions to create and approve pull requests」を ON(canary の revert PR 用) | 未 |

H6 の後にローカルで `GIT_SHA=$(git rev-parse --short=7 HEAD) npm run deploy`、または H2〜H3 の後に Actions の Deploy を手動実行すると公開される。
改善ループは H2〜H8 がすべて済んでから `KAIZEN_ENABLED=true` にする。最初は `KAIZEN_AUTOMERGE=false` のまま、
Kaizen daily を workflow_dispatch で 1 回動かし、PR の中身を人間が確認する(M6 の受け入れ)。

### N-8. 初回公開(2026-09-17)
`https://hamaru.lovenf.workers.dev`(版 3806f6b)。この Mac の wrangler(OAuth)から手動デプロイした。
公開 URL で `/api/health`、トップ、CSP / nosniff、404、別オリジン 403 を curl で、Chromium / WebKit で CSP 違反 0・
Service Worker 登録・`/api/events` 204 を確認した。GitHub Actions からの自動デプロイは H2〜H3 の後に有効になる。
Deploy ワークフローのヘルスチェックはこの URL を出力から拾う(`vars.PUBLIC_URL` でも指定できる)。

### N-9. ランキングで増えた人間の作業(2026-09-18)
| # | 作業 | 状態 |
|---|---|---|
| H9 | Cloudflare API トークンに **Account › D1: Edit** を追加(deploy.yml のマイグレーション適用に要る)。トークンの編集で権限を足せば値は変わらない | 未 |
| H10 | 不適切なニックネームの削除(運用。docs/08 §5.2 のコマンド) | 随時 |

D1(`hamaru`、APAC)の作成と初回のマイグレーション適用は、2026-09-18 にこの Mac の wrangler(OAuth)で実施済み。
