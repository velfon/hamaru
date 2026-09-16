/**
 * デイリーの日付・シード・通算番号(docs/01 §4.1、§7.2、§9.4)。
 * 日付は常に **UTC**。現在時刻は引数 `nowMs` で渡す(core は時計を読まない)。
 */

const MS_PER_DAY = 86_400_000;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** epoch ms → UTC の YYYY-MM-DD。 */
export function utcDateString(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

/** YYYY-MM-DD → その日 00:00:00 UTC の epoch ms。不正なら null。 */
export function parseUtcDate(date: string): number | null {
  const m = DATE_RE.exec(date);
  if (m === null) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const ms = Date.UTC(year, month - 1, day);
  // 2 月 30 日のような繰り上がりを弾く。
  if (utcDateString(ms) !== date) return null;
  return ms;
}

/** デイリーのシード文字列(全世界共通)。 */
export function dailySeed(date: string): string {
  return `daily:${date}`;
}

/** エンドレスのシード文字列。 */
export function endlessSeed(installId: string, startedAtMs: number): string {
  return `endless:${installId}:${startedAtMs}`;
}

/** epoch 日を #1 とする通算番号。epoch より前なら 0 以下になる。不正な日付なら null。 */
export function dailyNumber(date: string, epoch: string): number | null {
  const d = parseUtcDate(date);
  const e = parseUtcDate(epoch);
  if (d === null || e === null) return null;
  return Math.round((d - e) / MS_PER_DAY) + 1;
}

/** 次の UTC 日付境界までの残り ms(ホームの「残り時間」表示用)。 */
export function msUntilNextUtcDay(nowMs: number): number {
  const rem = ((nowMs % MS_PER_DAY) + MS_PER_DAY) % MS_PER_DAY;
  return MS_PER_DAY - rem;
}
