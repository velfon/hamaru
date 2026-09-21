/**
 * BGM の楽譜と効果音(docs/10)。音は鳴らせないので、楽譜の性質を検査する。
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
import { sfxNotes, type SfxName, type SfxNote } from "../../src/audio/sfx";
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

const ALL_SFX: SfxName[] = ["place", "clear", "boardClear", "levelClear", "gameOver"];
const last = (notes: readonly SfxNote[]): number => Math.max(...notes.map((n) => n.at + n.dur), 0);

describe("sfxNotes(docs/10 §6)", () => {
  it("同じ入力からは同じ音(乱数を使わない)", () => {
    for (const name of ALL_SFX) {
      expect(sfxNotes(name, { lines: 2, streak: 1, cells: 3 })).toEqual(
        sfxNotes(name, { lines: 2, streak: 1, cells: 3 }),
      );
    }
  });

  it("どの効果音もハ長調から外れない", () => {
    for (const name of ALL_SFX) {
      for (const streak of [0, 3, 99]) {
        for (const note of sfxNotes(name, { lines: 3, streak, cells: 4 })) {
          expect(DIATONIC.has(note.midi % 12)).toBe(true);
        }
      }
    }
  });

  it("拍・長さ・音量が入れ物に収まっている", () => {
    for (const name of ALL_SFX) {
      const notes = sfxNotes(name, { lines: 4, streak: 2, cells: 5 });
      expect(notes.length).toBeGreaterThan(0);
      for (const n of notes) {
        expect(n.at).toBeGreaterThanOrEqual(0);
        expect(n.dur).toBeGreaterThan(0);
        expect(n.gain).toBeGreaterThan(0);
        expect(n.gain).toBeLessThanOrEqual(0.5);
      }
      // 余韻が長すぎると次の手に被る
      expect(last(notes)).toBeLessThanOrEqual(2);
    }
  });

  it("置く音は短く小さい(毎手鳴るので疲れさせない)", () => {
    const notes = sfxNotes("place", { cells: 1 });
    expect(notes).toHaveLength(1);
    expect(last(notes)).toBeLessThanOrEqual(0.1);
    expect(notes[0]?.gain).toBeLessThanOrEqual(0.25);
    expect(notes[0]?.timbre).toBe("click");
    // 大きいピースほど低い
    const small = sfxNotes("place", { cells: 1 })[0]?.midi as number;
    const big = sfxNotes("place", { cells: 9 })[0]?.midi as number;
    expect(big).toBeLessThan(small);
  });

  it("消える音は行数で増え、連鎖で上がる(上限あり)", () => {
    expect(sfxNotes("clear", { lines: 1 })).toHaveLength(1);
    expect(sfxNotes("clear", { lines: 2 })).toHaveLength(2);
    expect(sfxNotes("clear", { lines: 4 })).toHaveLength(3); // 3 音で打ち止め

    const pitch = (streak: number) => sfxNotes("clear", { lines: 1, streak })[0]?.midi as number;
    expect(pitch(1)).toBeGreaterThan(pitch(0));
    expect(pitch(3)).toBeGreaterThan(pitch(1));
    expect(pitch(99)).toBe(pitch(5)); // 上がりすぎない
    // 分散和音は後の音ほど高い
    const three = sfxNotes("clear", { lines: 3, streak: 0 });
    expect(three.map((n) => n.midi)).toEqual([...three.map((n) => n.midi)].sort((a, b) => a - b));
    expect(three.map((n) => n.at)).toEqual([...three.map((n) => n.at)].sort((a, b) => a - b));
  });

  it("欠けた入力でも鳴る(行数 0・負の連鎖・小数)", () => {
    expect(sfxNotes("clear")).toHaveLength(1);
    expect(sfxNotes("clear", { lines: 0, streak: -5 })).toHaveLength(1);
    expect(sfxNotes("place", { cells: 2.7 })).toHaveLength(1);
  });

  it("全消し・レベルクリアは駆け上がって鐘が残る、ゲームオーバーは下がる", () => {
    for (const name of ["boardClear", "levelClear"] as const) {
      const notes = sfxNotes(name);
      expect(notes.some((n) => n.timbre === "bell")).toBe(true);
      const plucks = notes.filter((n) => n.timbre === "pluck").map((n) => n.midi);
      expect(plucks).toEqual([...plucks].sort((a, b) => a - b));
    }
    const over = sfxNotes("gameOver").map((n) => n.midi);
    expect(over).toEqual([...over].sort((a, b) => b - a));
  });
});
