-- 1 日に何度でも挑戦でき、その日の**ベスト**が記録になる(docs/08 §1、2026-09-21)。
-- score はその日の最高点、attempts はその日の送信回数。
ALTER TABLE daily_scores ADD COLUMN attempts INTEGER NOT NULL DEFAULT 1;
