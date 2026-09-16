/**
 * web-vitals → `vital` イベント(docs/04 §3)。
 *
 * 計測するのは LCP / INP / CLS の 3 つだけ(docs/04 §5 の `lcp_p75` / `inp_p75` / `cls_p75`)。
 * `web-vitals` は各指標につき「確定した値」を 1 回だけ返す(既定の `reportAllChanges: false`)ので、
 * 1 セッションあたり最大 3 件しか積まれない。
 */
import { onCLS, onINP, onLCP, type Metric } from "web-vitals";
import { track } from "./client";

export type VitalName = "LCP" | "INP" | "CLS";

/** 送る値を丸める。CLS は 0.01 のような小さい値なので小数 4 桁まで残す。 */
export function roundVital(name: VitalName, value: number): number {
  return name === "CLS" ? Math.round(value * 10_000) / 10_000 : Math.round(value);
}

type Report = (name: VitalName, value: number) => void;

const defaultReport: Report = (name, value) => {
  track({ event: "vital", name, value: roundVital(name, value) });
};

/**
 * 計測を開始する。`report` はテスト用の差し替え口。
 * 呼び出しは 1 回だけ(main.ts の起動時)。
 */
export function initVitals(report: Report = defaultReport): void {
  const handle = (metric: Metric): void => {
    if (metric.name === "LCP" || metric.name === "INP" || metric.name === "CLS") {
      report(metric.name, metric.value);
    }
  };
  onLCP(handle);
  onINP(handle);
  onCLS(handle);
}
