# 02. アーキテクチャ設計書 — HAMARU

## 1. 技術スタック

| 領域 | 採用 | 理由 |
|---|---|---|
| 言語 | TypeScript (strict, `noUncheckedIndexedAccess`) | 盤・形状の添字バグを型で潰す |
| ビルド | Vite | 速い、設定が小さい、`dist/` を静的資産としてそのまま配れる |
| UI | フレームワークなし(DOM + CSS + Web Animations API) | 100 セルの盤に仮想 DOM は不要。依存を減らし改善エージェントが壊しにくい |
| 検証 | zod | config / experiments / API 入力の検証 |
| PWA | `vite-plugin-pwa`(Workbox) | precache + オフライン。自前 SW の保守を避ける |
| テスト | vitest(単体・シミュレーション)、Playwright(E2E)、Lighthouse CI(性能予算) | [06-quality-gates.md](06-quality-gates.md) |
| Lint | eslint 9 (flat config) + typescript-eslint、prettier | |
| ホスティング | Cloudflare Workers + Static Assets、wrangler | ADR-1 |
| テレメトリ | Workers Analytics Engine | ADR-4 |
| CI/CD/改善 | GitHub Actions、`anthropics/claude-code-action@v1` | ADR-6 |
| Node | 24 LTS(`.nvmrc`) | Actions の `setup-node` と揃える |

バージョンは実装時点の最新安定版を採用し、`package.json` に**厳密固定**(`^` を付けない)。依存更新は改善ループの対象外(人間が月 1 回)。

## 2. ディレクトリ構成

```
hamaru/
├── docs/                      # 本設計書群(正本。挙動を変えたら必ず更新)
├── kaizen/                    # 改善ループの「記憶」(05 参照)
│   ├── POLICY.md              # エージェントの行動規範(人間が編集)
│   ├── BACKLOG.md             # 改善候補(エージェントが更新)
│   ├── HYPOTHESES.md          # 仮説と根拠
│   ├── CHANGELOG.md           # 出荷した変更と結果
│   ├── experiments/EXP-0001.md
│   └── metrics/2026-10-01.json
├── src/
│   ├── main.ts                # エントリ。ルータ起動
│   ├── core/                  # ★ 純粋ロジック。DOM 禁止(eslint で import 制限)
│   │   ├── types.ts
│   │   ├── rng.ts             # cyrb53 + mulberry32
│   │   ├── shapes.ts          # 形状カタログ
│   │   ├── board.ts           # canPlace / clearLines / anyFits
│   │   ├── tray.ts            # generateTray
│   │   ├── scoring.ts
│   │   ├── game.ts            # newGame / place / serialize
│   │   └── daily.ts           # 日付→シード、通算番号
│   ├── config/
│   │   ├── game-config.json   # ★ 調整値の正本
│   │   ├── experiments.json   # ★ 実験定義
│   │   ├── schema.ts          # zod スキーマ(両 JSON)
│   │   └── resolve.ts         # config + 実験オーバーライドの解決
│   ├── ui/
│   │   ├── router.ts
│   │   ├── store.ts           # 小さな observable ストア
│   │   ├── screens/{home,game,settings,about}.ts
│   │   ├── board-view.ts      # 盤の描画・差分更新
│   │   ├── tray-view.ts
│   │   ├── drag.ts            # ポインタ入力
│   │   ├── keyboard.ts
│   │   ├── fx.ts              # 演出(吸着・金継ぎ消去・全消し)
│   │   ├── share.ts
│   │   └── components/{button,toast,dialog}.ts
│   ├── audio/                 # BGM と効果音(10 参照)。音源ファイルは持たない
│   │   ├── score.ts           # ★ 純粋。小節ごとの音符を作る
│   │   ├── sfx.ts             # 効果音(音符は純粋、鳴らす部分は Web Audio)
│   │   ├── context.ts         # 共有 AudioContext(参照数で開閉)
│   │   └── player.ts          # BGM を鳴らす(先読み予約)
│   ├── telemetry/
│   │   ├── client.ts          # キュー・バッチ・sendBeacon
│   │   ├── events.ts          # イベント型(04 と 1:1)
│   │   └── vitals.ts          # web-vitals → イベント
│   ├── storage/
│   │   ├── local.ts           # localStorage ラッパ + メモリフォールバック
│   │   └── migrate.ts
│   ├── i18n/{index.ts,ja.json,en.json}
│   └── styles/{tokens.css,base.css,game.css}
├── worker/
│   ├── index.ts               # fetch handler: /api/*、それ以外は ASSETS
│   ├── events.ts              # /api/events 検証 → AE 書き込み
│   └── schema.ts              # 受信イベントの zod
├── sim/                       # ヘッドレスシミュレーション(core のみ使用)
│   ├── bots/{random,greedy,lookahead}.ts
│   ├── run.ts                 # N 回プレイして統計を出す CLI
│   └── report.ts
├── scripts/
│   ├── metrics-pull.ts        # AE SQL API → kaizen/metrics/<date>.json
│   ├── experiment-eval.ts     # 実験判定(決定的)
│   ├── size-budget.ts
│   ├── i18n-check.ts
│   └── kaizen-digest.ts       # 週次ダイジェスト生成
├── tests/
│   ├── unit/                  # vitest(core / config / telemetry)
│   └── e2e/                   # Playwright
├── public/
│   ├── _headers               # CSP 等(Workers Static Assets が解釈)
│   ├── icons/
│   └── manifest.webmanifest   # vite-plugin-pwa が生成する場合は不要
├── .github/workflows/
│   ├── ci.yml                 # PR: check + test + sim + e2e + budget
│   ├── deploy.yml             # main: build → wrangler deploy → canary
│   ├── kaizen-daily.yml       # cron: 指標取得 → 実験判定 → 改善 PR
│   ├── kaizen-weekly.yml      # cron: ダイジェスト Issue
│   └── canary.yml             # deploy 後 30 分のエラー率監視 → 自動 revert PR
├── wrangler.jsonc
├── vite.config.ts
├── package.json
├── CLAUDE.md                  # 実装者・改善エージェント共通の作業規約
└── README.md
```

