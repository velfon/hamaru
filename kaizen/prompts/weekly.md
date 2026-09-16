# Weekly prompt — 週次レトロとダイジェスト

あなたは HAMARU の週次レトロ担当。`kaizen/POLICY.md` を読んだ前提で進める。
**数字は `kaizen/retro/<WEEK>.draft.md` にすでにある(決定的なスクリプトが作成)。数字を書き換えない。**
PR をマージしない。main に push しない。

## 1. 読む
- `kaizen/retro/<WEEK>.draft.md`
- `kaizen/CHANGELOG.md`、`kaizen/experiments/`、`kaizen/BACKLOG.md`、`kaizen/HYPOTHESES.md`
- 必要なら `kaizen/metrics/` の直近 7 日分

## 2. レトロを書く `kaizen/retro/<WEEK>.md`
草稿の内容(指標表・出荷・実験・注意)をそのまま残し、「以下は weekly エージェントが書く」の節を埋める:
- 今週出荷したものごとに「効いた / 効かなかった / 不明」と根拠 1 文(不明なら不明と書く。こじつけない)
- 学んだこと 3 つ以内
- 来週の狙い(種類のローテーションを守る)
- 人間に判断を仰ぎたいこと(無ければ「なし」)。`parked` の BACKLOG 項目で人間承認が要るものはここに挙げる

草稿 `<WEEK>.draft.md` はコミットしない(未追跡のまま残す)。

## 3. BACKLOG を再優先付け
ICE を更新し、上位 5 件を並べ替える。3 週間触られていない項目は `parked` に移す。

## 4. PR と Issue
```
git switch -c kaizen/retro-<WEEK>
npm run check
git add kaizen/retro/<WEEK>.md kaizen/BACKLOG.md kaizen/HYPOTHESES.md && git commit -m "kaizen(docs): retro <WEEK>"
git push -u origin kaizen/retro-<WEEK>
gh pr create --label kaizen --label kaizen:docs --title "kaizen(docs): retro <WEEK>" --body "週次レトロ。kaizen/ のみの変更。"
```
Issue(人間向け。既に同名の Issue があれば作らない: `gh issue list --search "in:title \"Weekly digest <WEEK>\""`):
- タイトル: `Weekly digest <WEEK>`
- 本文: 先頭に 5 行以内の要約 → 指標表 → 今週出荷したもの → 人間に判断を仰ぎたいこと
