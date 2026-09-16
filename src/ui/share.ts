/**
 * デイリー結果カードの共有(docs/01 §9.4)。
 *
 *   HAMARU Daily #<n> (<YYYY-MM-DD>)
 *   4,520 pts · 18 lines · streak x2.0
 *   ▓▓▓▓▓▓▓░░░
 *   https://<host>/#/daily
 *
 * `navigator.share` が使えれば共有シート、なければクリップボードへコピーする。
 * 数値の区切りは共有テキストでも 3 桁区切り(表示と一致させる)。
 */

export const GAUGE_STEPS = 10;

export interface ShareInput {
  dailyNo: number;
  date: string;
  score: number;
  lines: number;
  /** ストリーク倍率(1.0 〜 max)。 */
  multiplier: number;
  gaugeMax: number;
  url: string;
}

function gauge(score: number, max: number): string {
  const ratio = max > 0 ? Math.min(score / max, 1) : 0;
  // 切り捨て(docs/01 §9.4 の例: 4,520 / 6,000 = 0.753 → ▓ 7 つ)。
  const filled = Math.floor(ratio * GAUGE_STEPS);
  return "▓".repeat(filled) + "░".repeat(GAUGE_STEPS - filled);
}

export function buildShareText(input: ShareInput): string {
  const score = new Intl.NumberFormat("en-US").format(input.score);
  const lines = [
    `HAMARU Daily #${input.dailyNo} (${input.date})`,
    `${score} pts · ${input.lines} lines · streak x${input.multiplier.toFixed(1)}`,
    gauge(input.score, input.gaugeMax),
    input.url,
  ];
  return lines.join("\n");
}

export type ShareMethod = "share" | "copy" | "none";

/**
 * 共有する。戻り値は実際に使った手段。
 * ユーザがシートを閉じた(reject)場合は `none` を返し、何も通知しない。
 */
export async function shareText(text: string): Promise<ShareMethod> {
  if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
    try {
      await navigator.share({ text });
      return "share";
    } catch {
      // キャンセル、または共有不可。クリップボードへ退避する。
    }
  }
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard !== undefined) {
      await navigator.clipboard.writeText(text);
      return "copy";
    }
  } catch {
    /* 権限が無い場合は下のフォールバックへ */
  }
  return copyFallback(text) ? "copy" : "none";
}

/** クリップボード API が使えない環境(古い Safari / 非セキュアコンテキスト)向け。 */
function copyFallback(text: string): boolean {
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  } catch {
    return false;
  }
}
