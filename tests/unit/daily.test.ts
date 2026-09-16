import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../../src/config";
import {
  dailyNumber,
  dailySeed,
  endlessSeed,
  msUntilNextUtcDay,
  parseUtcDate,
  utcDateString,
} from "../../src/core/daily";

const EPOCH = DEFAULT_CONFIG.daily.epoch;

describe("daily", () => {
  it("epoch の既定値は 2026-10-01", () => {
    expect(EPOCH).toBe("2026-10-01");
  });

  it("日付 → シード", () => {
    expect(dailySeed("2026-10-01")).toBe("daily:2026-10-01");
    expect(dailySeed("2027-01-31")).toBe("daily:2027-01-31");
  });

  it("エンドレスのシード", () => {
    expect(endlessSeed("abc-123", 1_700_000_000_000)).toBe("endless:abc-123:1700000000000");
  });

  it("通算番号は epoch が #1", () => {
    expect(dailyNumber("2026-10-01", EPOCH)).toBe(1);
    expect(dailyNumber("2026-10-02", EPOCH)).toBe(2);
    expect(dailyNumber("2026-10-31", EPOCH)).toBe(31);
    expect(dailyNumber("2026-11-01", EPOCH)).toBe(32);
    expect(dailyNumber("2027-10-01", EPOCH)).toBe(366);
    expect(dailyNumber("2026-09-30", EPOCH)).toBe(0); // epoch より前
  });

  it("不正な日付は null", () => {
    expect(dailyNumber("2026-13-01", EPOCH)).toBeNull();
    expect(dailyNumber("2026-02-30", EPOCH)).toBeNull();
    expect(dailyNumber("nope", EPOCH)).toBeNull();
    expect(dailyNumber("2026-10-01", "bad")).toBeNull();
    expect(parseUtcDate("2026-1-1")).toBeNull();
    expect(parseUtcDate("2026-00-10")).toBeNull();
    expect(parseUtcDate("2026-10-00")).toBeNull();
    expect(parseUtcDate("2026-10-32")).toBeNull();
  });

  it("うるう日を正しく扱う", () => {
    expect(parseUtcDate("2028-02-29")).not.toBeNull();
    expect(parseUtcDate("2027-02-29")).toBeNull();
  });

  it("UTC 境界: 23:59:59.999 と 00:00:00 で日付が切り替わる", () => {
    const boundary = Date.UTC(2026, 9, 2); // 2026-10-02T00:00:00Z
    expect(utcDateString(boundary - 1)).toBe("2026-10-01");
    expect(utcDateString(boundary)).toBe("2026-10-02");
    expect(utcDateString(boundary + 86_400_000 - 1)).toBe("2026-10-02");
  });

  it("utcDateString / parseUtcDate は往復する", () => {
    for (const date of ["1970-01-01", "2026-10-01", "2026-12-31", "2100-02-28"]) {
      const ms = parseUtcDate(date);
      expect(ms, date).not.toBeNull();
      if (ms === null) continue;
      expect(utcDateString(ms)).toBe(date);
    }
  });

  it("端末時計が epoch より過去でも落ちない", () => {
    expect(utcDateString(0)).toBe("1970-01-01");
    expect(dailyNumber(utcDateString(0), EPOCH)).toBeLessThan(0);
  });

  it("次の UTC 日付境界までの残り時間", () => {
    const midnight = Date.UTC(2026, 9, 1);
    expect(msUntilNextUtcDay(midnight)).toBe(86_400_000);
    expect(msUntilNextUtcDay(midnight + 1)).toBe(86_400_000 - 1);
    expect(msUntilNextUtcDay(midnight + 86_400_000 - 1)).toBe(1);
    expect(msUntilNextUtcDay(-1)).toBe(1); // epoch より前でも正の値
  });
});
