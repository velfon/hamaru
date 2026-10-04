# BACKLOG

書式: `- [状態] 種類 | 内容 | 主要指標 | I/C/E | メモ`
状態: todo / doing / done / parked。種類: rule / ux / fx / copy / funnel / fix / perf。
ICE は各 1〜5。並び順が優先順位。

2026-W40 再優先付け: 指標が 1 件も観測できていないため(`kaizen/retro/2026-W40.md`)、
**A/B 実験は全件が計測の回復待ち**。POLICY「効果 10 % 未満の実験は 1 日の新規 install 500 まで起票しない」に該当する。
ローカル検証(test / sim / サイズ予算)で出荷判断できる項目を上に置いた。

- [todo] fix | 計測が無い前提で、既知のエラー・崩れを 1 件ずつ潰す(`npm test` と E2E で再現できるものだけ) | crash_free | 4/4/4 | 実データ不要。計測ゼロの週でも誠実に出荷判断できる
- [todo] perf | 初回ロードのサイズ予算と LCP の余裕を測り直す(`npm run build` + size-budget) | lcp_p75 | 3/4/4 | 実データ不要。docs/02 §9 の予算に対する現況を先に出す
- [todo] funnel | ホームのデイリーカードを最上段にする vs エンドレスを最上段 | daily_start_rate | 4/3/5 | 実験。UI のみ。**計測回復待ち**。回復後の 1 本目候補(効果が大きく出やすい)
- [todo] ux | 消去プレビュー ON/OFF(`input.previewClears`) | abandon_rate | 3/3/5 | 実験。**計測回復待ち**
- [todo] rule | `sakate.growEvery` 2 → 3(消さずにいるとかけらが重くなる速さを緩める) | median_game_seconds | 3/3/5 | 実験。**計測回復待ち**。sim で greedy median moves の変化を先に見る。旧「pieces.pity.threshold 0.6 → 0.5」は逆手刷新で設定キーが消滅したため差し替え(H-3)
- [todo] rule | `scoring.streak.step` 0.25 → 0.5 | games_per_session | 3/2/5 | 実験。**計測回復待ち**
- [todo] copy | 共有文言のゲージ有無(`daily.shareGaugeMax`) | share_rate | 3/2/5 | 実験。**計測回復待ち**
- [todo] rule | `sakate.startTiles` 6 → 8(開始盤を混ませる) | abandon_rate | 3/2/5 | 実験。**計測回復待ち**。旧「sq3 の重み 0.35 → 0.25」は逆手にかけらの出現確率が無いため差し替え
- [todo] ux | タッチ持ち上げオフセット(`input.touchLiftOffset`)70 → 90 | abandon_rate | 2/2/5 | 実験。**計測回復待ち**
- [todo] fx | 金継ぎ演出(`fx.clearDurationMs`)320 → 220 ms | games_per_session | 2/2/5 | 実験。**計測回復待ち**
- [todo] rule | `sakate.window` 3 → 5(エンドレス) | median_game_seconds | 2/2/5 | 実験。**計測回復待ち**。難易度が大きく変わる。旧「fitGuarantee none vs oneOfThree」は逆手に詰み保証が無いため差し替え
- [parked] fix | `kaizen/metrics/` が main に残らない(週次が永久に数字ゼロになる) | — | 5/4/2 | `.github/` に触る必要があり人間承認。詳細は `kaizen/retro/2026-W40.md`「人間に判断を仰ぎたいこと」2
- [parked] ux | ゲームオーバー画面に「楽しかった/難しすぎ/簡単すぎ」1 タップ | (新指標) | 4/2/3 | テレメトリ列の追記が要る。人間承認。計測が薄い時期こそ効きうる
- [parked] rule | タイムアタックモード | games | 4/2/2 | v1.1。人間承認