### 依存方向(eslint `no-restricted-imports` で強制)
```
core  ←  config  ←  ui / telemetry / storage / sim / worker
core は何も import しない(型と自身のみ)。ui は worker を import しない。
```

## 3. コアの契約(`src/core`)

```ts
// types.ts
export type Cell = 0 | 1 | 2 | 3 | 4 | 5 | 6;
export type Board = Uint8Array;                 // size*size
export interface Shape { id: string; cells: ReadonlyArray<readonly [number, number]>; w: number; h: number; color: Cell; }
export interface Piece { shapeId: string; }
export type Mode = "endless" | "daily";
export type Status = "playing" | "over";

export interface GameState {
  readonly version: 1;
  readonly mode: Mode;
  readonly seed: string;
  readonly rng: number;                          // mulberry32 の内部状態
  readonly size: number;
  readonly board: Board;
  readonly tray: ReadonlyArray<Piece | null>;    // 長さ 3
  readonly score: number;
  readonly streak: number;
  readonly longestStreak: number;
  readonly round: number;
  readonly moves: number;
  readonly linesCleared: number;
  readonly status: Status;
  readonly startedAt: number;                    // epoch ms(演出・統計用。ロジックには使わない)
}

export interface PlaceResult {
  ok: boolean;
  placedCells: Array<[number, number]>;
  clearedRows: number[];
  clearedCols: number[];
  clearedCells: Array<[number, number]>;
  scoreDelta: number;
  streakAfter: number;
  boardCleared: boolean;
  newTray: boolean;
  gameOver: boolean;
}

// game.ts
export function newGame(config: ResolvedConfig, mode: Mode, seed: string, now: number): GameState;
export function place(state: GameState, config: ResolvedConfig, trayIndex: number, x: number, y: number): { state: GameState; result: PlaceResult };
export function serialize(state: GameState): string;       // JSON(board は base64)
export function deserialize(s: string): GameState | null;  // 壊れていれば null

// board.ts
export function canPlace(board: Board, size: number, shape: Shape, x: number, y: number): boolean;
export function anyFits(board: Board, size: number, tray: ReadonlyArray<Piece | null>): boolean;
export function validPositions(board: Board, size: number, shape: Shape): Array<[number, number]>;
export function fillRatio(board: Board): number;
```

