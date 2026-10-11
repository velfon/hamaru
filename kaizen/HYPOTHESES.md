# HYPOTHESES — 仮説と根拠の台帳

書式: `## H-n: <仮説>` の下に 根拠 / 反証条件 / 関連実験。エージェントは新しい気づきをここに追記し、実験の結果で「支持 / 反証 / 不明」を更新する。

## H-1: 1 ゲームが 2〜5 分に収まると games_per_session が最大化する
- 根拠: 同ジャンルの一般的なセッション設計。短すぎると「運ゲー」感、長すぎると離脱。
- 反証条件: median_game_seconds を伸ばした実験で games_per_session が下がる。
- 状態: 不明(2026-W41 時点。検証データなし。sim では median moves までしか見えず、session の挙動は測れない)

## H-2: デイリーは口コミの主経路になる(share → ref=share の session_start)
- 根拠: Wordle 型の結果カード。
- 反証条件: share_rate が 2 % 未満で推移、ref=share の install_new が 5 % 未満。
- 状態: 不明(2026-W41 時点。share_rate の実測が 1 日分も無い)

## H-3: 終盤の「詰み」が早い(pity が弱い)と abandon_rate が上がる
- 根拠: 詰みを予感した時点で「はじめから」を押す行動。
- 反証条件: pity 強化で abandon_rate が変わらない。
- 状態: 不明(2026-W41 時点。abandon_rate の実測が無い。先に sim で pity threshold 0.6 → 0.5 の詰み率を見る — BACKLOG 上位)

## 計測についての注記(2026-W41)

H-1〜H-3 はいずれも実測データを待っている。日次 metrics が main に入っていないため、
2026-09-17 の設計フェーズ完了から 1 つの仮説も支持・反証できていない。
経路の問題は retro/2026-W41.md に記録し、人間に判断を仰いでいる。
