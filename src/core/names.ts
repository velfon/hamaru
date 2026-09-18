/**
 * 自動の匿名名(docs/08 §5.1)。player(SHA-256 の 16 進)から、形容・職・番号を決める。
 * 文言は i18n の `name.adj.<n>` / `name.noun.<n>`。ここは番号を決めるだけの純粋関数。
 */

export const NAME_ADJECTIVES = 16;
export const NAME_NOUNS = 8;

export type AutoName = readonly [adj: number, noun: number, num: number];

/** 16 進文字列(8 文字以上)→ 自動の匿名名の番号。不正なら null。 */
export function autoName(playerHex: string): AutoName | null {
  if (!/^[0-9a-f]{8,}$/.test(playerHex)) return null;
  const adj = parseInt(playerHex.slice(0, 2), 16) % NAME_ADJECTIVES;
  const noun = parseInt(playerHex.slice(2, 4), 16) % NAME_NOUNS;
  const num = parseInt(playerHex.slice(4, 8), 16) % 10_000;
  return [adj, noun, num];
}
