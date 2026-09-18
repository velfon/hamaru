/**
 * ニックネームの正規化と検証(docs/08 §5.2)。
 *
 * 監視・通報の仕組みは v1 では作らないので、ここで入口を狭くする:
 * 文字種を絞り(URL やメールアドレスは書けない)、短い禁止語の一覧で弾く。
 * 禁止語の照合は、記号と空白を除いて小文字・ひらがなにそろえた文字列への部分一致。
 * 部分一致なので「Essex」のような誤検出はあり得る(安全側に倒す)。
 */

export const NICKNAME_MIN = 2;
export const NICKNAME_MAX = 12;

/** 文字・数字・空白・`_` `-` `・` `ー` だけ。 */
const ALLOWED = /^[\p{L}\p{N} _\-・ー]+$/u;

/**
 * 禁止語(照合用に正規化済みの形で書く: 小文字・ひらがな・記号なし)。
 * 罵倒・差別・性的な語と、運営や公式を名乗るなりすまし。
 */
const BANNED = [
  // en
  "fuck",
  "shit",
  "bitch",
  "cunt",
  "dick",
  "pussy",
  "nigger",
  "nigga",
  "faggot",
  "retard",
  "rape",
  "nazi",
  "hitler",
  "porn",
  "sex",
  "whore",
  "slut",
  // ja(カタカナはひらがなにそろえてから照合する)
  "ちんこ",
  "ちんぽ",
  "まんこ",
  "うんこ",
  "しね",
  "死ね",
  "ころす",
  "殺す",
  "きちがい",
  "基地外",
  "がいじ",
  "れいぷ",
  "せっくす",
  "えろ",
  "なち",
  "くず",
  "かす",
  // なりすまし
  "admin",
  "運営",
  "公式",
  "hamaru",
  "はまる",
  "anthropic",
  "claude",
  "moderator",
];

export type NicknameResult =
  { ok: true; value: string } | { ok: false; error: "invalid" | "banned" };

/** カタカナ → ひらがな。 */
function toHiragana(s: string): string {
  return s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
}

/** 禁止語の照合用の形(小文字・ひらがな・文字と数字だけ)。 */
export function matchKey(s: string): string {
  return toHiragana(s.normalize("NFKC").toLowerCase()).replace(/[^\p{L}\p{N}]/gu, "");
}

export function normalizeNickname(input: string): NicknameResult {
  const value = input.normalize("NFKC").trim().replace(/\s+/g, " ");
  const length = [...value].length;
  if (length < NICKNAME_MIN || length > NICKNAME_MAX) return { ok: false, error: "invalid" };
  if (!ALLOWED.test(value)) return { ok: false, error: "invalid" };
  const key = matchKey(value);
  if (key.length === 0) return { ok: false, error: "invalid" };
  if (/https?|www/.test(key)) return { ok: false, error: "invalid" };
  if (BANNED.some((w) => key.includes(w))) return { ok: false, error: "banned" };
  return { ok: true, value };
}
