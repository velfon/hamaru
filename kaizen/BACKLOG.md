# BACKLOG

書式: `- [状態] 種類 | 内容 | 主要指標 | I/C/E | メモ`
状態: todo / doing / done / parked。種類: rule / ux / fx / perf / copy / funnel / fix。
ICE は各 1〜5。並び順が優先順位。

- [todo] funnel | ホームのデイリーカードを最上段にする vs エンドレスを最上段 | daily_start_rate | 4/3/5 | 実験。UI のみ
- [todo] rule | pieces.pity.threshold 0.6 → 0.5 | games_per_session | 4/3/5 | 実験。sim で greedy median moves の変化を先に見る
- [todo] ux | 消去プレビュー ON/OFF | abandon_rate | 3/3/5 | 実験
- [todo] copy | 共有文言のゲージ有無 | share_rate | 3/2/5 | 実験
- [todo] rule | sq3 の重み 0.35 → 0.25 | abandon_rate | 3/3/5 | 実験
- [todo] rule | ストリーク step 0.25 → 0.5 | games_per_session | 3/2/5 | 実験
- [todo] ux | タッチ持ち上げオフセット 70 → 90 | abandon_rate | 2/2/5 | 実験
- [todo] fx | 金継ぎ演出 320 → 220 ms | games_per_session | 2/2/5 | 実験
- [todo] rule | fitGuarantee none vs oneOfThree(エンドレス) | median_game_seconds | 3/2/5 | 実験。難易度が大きく変わる
- [parked] ux | ゲームオーバー画面に「楽しかった/難しすぎ/簡単すぎ」1 タップ | (新指標) | 4/2/3 | テレメトリ列の追記が要る。人間承認
- [parked] rule | タイムアタックモード | games | 4/2/2 | v1.1。人間承認