- **純粋関数**: `place` は新しい `GameState` を返し、引数を変更しない(`board` は copy-on-write)。
- **決定性**: 同じ `(config, seed, 操作列)` から同じ状態になる。デイリーの根幹であり、テスト `determinism.test.ts` で担保。
- **時間非依存**: `Date.now()` を core で呼ばない。`now` は引数で渡す。

## 4. 設定と実験の解決(`src/config`)

### 4.1 `game-config.json`(既定値の正本)
```jsonc
{
  "schemaVersion": 1,
  "board": { "size": 10 },
  "pieces": {
    "weights": { "dot": 1.0, "h2": 1.0, "...": 0 },
    "noTripleDuplicate": true,
    "fitGuarantee": "oneOfThree",
    "pity": { "enabled": true, "threshold": 0.6, "smallBoost": 1.5 }
  },
  "scoring": { "perCell": 1, "lineBase": 10, "streak": { "step": 0.25, "max": 2.0 }, "boardClearBonus": 300 },
  "input": { "touchLiftOffset": 70, "previewClears": true },
  "daily": { "epoch": "2026-10-01", "shareGaugeMax": 6000 },
  "fx": { "clearDurationMs": 320, "snapDurationMs": 120 },
  "audio": { "bpm": 104, "volume": 0.32, "sfxVolume": 0.45 },
  "levels": { "goalBase": 3, "...": 0 }
}
```
zod スキーマ(`schema.ts`)で **範囲制約**を付ける(例: `threshold` は 0〜1、`weights` の各値は 0〜5、`size` は 6〜12)。**範囲外はビルド失敗**。これは改善エージェントの暴走に対する第一の物理的な壁。

### 4.2 `experiments.json`
```jsonc
{
  "schemaVersion": 1,
  "experiments": [
    {
      "id": "EXP-0003",
      "status": "running",                       // draft | running | concluded
      "startedAt": "2026-10-12T00:00:00Z",
      "hypothesis": "pity.threshold を 0.6→0.5 にすると 1 ゲームの長さが伸び、games/session が増える",
      "primaryMetric": "games_per_session",       // 04 のメトリクス ID
      "guardrails": ["crash_free", "median_game_seconds_min_120"],
      "minUsersPerArm": 300,
      "maxDays": 14,
      "allocation": { "control": 0.5, "treatment": 0.5 },
      "variants": {
        "control": {},
        "treatment": { "pieces": { "pity": { "threshold": 0.5 } } }   // config への deep-merge
      },
      "lockedInDaily": true                      // デイリーではオーバーライドを適用しない
    }
  ]
}
```
制約(zod + テスト): `running` は同時に **最大 1 つ**。`variants` のオーバーライドは `game-config` スキーマの partial に一致。`allocation` の合計は 1。

### 4.3 割り当て `assignVariant(installId, exp)`
`cyrb53(installId + ":" + exp.id) % 10000` を `allocation` の累積で区分。結果は `hamaru:v1:experiments` にキャッシュ(実験 ID ごとに固定)。テレメトリの全イベントに `exp` と `variant` を付与。

### 4.4 解決 `resolveConfig(base, experiments, installId, mode) → ResolvedConfig`
1. base を deep-clone。
2. `running` の実験があれば割り当てバリアントのオーバーライドを deep-merge(`mode === "daily"` かつ `lockedInDaily` なら無視)。
3. `mode === "daily"` なら §01-4.2 の強制(`fitGuarantee: "none"`, `pity.enabled: false`)。
4. スキーマで再検証。失敗なら base にフォールバックし `error` イベントを送る。

## 5. UI 層

