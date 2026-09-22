/**
 * i18n(docs/01 §12、docs/03 §7)。
 *
 * - キーはドット区切り。文言の追加は **ja / en 同時**(`npm run i18n:check` が差分で落ちる)。
 * - 長い文章(`about.*`)は初回 JS に載せず、その画面が開いた時に読み込んで `addMessages` で足す
 *   (docs/02 §11 N-15)。
 * - 自動判定は `navigator.languages` の先頭が `ja*` なら ja、それ以外 en。
 * - 数値は `Intl.NumberFormat`、日付は `Intl.DateTimeFormat`。
 */
import en from "./en.json";
import ja from "./ja.json";

export type Lang = "ja" | "en";

export const MESSAGES: Record<Lang, Record<string, string>> = { ja, en };

/** 後から読み込んだ文言を足す(画面ごとの遅延読み込み)。同じキーは上書きする。 */
export function addMessages(lang: Lang, extra: Record<string, string>): void {
  Object.assign(MESSAGES[lang], extra);
}

export type MessageKey = keyof typeof ja;

let current: Lang = "ja";

/** `navigator.languages` から表示言語を決める。 */
export function detectLang(languages: readonly string[] | undefined): Lang {
  const first = languages?.[0] ?? "";
  return first.toLowerCase().startsWith("ja") ? "ja" : "en";
}

export function setLang(lang: Lang): void {
  current = lang;
}

export function getLang(): Lang {
  return current;
}

/** 文言を取得する。`{name}` を `params` で置換する。未知のキーはキー自身を返す。 */
export function t(
  key: MessageKey | string,
  params?: Readonly<Record<string, string | number>>,
): string {
  const table = MESSAGES[current];
  const raw = table[key] ?? MESSAGES.en[key] ?? key;
  if (params === undefined) return raw;
  return raw.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name];
    return value === undefined ? match : String(value);
  });
}

/** 3 桁区切り(docs/01 §6「表示は 3 桁区切り」)。 */
export function formatNumber(n: number): string {
  return new Intl.NumberFormat(current === "ja" ? "ja-JP" : "en-US").format(n);
}

/** ホームのデイリーカードの日付。 */
export function formatDate(date: string): string {
  const ms = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(ms)) return date;
  return new Intl.DateTimeFormat(current === "ja" ? "ja-JP" : "en-US", {
    month: "numeric",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(ms));
}

/** 残り時間 `hh:mm`(docs/03 §6 DailyCard)。 */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 60000));
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
