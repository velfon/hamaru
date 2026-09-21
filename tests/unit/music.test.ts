/**
 * BGM の楽譜(docs/10)。音は鳴らせないので、楽譜の性質を検査する。
 */
import { describe, expect, it } from "vitest";
import {
  BARS_PER_LOOP,
  BEATS_PER_BAR,
  barNotes,
  barSeconds,
  barsToSchedule,
  midiToFreq,
  type Note,
} from "../../src/audio/score";
import { DEFAULT_CONFIG } from "../../src/config";

const PENTATONIC = new Set([0, 2, 4, 7, 9]);
const DIATONIC = new Set([0, 2, 4, 5, 7, 9, 11]);
const leadOf = (notes: readonly Note[]): Note[] => notes.filter((n) => n.voice === "lead");

describe("barNotes", () => {
  it("同じ小節は何度呼んでも同じ(順番を変えても同じ)", () => {
    const first = JSON.stringify(barNotes(11));
    expect(JSON.stringify(barNotes(11))).toBe(first);
    // 1 周ぶんをまとめて作って覚えているので、別の周を挟んでも変わらないこと
    barNotes(30);
    barNotes(3);
    expect(JSON.stringify(barNotes(11))).toBe(first);
  });

  it("負や小数の小節番号は 0 以上の整数として扱う", () => {
    expect(JSON.stringify(barNotes(-5))).toBe(JSON.stringify(barNotes(0)));
    expect(JSON.stringify(barNotes(2.8))).toBe(JSON.stringify(barNotes(2)));
  });

  it("どの音もハ長調から外れない(旋律はペンタトニック)", () => {
    for (let bar = 0; bar < BARS_PER_LOOP * 6; bar++) {
      for (const note of barNotes(bar)) {
        if (note.voice === "kick" || note.voice === "shaker") {
          expect(note.midi).toBe(0);
          continue;
        }
        expect(DIATONIC.has(note.midi % 12)).toBe(true);
        if (note.voice === "lead") expect(PENTATONIC.has(note.midi % 12)).toBe(true);
      }
    }
  });

  it("拍・長さ・音量が入れ物に収まっている", () => {
    for (let bar = 0; bar < BARS_PER_LOOP * 4; bar++) {
      const notes = barNotes(bar);
      expect(notes.length).toBeGreaterThan(3);
      for (const n of notes) {
        expect(n.beat).toBeGreaterThanOrEqual(0);
        expect(n.beat).toBeLessThan(BEATS_PER_BAR);
        expect(n.dur).toBeGreaterThan(0);
        expect(n.gain).toBeGreaterThan(0);
        expect(n.gain).toBeLessThanOrEqual(1);
      }
      // 拍の順に並んでいる(予約がさかのぼらない)
      expect([...notes].sort((a, b) => a.beat - b.beat)).toEqual(notes);
    }
  });

  // 実際の音量は master の volume(既定 0.32)を掛けたもので、`npm run audio:preview` の
  // peak が本当の頭打ちの確認。ここは音量の指定を一桁間違えたときに気づくための網。
  it("同じ拍に重なる音量の合計が跳ね上がっていない", () => {
    for (let bar = 0; bar < BARS_PER_LOOP * 4; bar++) {
      const byBeat = new Map<number, number>();
      for (const n of barNotes(bar)) byBeat.set(n.beat, (byBeat.get(n.beat) ?? 0) + n.gain);
      for (const sum of byBeat.values()) expect(sum).toBeLessThan(2);
    }
  });

  it("旋律は続けて歩く(小節をまたいで 1 オクターブ以上跳ばない)", () => {
    let previous: number | null = null;
    for (let bar = 0; bar < BARS_PER_LOOP * 4; bar++) {
      for (const note of leadOf(barNotes(bar))) {
        if (previous !== null) expect(Math.abs(note.midi - previous)).toBeLessThanOrEqual(12);
        previous = note.midi;
      }
    }
  });

  it("伴奏は毎小節あり、展開で表情が変わる", () => {
    for (let bar = 0; bar < BARS_PER_LOOP * 4; bar++) {
      const notes = barNotes(bar);
      expect(notes.filter((n) => n.voice === "bass").length).toBeGreaterThan(0);
      expect(notes.filter((n) => n.voice === "kick").length).toBe(2);
    }
    const shakers = (bar: number) => barNotes(bar).filter((n) => n.voice === "shaker").length;
    expect(shakers(0)).toBe(0); // 1 周目は静かに始まる
    expect(shakers(BARS_PER_LOOP)).toBe(4);
    const stabBeats = (bar: number) =>
      new Set(
        barNotes(bar)
          .filter((n) => n.voice === "chord")
          .map((n) => n.beat),
      ).size;
    expect(stabBeats(0)).toBe(2); // 裏拍だけ
    expect(stabBeats(BARS_PER_LOOP * 2)).toBe(4); // 盛り上がりの周は 4 拍すべて
  });
});

describe("時間の計算", () => {
  it("MIDI → 周波数", () => {
    expect(midiToFreq(69)).toBeCloseTo(440, 6);
    expect(midiToFreq(72)).toBeCloseTo(523.2511, 3);
  });

  it("1 小節の長さ", () => {
    expect(barSeconds(120)).toBeCloseTo(2, 6);
    expect(barSeconds(DEFAULT_CONFIG.audio.bpm)).toBeCloseTo(2.3077, 3);
  });

  it("先読みの対象になるのは「今から lookahead 先まで」に始まる小節だけ", () => {
    const barSec = 2;
    expect(barsToSchedule(0, barSec, 0, 0.3)).toEqual([0]);
    expect(barsToSchedule(1.8, barSec, 1, 0.3)).toEqual([1]);
    expect(barsToSchedule(1.5, barSec, 1, 0.3)).toEqual([]); // まだ先
    expect(barsToSchedule(10, barSec, 6, 0.3)).toEqual([]); // 6 小節目は 12 秒から
    expect(barsToSchedule(10, barSec, 1, 0.3)).toEqual([1, 2, 3, 4, 5]); // 出遅れた分は詰める
  });

  it("時計が飛んでも 1 回に 8 小節までしか予約しない", () => {
    expect(barsToSchedule(600, 2, 0, 0.3)).toHaveLength(8);
  });
});

describe("config", () => {
  it("既定値は耳に優しい範囲にある(docs/02 §4.1)", () => {
    expect(DEFAULT_CONFIG.audio.bpm).toBeGreaterThanOrEqual(60);
    expect(DEFAULT_CONFIG.audio.bpm).toBeLessThanOrEqual(160);
    expect(DEFAULT_CONFIG.audio.volume).toBeGreaterThan(0);
    expect(DEFAULT_CONFIG.audio.volume).toBeLessThanOrEqual(0.6);
  });
});
