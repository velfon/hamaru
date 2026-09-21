/**
 * ランキング API のクライアント(docs/08 §6)。失敗は例外にせず、理由つきの結果で返す。
 * installId は URL に載せない(本文で送る)。
 */
import { t } from "../i18n";

export type Period = "daily" | "week" | "month" | "all";
export const PERIODS: readonly Period[] = ["daily", "week", "month", "all"];

export type NameJson = { nickname: string } | { auto: readonly [number, number, number] };

export interface RankJson {
  rank: number | null;
  /** デイリーはその日のベスト、週・月・全期間は合計。 */
  score: number | null;
  count: number;
  /** 週・月・全期間のみ: 記録のある日数。 */
  days?: number;
  /** デイリーのみ: その日の挑戦回数。 */
  attempts?: number;
}

export interface SubmitJson {
  accepted: boolean;
  preview?: boolean;
  /** 今回の得点がその日のベストを更新したか。 */
  improved: boolean;
  /** 今回の得点。 */
  score: number | null;
  /** その日のベスト(更新しなければ以前の記録)。 */
  best: number;
  /** その日の挑戦回数(今回を含む)。 */
  attempts: number;
  lines: number;
  ranks: Record<Period, RankJson> | null;
}

export interface TopJson {
  period: Period;
  key: string;
  count: number;
  top: Array<{ rank: number; name: NameJson; score: number; days?: number; attempts?: number }>;
}

export interface MeJson extends RankJson {
  period: Period;
  key: string;
  name: NameJson;
}

export type Failure =
  "network" | "rejected" | "server" | "invalid" | "banned" | "cooldown" | "too_many";
export type Result<T> = { ok: true; data: T } | { ok: false; reason: Failure };

async function call<T>(path: string, init?: RequestInit): Promise<Result<T>> {
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
    });
  } catch {
    return { ok: false, reason: "network" };
  }
  if (res.ok) {
    if (res.status === 204) return { ok: true, data: undefined as T };
    try {
      return { ok: true, data: (await res.json()) as T };
    } catch {
      return { ok: false, reason: "server" };
    }
  }
  if (res.status === 429) {
    // 1 日の挑戦回数の上限(docs/08 §2)とニックネームの連打を区別する。
    return { ok: false, reason: path === "/api/daily/submit" ? "too_many" : "cooldown" };
  }
  if (res.status === 400 || res.status === 422) {
    let error = "";
    try {
      error = String(((await res.json()) as { error?: unknown }).error ?? "");
    } catch {
      /* 本文なし */
    }
    if (error === "banned") return { ok: false, reason: "banned" };
    if (error === "invalid" && path === "/api/profile") return { ok: false, reason: "invalid" };
    return { ok: false, reason: "rejected" };
  }
  return { ok: false, reason: "server" };
}

const post = (body: unknown): RequestInit => ({ method: "POST", body: JSON.stringify(body) });

export function submitDaily(
  installId: string,
  date: string,
  moves: ReadonlyArray<readonly [number, number, number]>,
  version: string,
): Promise<Result<SubmitJson>> {
  return call<SubmitJson>("/api/daily/submit", post({ installId, date, moves, version }));
}

export function fetchTop(period: Period): Promise<Result<TopJson>> {
  return call<TopJson>(`/api/leaderboard?period=${period}`);
}

export function fetchMe(installId: string, period: Period): Promise<Result<MeJson>> {
  return call<MeJson>("/api/leaderboard/me", post({ installId, period }));
}

export function setNickname(
  installId: string,
  nickname: string | null,
): Promise<Result<{ name: NameJson }>> {
  return call<{ name: NameJson }>("/api/profile", post({ installId, nickname }));
}

export function deleteProfile(installId: string): Promise<Result<undefined>> {
  return call<undefined>("/api/profile/delete", post({ installId }));
}

/** 名前の表示(自動の匿名名は言語に合わせて組み立てる。docs/08 §5.1)。 */
export function formatName(name: NameJson): string {
  if ("nickname" in name) return name.nickname;
  const [adj, noun, num] = name.auto;
  return t("name.auto", {
    adj: t(`name.adj.${adj}`),
    noun: t(`name.noun.${noun}`),
    num: String(num).padStart(4, "0"),
  });
}
