/**
 * i18n のキー差分検査(docs/01 §12「文言の追加は両言語同時が必須」)。
 *
 *   npm run i18n:check
 *
 * 落ちる条件:
 *   - ja / en でキー集合が違う
 *   - 値が空文字
 *   - `{placeholder}` の集合が言語間で違う(置換漏れは実行時に見えないため)
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const dir = resolve(here, "../src/i18n");

function load(lang: string): Record<string, string> {
  const raw = readFileSync(resolve(dir, `${lang}.json`), "utf8");
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${lang}.json がオブジェクトではありません`);
  }
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(parsed)) {
    if (typeof v !== "string") throw new Error(`${lang}.json: ${k} の値が文字列ではありません`);
    out[k] = v;
  }
  return out;
}

function placeholders(s: string): string[] {
  return [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1] ?? "").sort();
}

// 画面ごとに遅延読み込みする文言も同じ規則で検査する(docs/02 §11 N-15)。
const FILES = ["", "about."] as const;
const ja = Object.assign({}, ...FILES.map((prefix) => load(`${prefix}ja`))) as Record<
  string,
  string
>;
const en = Object.assign({}, ...FILES.map((prefix) => load(`${prefix}en`))) as Record<
  string,
  string
>;
const errors: string[] = [];

for (const key of Object.keys(ja)) {
  if (!(key in en)) errors.push(`en.json に無いキー: ${key}`);
}
for (const key of Object.keys(en)) {
  if (!(key in ja)) errors.push(`ja.json に無いキー: ${key}`);
}
for (const [lang, table] of [
  ["ja", ja],
  ["en", en],
] as const) {
  for (const [key, value] of Object.entries(table)) {
    if (value.trim() === "") errors.push(`${lang}.json: ${key} が空です`);
  }
}
for (const key of Object.keys(ja)) {
  const a = ja[key];
  const b = en[key];
  if (a === undefined || b === undefined) continue;
  const pa = placeholders(a).join(",");
  const pb = placeholders(b).join(",");
  if (pa !== pb) errors.push(`${key}: プレースホルダが違います(ja: {${pa}} / en: {${pb}})`);
}

if (errors.length > 0) {
  console.error("i18n:check 失敗");
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

console.log(`i18n:check OK (${Object.keys(ja).length} キー × 2 言語)`);
