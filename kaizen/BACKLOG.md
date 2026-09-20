# BACKLOG

書式: `- [状態] 種類 | 内容 | 主要指標 | I/C/E | メモ`
状態: todo / doing / done / parked。種類: rule / ux / fx / perf / copy / funnel / fix。
ICE は各 1〜5。並び順が優先順位。

最終更新: 2026-W38 の週次レトロ。traffic がゼロ(metrics 未取得)のため、
**traffic 無しで進められるもの(計測・sim で確かめる rule)を上に、A/B 前提のものを下に**並べ替えた。
POLICY 判断の規則により、1 日の新規 install が 500 を超えるまで効果 10 % 未満の実験は起票しない。
3 週間触られていない項目は無し(この BACKLOG は 2026-09-17 作成)。

- [todo] fix | レベルモードの開始率・クリア率を metrics に追加(既存の mode / reason 列のみ。列は追記しない) | level_clear_rate | 4/4/4 | 新規(W38)。traffic 無しでも実装できる。これが無いとレベルモードの評価が永久にできないので pity と同点だが上に置く。docs/04 の集計節を同じ PR で更新
- [todo] rule | pieces.pity.threshold 0.6 → 0.5 | games_per_session | 4/3/5 | sim で greedy median moves と帯域の変化を先に見る。sim で語れなければ出荷しない
- [todo] rule | sq3 の重み 0.35 → 0.25 | abandon_rate | 3/3/5 | 同上。sim で先に確認できる
- [todo] rule | fitGuarantee none vs oneOfThree(エンドレス) | median_game_seconds | 3/2/5 | 難易度が大きく変わる。sim で幅を見てから実験にする
- [todo] funnel | ホームのデイリーカードを最上段にする vs エンドレスを最上段 | daily_start_rate | 4/2/5 | 実験。UI のみ。C 3→2: traffic ゼロでは判定できない
- [todo] ux | 消去プレビュー ON/OFF | abandon_rate | 3/2/5 | 実験。C 3→2: 同上
- [todo] copy | 共有文言のゲージ有無 | share_rate | 3/2/5 | 実験。share の母数が daily game_end なので特に traffic 待ち
- [todo] rule | ストリーク step 0.25 → 0.5 | games_per_session | 3/2/5 | 実験
- [todo] ux | タッチ持ち上げオフセット 70 → 90 | abandon_rate | 2/2/5 | 実験
- [todo] fx | 金継ぎ演出 320 → 220 ms | games_per_session | 2/2/5 | 実験
- [parked] fix | game_end にレベル番号を足す(レベル別の離脱点) | level_clear_rate | 3/4/3 | 新規(W38)。blob の追記 = worker/ なので人間承認
- [parked] ux | ゲームオーバー画面に「楽しかった/難しすぎ/簡単すぎ」1 タップ | (新指標) | 4/2/3 | テレメトリ列の追記が要る。人間承認
- [parked] rule | タイムアタックモード | games | 4/2/2 | v1.1。人間承認