- **ストア**: `createStore<T>(initial)` → `get / set / subscribe`。画面はストアを購読して DOM を差分更新(盤は 100 個の `div` を初期化時に作り、`data-c` 属性だけ更新)。
- **描画単位**: `board-view` は `GameState.board` と「プレビュー(ゴースト・消去予告)」の 2 レイヤを持つ。
- **演出**(`fx.ts`): `PlaceResult` を受け取り、CSS クラス切替 + WAAPI で実行。`prefers-reduced-motion` または設定で軽減時は**時間 0 で同じ最終状態**にする(状態遷移は演出に依存しない)。
- **入力**(`drag.ts`): Pointer Events のみ(Touch/Mouse Events は使わない)。`setPointerCapture` を使用。
- **ルータ**: `hashchange`。画面は `mount(container) → unmount()` を持つ。

## 6. テレメトリクライアント(`src/telemetry`)

- `track(event)`: 共通フィールド(`installId`, `sessionId`, `ts`, `version`, `lang`, `exp`, `variant`, `platform`)を付与してキューへ。
- フラッシュ条件: `game_end` 直後、`visibilitychange → hidden`、キュー 20 件、または 30 秒。
- 送信: `navigator.sendBeacon("/api/events", blob)`。不可なら `fetch(..., { keepalive: true })`。
- 失敗時は `localStorage` に保持し次回起動時に再送(最大 200 件、古いものから破棄)。
- **Do Not Track / GPC**: `navigator.globalPrivacyControl === true` なら送信しない(ローカル動作のみ)。

## 7. Worker(`worker/index.ts`)

```ts
export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    if (url.pathname === "/api/events" && req.method === "POST") return handleEvents(req, env, ctx);
    if (url.pathname === "/api/health") return Response.json({ ok: true, version: env.APP_VERSION });
    return env.ASSETS.fetch(req);
  }
} satisfies ExportedHandler<Env>;
```

### `/api/events`
- 受信: JSON `{ events: Event[] }`、最大 20 件、本文 16 KB 以下。`Origin` が自ホストでなければ 403。
- 検証: `worker/schema.ts`(zod)。1 件でも不正なら 400(クライアント側のバグを早期に露見させる)。
- 書き込み: 1 件につき `env.EVENTS.writeDataPoint({...})`(マッピングは [04](04-telemetry-and-metrics.md))。**1 リクエスト最大 250 点の AE 制限**に対し 20 件なので余裕。
- 応答: `204`。処理は `ctx.waitUntil` に入れない(writeDataPoint は同期的にバッファされる)。
- `request.cf.country` を粗い地域として blob に入れる。IP は保存しない。

### `wrangler.jsonc`
```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "hamaru",
  "main": "worker/index.ts",
  "compatibility_date": "2026-09-01",
  "assets": {
    "directory": "./dist",
    "binding": "ASSETS",
    "not_found_handling": "404-page",
    "run_worker_first": ["/api/*"]
  },
  "analytics_engine_datasets": [{ "binding": "EVENTS", "dataset": "hamaru_events" }],
  "vars": { "APP_VERSION": "dev" },
  "observability": { "enabled": true }
}
```
`APP_VERSION` はデプロイ時に `--var APP_VERSION:<git sha>` で上書き。

### `public/_headers`
```
/*
  Content-Security-Policy: default-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self'; manifest-src 'self'; worker-src 'self'
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=()
/assets/*
  Cache-Control: public, max-age=31536000, immutable
```
フォントはセルフホスト(Google Fonts への接続を CSP で禁止 → 起動が速く、プライバシー説明も単純)。

## 8. ビルドとデプロイ

```
npm run check   = validate:config && typecheck && lint && i18n:check
npm run test    = vitest run
npm run sim     = tsx sim/run.ts --games 2000 --bots greedy,random
npm run build   = vite build(dist/ 生成)
npm run deploy  = wrangler deploy --var APP_VERSION:$GIT_SHA
```

