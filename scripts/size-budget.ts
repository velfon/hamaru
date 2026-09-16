/**
 * サイズ予算(docs/02 §9)。`npm run build` のあとに実行する。
 *
 *   初回 JS(gzip)   ≤ 60 KB
 *   CSS(gzip)       ≤ 15 KB
 *   フォント合計      ≤ 120 KB(woff2 は既に圧縮済みなので生サイズで見る)
 *
 * 超過したら exit 1。CI の G6 はこのスクリプトを実行する。
 */
import { gzipSync } from "node:zlib";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = resolve(ROOT, "dist");
const KB = 1024;

const BUDGET = {
  js: 60 * KB,
  css: 15 * KB,
  fonts: 120 * KB,
} as const;

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

let files: string[];
try {
  files = walk(DIST);
} catch {
  console.error("dist/ がありません。先に `npm run build` を実行してください。");
  process.exit(1);
}

interface Row {
  file: string;
  bytes: number;
}

const js: Row[] = [];
const css: Row[] = [];
const fonts: Row[] = [];

for (const file of files) {
  const ext = extname(file);
  const name = relative(DIST, file);
  if (name.endsWith(".map")) continue;
  const raw = readFileSync(file);
  if (ext === ".js") {
    // Service Worker / Workbox は「初回 JS」に含めない(起動をブロックしない)。
    if (name === "sw.js" || name.startsWith("workbox-") || name === "registerSW.js") continue;
    js.push({ file: name, bytes: gzipSync(raw).length });
  } else if (ext === ".css") {
    css.push({ file: name, bytes: gzipSync(raw).length });
  } else if (ext === ".woff2" || ext === ".woff" || ext === ".ttf") {
    fonts.push({ file: name, bytes: raw.length });
  }
}

function total(rows: Row[]): number {
  return rows.reduce((sum, r) => sum + r.bytes, 0);
}

function report(label: string, rows: Row[], budget: number, unit: string): boolean {
  const sum = total(rows);
  const ok = sum <= budget;
  console.log(
    `${ok ? "OK " : "NG "} ${label.padEnd(14)} ${(sum / KB).toFixed(2).padStart(7)} KB ${unit} / 予算 ${(budget / KB).toFixed(0)} KB`,
  );
  for (const row of rows.sort((a, b) => b.bytes - a.bytes)) {
    console.log(`      ${row.file.padEnd(34)} ${(row.bytes / KB).toFixed(2).padStart(7)} KB`);
  }
  return ok;
}

const results = [
  report("JS", js, BUDGET.js, "gzip"),
  report("CSS", css, BUDGET.css, "gzip"),
  report("フォント", fonts, BUDGET.fonts, "生  "),
];

if (results.includes(false)) {
  console.error("サイズ予算を超過しました(docs/02 §9)。");
  process.exit(1);
}
console.log("サイズ予算 OK");
