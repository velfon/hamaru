/**
 * 保存データのマイグレーション(docs/01 §10)。
 *
 * 保存形式は `{ schemaVersion: number, data: unknown }` の封筒。
 * 読み込み時に必ずここを通し、
 *   - 現行バージョン → そのまま `data` を返す
 *   - 旧バージョン(v0 = 封筒が無い素の JSON)→ 封筒に包み直す
 *   - それ以外 / 壊れている → `null`(呼び出し側が**そのキーだけ**初期化する)
 */

export const SCHEMA_VERSION = 1;

export interface Envelope {
  readonly schemaVersion: number;
  readonly data: unknown;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * 生の JSON をマイグレートして `data` を取り出す。壊れていれば null。
 *
 * v0(封筒なし)は「保存された値そのもの」だった、という前提で v1 に持ち上げる。
 * v1 以降のマイグレーションはここに `case` を足していく。
 */
export function migrate(raw: unknown): unknown | null {
  if (!isRecord(raw)) return null;

  let version = 0;
  let data: unknown = raw;
  if (typeof raw["schemaVersion"] === "number") {
    version = raw["schemaVersion"];
    data = raw["data"];
  }

  if (!Number.isInteger(version) || version < 0 || version > SCHEMA_VERSION) return null;

  // v0 → v1: 封筒に入れるだけ(値の形は変えない)。
  if (version === 0) {
    const { schemaVersion: _schemaVersion, ...rest } = raw;
    data = Object.keys(rest).length > 0 ? rest : data;
    version = 1;
  }

  return data ?? null;
}

/** 書き込み用の封筒を作る。 */
export function envelope(data: unknown): Envelope {
  return { schemaVersion: SCHEMA_VERSION, data };
}