- **本番**: `main` への push → `deploy.yml` → `check` → `test` → `build` → `wrangler deploy` → `canary.yml` を起動。
- **プレビュー**: PR ごとに `wrangler versions upload`(本番トラフィックに影響しないプレビュー URL が返る)を実行し、URL を PR コメントに貼る。**要確認(実装時)**: プレビュー URL の取得方法は wrangler の出力仕様に従う。
- **ロールバック**: `wrangler rollback` または revert コミット。改善ループは **revert PR** 方式を採る(履歴が残る)。
- 同時デプロイ防止: `concurrency: { group: deploy, cancel-in-progress: false }`。

### 必要なシークレット / 変数(人間が設定)
| 名前 | 種別 | 用途 |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` | secret | Workers 編集 + Account Analytics Read(SQL API 用に同じトークンで可) |
| `CLOUDFLARE_ACCOUNT_ID` | secret | wrangler / SQL API |
| `ANTHROPIC_API_KEY` | secret | claude-code-action |
| `KAIZEN_ENABLED` | variable | `"true"` 以外なら改善ワークフローは即終了 |
| `KAIZEN_AUTOMERGE` | variable | `"true"` なら安全クラスの PR を自動マージ |

## 9. 性能・サイズ予算(CI で強制)

| 項目 | 予算 |
|---|---|
| 初回 JS(gzip) | ≤ 60 KB |
| CSS(gzip) | ≤ 15 KB |
| フォント合計 | ≤ 120 KB(サブセット化、`font-display: swap`) |
| LCP(モバイル、Lighthouse CI) | ≤ 1.5 s |
| INP | ≤ 100 ms |
| Lighthouse Performance / Accessibility | ≥ 95 / ≥ 95 |

## 10. セキュリティとプライバシー

- API は同一オリジンのみ。認証なし(書き込み専用・匿名)。
- `installId` はクライアント生成 UUID v4。サーバは検証のみ(形式)。
- AE には IP を書かない。国コードのみ。
- 依存は `npm audit --audit-level=high` を CI で実行。
- 改善エージェントは `worker/`, `.github/`, `package.json` を**変更できない**(05 のポリシー + CI の変更パス検査)。

## 11. 実装ノート(実装フェーズで解消した曖昧さ)

### N-1. `ResolvedConfig` の *型* は `src/core/types.ts` に置く(§2 / §3)
§2 は「core は何も import しない(型と自身のみ)」と定めるが、
§3 の `newGame(config: ResolvedConfig, ...)` は config 層の型を要求する。
依存方向を守るため、**`ResolvedConfig` とその構成要素の型は core に置き**、
`src/config/schema.ts` の zod スキーマがその型に一致することを
`parseGameConfig(input): ResolvedConfig` の戻り型で**コンパイル時に**検証する。
(スキーマの推論型が core の契約からずれた瞬間に `npm run typecheck` が落ちる。)

eslint の `no-restricted-imports` は `src/core/**` に対して
「`./` で始まる相対 import 以外すべて禁止」という正規表現で強制している。

### N-2. `resolveConfig` の失敗通知は `onError` コールバック(§4.4)
§4.4 は「再検証に失敗したら base にフォールバックし `error` イベントを送る」とあるが、
config 層は telemetry を import できない(§2 の依存方向)。
そこで `resolveConfig(base, experiments, installId, mode, onError?)` の
第 5 引数に通知用コールバックを受け、送信の責務は呼び出し側(UI / telemetry)に置いた。

### N-3. `serialize` の base64 は core 内の自前実装(§3)
`btoa` はブラウザ固有、`Buffer` は Node 固有で、どちらも core の純粋性に反する。
`game.ts` に依存のない base64 エンコーダ / デコーダ(`encodeBoard` / `decodeBoard`)を実装した。

### N-4. UI 層に 1 ファイルだけ追加(`src/ui/dom.ts`)(§2)
フレームワークを使わない方針(§1)で 5 画面を書くと `document.createElement` の定型が
全画面に散るため、要素生成・inline SVG・`{name}` 差し替えだけの薄いヘルパを
`src/ui/dom.ts` に切り出した(依存は増やしていない)。
また §2 のツリーには「アプリ全体で共有する状態(install / 解決済み config / 実験割り当て)」の
置き場が無いので、購読対象(設定・統計)と一緒に `src/ui/store.ts` に置いた。

### N-5. PWA は `clientsClaim` を有効にする(§1)
`registerType: "autoUpdate"` の既定では初回訪問のタブが SW に制御されず、
「登録した直後にオフラインにするとリロードで落ちる」状態になる。
`workbox.clientsClaim: true` を足して初回から制御させ、E2E(06 §5 `offline`)で担保した。
開発サーバでは SW を登録しない(`devOptions.enabled: false`)。

### N-6. 初回 JS の内訳(§9)
M3 時点で JS 43.9 KB gzip(予算 60 KB)。うち約 6 割が zod(config / experiments の
実行時検証)で、残りが UI + core。将来 60 KB に迫ったら、まず zod を
「起動時は検証しない(ビルド時の `validate:config` に任せる)」形へ動かすのが効く。

### N-7. zod は `jitless` で使う(§7 CSP)
zod 4 は既定で `new Function("")` を試して JIT の可否を調べる。例外は握りつぶされるが、
`public/_headers` の CSP(`script-src` は `'self'` のみ)の下ではブラウザが
`securitypolicyviolation` を報告し、コンソールにエラーが出る。
`src/config/schema.ts` の先頭で `z.config({ jitless: true })` を呼び、試行そのものを止めた。
検証結果は同じ。`wrangler dev` 上で Chromium / WebKit とも CSP 違反 0 件を確認している。

### N-8. Worker の型検査は別 tsconfig(§7)
Worker は DOM ではなく workerd のランタイム型で検査する。`worker-configuration.d.ts` は
`npm run cf:types`(= `wrangler types`)の生成物でコミット対象、lint / prettier の対象外。
`npm run typecheck` は `tsc --noEmit && tsc --noEmit -p tsconfig.worker.json` の 2 段。

### N-9. `_headers` は Workers Static Assets がそのまま解釈する(§7)
`public/_headers` は `vite build` で `dist/_headers` にコピーされ、`wrangler dev` 上で
HTML に CSP / nosniff、`/assets/*` に `immutable` が付くことを curl で確認した。
Worker 側でヘッダを足す必要はない。

### N-10. ブラウザは config を zod で検証しない(§4.4 / §9)
M5 で Lighthouse CI(モバイル・擬似スロットリング)を回すと **LCP 1.70 秒**で予算 1.5 秒を超えた。
LCP 要素は JS が描く文字で、内訳の 73 % が描画待ち(JS のダウンロードと実行)。初回 JS 47 KB のうち約 6 割が zod だった。
「HTML に静的な骨組みを置く」案も比べたが、ゲーム画面は JS 依存のまま残るので、全画面に効く次の形にした。

- `src/config/index.ts` は JSON をそのまま型付けして使い、`resolveConfig` は `validate` を**渡されたときだけ**再検証する
  (Node 側の sim / テストは zod の検証関数を渡す)。`resolve.ts` / `index.ts` は schema を型としてしか import しない(単体テストで検査)。
- 代わりに `npm run validate:config` が **全実験(concluded 以外)× 全バリアント × 両モードの解決結果**を zod で検証する。
  `npm run build` は `validate:config && vite build`、CI の G1 と deploy も必ず先に通すので、範囲外の config は配信されない。

結果: 初回 JS **47.35 → 22.04 KB gzip**、LCP **1.70 → 1.39 秒**(ローカルの lhci、3 回の中央値)。
§4.4 手順 4 の「失敗なら base にフォールバック」は、実行時ではなくビルド時に失敗させる形になった。

### N-11. PR プレビューは本番の指標に書き込まない(§8)
`wrangler.jsonc` で `preview_urls: true` にし、PR ごとに `wrangler versions upload --preview-alias pr-<n> --var TELEMETRY:off`
で上げる(URL は `pr-<n>-hamaru.<subdomain>.workers.dev`)。プレビューは本番と同じ Analytics Engine データセットに
バインドされるため、Worker は `TELEMETRY=off` のとき**検証だけして書き込まない**。`/api/health` は `telemetry` の真偽も返す。
`wrangler types` はリテラル型を生成するので `npm run cf:types` は `--strict-vars=false` を付ける。

### N-12. デプロイはクライアントと Worker に同じ版を入れ、必ず config を検証する(§8)
2026-09-17 の Metrics check で、テレメトリの `version` が常に `"dev"` だと分かった。クライアントはビルド時の
`VITE_APP_VERSION` を読むが、`npm run deploy` は Worker の `APP_VERSION` しか設定していなかった。
また `deploy` が `vite build` を直接呼び、N-10 の前提である `validate:config` を通っていなかった。
`deploy` を `validate:config && VITE_APP_VERSION=$GIT_SHA vite build && wrangler deploy --var APP_VERSION:$GIT_SHA` に直し、
`tests/unit/scripts-contract.test.ts` でこの順序と版の注入を固定した。PR プレビューも `VITE_APP_VERSION=pr-<n>-<sha>` でビルドする。

### N-15. 長い文章は初回 JS に載せない(§9 の予算、2026-09-22)
「このゲームについて」(docs/01 §9.6)を書いたら、文言だけで gzip 1.8 KB 増え、
Lighthouse の LCP が 1507〜1533 ms(予算 1500 ms)になって budget が落ちた。

- `about.*` のキーを `src/i18n/about.{ja,en}.json` に分け、**その画面を開いた時に、表示中の言語のぶんだけ**
  読み込む(`addMessages`)。初回 JS は 30.56 KB(About を直に入れると 32.9 KB)
- 読み込みが終わるまでは空の枠を出す。戻るボタンは枠にも効く
- `npm run i18n:check` は分割したファイルも合わせて検査する(両言語同時の約束は変わらない)

この形は、これから画面ごとに文章が増えても使える。**文章の量で初回表示を遅くしない**。

### N-14. 新しい版をすぐ届ける(`skipWaiting`)(§1 PWA、2026-09-21)
`registerType: "autoUpdate"` + `injectRegister: "script-defer"` の組み合わせだと、生成される SW は
**`SKIP_WAITING` メッセージを受け取ったときだけ** `self.skipWaiting()` を呼ぶ。だが script-defer で
差し込まれる `registerSW.js` は素の `register()` だけで、そのメッセージを送らない。
結果、新しい SW は `waiting` のまま止まり、**アプリを開いたことのある人には全部のタブを閉じるまで
古い版が出続ける**(実際にデプロイ後、再読み込みを 2 回しても古いバンドルのままだった)。

`workbox.skipWaiting: true` を足して、新しい SW が入った時点で有効になるようにした
(`clientsClaim` と合わせて、次の読み込みから新しい資産になる)。
版が入れ替わった直後は古い遅延チャンク(音)が取れないことがあるので、`import()` の失敗は
握りつぶして次の操作で取り直す。

### N-13. ランキング(docs/08)の構成
- Worker の経路に `/api/daily/submit` `/api/leaderboard` `/api/leaderboard/me` `/api/profile` `/api/profile/delete` を追加(`worker/leaderboard.ts`)。
  POST はすべて Origin 検査。installId は本文で送り、URL には載せない
- D1 バインディング `DB`(`hamaru`)。スキーマは `migrations/`(human-only)。deploy.yml がデプロイ前に `d1 migrations apply --remote`
- `LEADERBOARD=off` で書き込みを止める(PR プレビュー)。`TELEMETRY=off` と同じ考え方
- 得点は `src/core/replay.ts` で手の列を再生して決める。Worker は `src/config` と `src/core` をそのままバンドルする
- 単体テストは wrangler の `getPlatformProxy` で**本物のローカル D1** を立て、`migrations/` を適用して SQL ごと検証する
  (`tests/fixtures/wrangler.d1-test.jsonc` は D1 だけの設定。CI の unit ジョブはビルドしないので静的資産を要求しない形にした)
- 初回 JS は 25.98 KB gzip(ランキング画面を含む)
