# Weekly prompt — 週次レトロとダイジェスト

## 1. 読む
`kaizen/metrics/` の直近 7 日、`kaizen/CHANGELOG.md`、`kaizen/experiments/`、`scripts/kaizen-digest` が生成した `kaizen/retro/<WEEK>.draft.md`。

## 2. レトロを書く `kaizen/retro/<WEEK>.md`
- 指標表(7 日 vs 前 7 日): games, games_per_session, d1_return, daily_completion, share_rate, crash_free, lcp_p75
- 今週出荷したもの(CHANGELOG から)と、それぞれの「効いた / 効かなかった / 不明」
- 実験の状態
- 学んだこと 3 つ以内
- 来週の狙い(種類のローテーションを守る)
- 人間に判断を仰ぎたいこと(あれば。無ければ「なし」)

## 3. BACKLOG を再優先付け
ICE を更新し、上位 5 件を並べ替える。3 週間触られていない項目は `parked` に移す。

## 4. PR と Issue
- PR: `kaizen/` のみ(`safe-auto`)。タイトル `kaizen(retro): <WEEK>`。
- Issue: タイトル `Weekly digest <WEEK>`。本文はレトロの「指標表」「出荷したもの」「人間に判断を仰ぎたいこと」だけ(5 行の要約を先頭に)。既存の同名 Issue があれば作らない。
