# BACKLOG

書式: `- [状態] 種類 | 内容 | 主要指標 | I/C/E | メモ`
状態: todo / doing / done / parked。種類: rule / ux / fx / perf / copy / funnel / fix。
ICE は各 1〜5。並び順が優先順位。

- [todo] fix | テレメトリが Analytics Engine に届いているかを確認する(metrics が 0 件) | (全指標の前提) | 5/4/4 | 2026-W39 で再優先。届いていないと他の全項目が評価不能。`worker/` に原因があれば Issue で人間へ
- [todo] copy | 逆手のルール説明(初回の伝わり方) | abandon_rate | 4/3/5 | 2026-09-24 の刷新でルールが変わったのに文言は未検証。実験不要の直接改善
- [todo] perf | 初回ロードのサイズ予算(docs/02 §9)に対する実測の余裕 | (ガードレール) | 3/4/4 | 指標を待たずに判断できる
- [todo] funnel | ホームのデイリーカードを最上段にする vs エンドレスを最上段 | daily_start_rate | 4/3/5 | 実験。UI のみ。指標が戻るまで着手しない
- [todo] ux | 消去プレビュー ON/OFF(`input.previewClears`) | abandon_rate | 3/3/5 | 実験。指標が戻るまで着手しない
- [todo] rule | `sakate.growEvery` 2 → 3(かけらが大きくなる速さ) | median_game_seconds | 4/2/5 | 刷新後の主要ノブ。sim で greedy median moves の変化を先に見る
- [todo] rule | `sakate.startTiles` 6 → 8(開始盤の密度) | abandon_rate | 3/2/5 | 刷新後の主要ノブ。実験
- [todo] rule | `sakate.maxPiece` 5 → 4 | median_game_seconds | 3/2/5 | 刷新後の主要ノブ。難易度が大きく変わる
- [todo] copy | 共有文言のゲージ有無 | share_rate | 3/2/5 | 実験
- [todo] rule | ストリーク `scoring.streak.step` 0.25 → 0.5 | games_per_session | 3/2/5 | 実験
- [todo] ux | タッチ持ち上げオフセット `input.touchLiftOffset` 70 → 90 | abandon_rate | 2/2/5 | 実験
- [todo] fx | 金継ぎ演出 `fx.clearDurationMs` 320 → 220 ms | games_per_session | 2/2/5 | 実験
- [parked] ux | ゲームオーバー画面に「楽しかった/難しすぎ/簡単すぎ」1 タップ | (新指標) | 4/2/3 | テレメトリ列の追記が要る。人間承認
- [parked] rule | タイムアタックモード | games | 4/2/2 | v1.1。人間承認
- [parked] rule | `pieces.pity.threshold` 0.6 → 0.5 | games_per_session | —/—/— | 2026-09-24 の逆手刷新で設定キーが消滅(乱数供給そのものが無い)。詰み対策は `sakate.growEvery` / `startTiles` に読み替え済み
- [parked] rule | sq3 の重み 0.35 → 0.25 | abandon_rate | —/—/— | 同上。かけらの重み表が存在しない(形は盤から導出)
- [parked] rule | fitGuarantee none vs oneOfThree(エンドレス) | median_game_seconds | —/—/— | 同上。`fitGuarantee` は `schema.ts` に無い
