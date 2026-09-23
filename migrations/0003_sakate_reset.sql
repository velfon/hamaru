-- ルールを「逆手」に全面刷新した(docs/01、2026-09-24)。
--
-- 旧ルール(はめ込み)で出た得点は、新しいルールの得点と比べられない。手の形式も
-- `[トレイ, x, y]` から `[x, y]` に変わったので、**古い記録はサーバで再生し直せない**。
-- 混ぜるとランキングが意味を失うので、古い表は残したまま脇へ寄せ、空の表から始める。
--
-- `players`(ニックネーム)はそのまま。名前は本人のもので、ルールとは関係ない。

ALTER TABLE daily_scores RENAME TO daily_scores_v1;
ALTER TABLE totals RENAME TO totals_v1;

CREATE TABLE daily_scores (
  date          TEXT NOT NULL,
  player        TEXT NOT NULL,
  score         INTEGER NOT NULL,
  lines         INTEGER NOT NULL,
  moves         INTEGER NOT NULL,
  submission_id TEXT NOT NULL,
  submitted_at  INTEGER NOT NULL,
  attempts      INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (date, player)
);
-- 索引は旧表に付いたまま名前を保つので、新しい表には別の名前を付ける。
CREATE INDEX daily_rank_v2 ON daily_scores (date, score DESC, submitted_at);

CREATE TABLE totals (
  period     TEXT NOT NULL,
  key        TEXT NOT NULL,
  player     TEXT NOT NULL,
  total      INTEGER NOT NULL,
  days       INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (period, key, player)
);
CREATE INDEX totals_rank_v2 ON totals (period, key, total DESC, updated_at);
