# BACKLOG

書式: `- [状態] 種類 | 内容 | 主要指標 | I/C/E | メモ`
状態: todo / doing / done / parked。種類: rule / ux / fx / perf / copy / funnel / fix。
ICE は各 1〜5。並び順が優先順位。

2026-W41 の再優先付けの根拠: 日次 metrics が main に無く `installs_new` が測れないため、
POLICY「効果 10 % 未満の実験は 1 日の新規 install が 500 を超えるまで起票しない」により実験は 1 本も起票できない。
そこで **sim(`npm run sim`)でデータ無しに前進できるもの**を上げ、**生データが要るものの E を下げた**。
I と C は新しい証拠が無いので変えていない。

- [parked] fix | 日次 metrics が main に入らず、週次ダイジェストと実験判定が常に空になる経路を直す | (全指標の前提) | 5/5/2 | **最優先だが人間承認**。原因は .github/workflows/kaizen-daily.yml と kaizen/prompts/daily.md §3(どちらもエージェント禁止パス)。retro/2026-W41.md の「人間に判断を仰ぎたいこと」1 を参照
- [todo] rule | pieces.pity.threshold 0.6 → 0.5 | games_per_session | 4/3/5 | 実験。sim で greedy median moves の変化を先に見られる(計測なしで前進できる)
- [todo] rule | sq3 の重み 0.35 → 0.25 | abandon_rate | 3/3/5 | 実験。sim で先に見られる
- [todo] rule | fitGuarantee none vs oneOfThree(エンドレス) | median_game_seconds | 3/2/5 | 実験。sim で先に見られる。難易度が大きく変わる
- [todo] funnel | ホームのデイリーカードを最上段にする vs エンドレスを最上段 | daily_start_rate | 4/3/5 | 実験。UI のみ。A/B が回せないので、直接変更にするかは人間に問う(retro 2026-W41)
- [todo] ux | 消去プレビュー ON/OFF | abandon_rate | 3/3/5 | 実験。計測が戻ってから
- [parked] copy | 共有文言のゲージ有無 | share_rate | 3/2/2 | share_rate の生データが要る。2026-09-17 から未着手(3 週間ルール)
- [parked] rule | ストリーク step 0.25 → 0.5 | games_per_session | 3/2/2 | 生データが要る。2026-09-17 から未着手(3 週間ルール)
- [parked] ux | タッチ持ち上げオフセット 70 → 90 | abandon_rate | 2/2/2 | 生データが要る。2026-09-17 から未着手(3 週間ルール)
- [parked] fx | 金継ぎ演出 320 → 220 ms | games_per_session | 2/2/2 | 生データが要る。2026-09-17 から未着手(3 週間ルール)
- [parked] ux | ゲームオーバー画面に「楽しかった/難しすぎ/簡単すぎ」1 タップ | (新指標) | 4/2/3 | テレメトリ列の追記が要る。人間承認
- [parked] rule | タイムアタックモード | games | 4/2/2 | v1.1。人間承認
