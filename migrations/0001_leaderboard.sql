-- ランキング(docs/08 §4)。変更は新しい番号のファイルを足す(既存のファイルは書き換えない)。

CREATE TABLE players (
  player      TEXT PRIMARY KEY,
  nickname    TEXT,
  nickname_at INTEGER,
  created_at  INTEGER NOT NULL
);

CREATE TABLE daily_scores (
  date          TEXT NOT NULL,
  player        TEXT NOT NULL,
  score         INTEGER NOT NULL,
  lines         INTEGER NOT NULL,
  moves         INTEGER NOT NULL,
  submission_id TEXT NOT NULL,
  submitted_at  INTEGER NOT NULL,
  PRIMARY KEY (date, player)
);
CREATE INDEX daily_rank ON daily_scores (date, score DESC, submitted_at);

CREATE TABLE totals (
  period     TEXT NOT NULL,
  key        TEXT NOT NULL,
  player     TEXT NOT NULL,
  total      INTEGER NOT NULL,
  days       INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (period, key, player)
);
CREATE INDEX totals_rank ON totals (period, key, total DESC, updated_at);
