/**
 * BGM の楽譜(docs/10 §2)。**純粋**。音は鳴らさず、音符の列だけを作る。
 *
 * 音源ファイルは持たない(サイズ予算 docs/02 §9)。代わりに小節ごとに音符を組み立て、
 * `player.ts` が Web Audio で鳴らす。ここを純粋にしておくと、和音がぶつかっていないか・
 * 同じ小節がいつも同じかを単体テストで確かめられる。
 *
 * 音楽の作り: ハ長調。旋律はヨナ抜き(ペンタトニック)なので、どの音が来ても和音とぶつからない。
 * 和音は I–vi–IV–V–I–vi–ii–V の 8 小節。裏拍の和音刻みと軽いシェイカーで跳ねる感じを出す。
 */

/** 1 小節の拍数(4/4)。 */
export const BEATS_PER_BAR = 4;
/** 和音進行 1 周の小節数。 */
export const BARS_PER_LOOP = 8;
/** 展開(section)の数。4 周で一巡し、密度と伴奏が変わる。 */
export const SECTIONS = 4;

export type Voice = "lead" | "chord" | "bass" | "kick" | "shaker";

export interface Note {
  /** 小節の頭からの拍(0 以上 BEATS_PER_BAR 未満)。 */
  readonly beat: number;
  readonly voice: Voice;
  /** MIDI ノート番号。打楽器(kick / shaker)は 0。 */
  readonly midi: number;
  /** 長さ(拍)。0 より大きい。 */
  readonly dur: number;
  /** 音量 0〜1。 */
  readonly gain: number;
}

/** 和音進行。root は低音、triad は和音の構成音(C を 0 とした半音)。 */
const PROGRESSION = [
  { root: 0, triad: [0, 4, 7] }, // C
  { root: 9, triad: [9, 12, 16] }, // Am
  { root: 5, triad: [5, 9, 12] }, // F
  { root: 7, triad: [7, 11, 14] }, // G
  { root: 0, triad: [0, 4, 7] }, // C
  { root: 9, triad: [9, 12, 16] }, // Am
  { root: 2, triad: [2, 5, 9] }, // Dm
  { root: 7, triad: [7, 11, 14] }, // G
] as const;

/**
 * 旋律の音域。ハ長調のペンタトニック(ド レ ミ ソ ラ)を MIDI 72 = C5 から 1.5 オクターブ。
 * 半音がないのでどの音が来ても和音とぶつからない。狭くして跳ね回らせない。
 */
export const LADDER: readonly number[] = [72, 74, 76, 79, 81, 84, 86, 88];

/** 8 分音符 8 個ぶんのリズム型。1 = 音を出す。 */
const RHYTHMS: ReadonlyArray<readonly number[]> = [
  [1, 0, 1, 0, 1, 0, 0, 0],
  [1, 0, 1, 1, 0, 1, 0, 0],
  [1, 1, 0, 1, 0, 1, 1, 0],
  [1, 0, 0, 1, 0, 1, 0, 1],
];

/** 旋律の動き(ペンタトニックの段数)。上向きの節と下向きの節で使い分け、山なりの旋律にする。 */
const STEPS_UP = [-1, 1, 1, 1, 2] as const;
const STEPS_DOWN = [-2, -1, -1, -1, 1] as const;

interface SectionParams {
  /** 旋律の密度(リズム型の音を残す確率)。 */
  readonly density: number;
  readonly shaker: boolean;
  /** 和音刻みを 4 拍すべてに入れる(盛り上がり)。 */
  readonly busyChord: boolean;
  readonly leadGain: number;
}

const SECTION_PARAMS: readonly SectionParams[] = [
  { density: 0.7, shaker: false, busyChord: false, leadGain: 0.26 },
  { density: 0.9, shaker: true, busyChord: false, leadGain: 0.3 },
  { density: 1.0, shaker: true, busyChord: true, leadGain: 0.32 },
  { density: 0.8, shaker: true, busyChord: false, leadGain: 0.28 },
];

/** 小節番号だけで決まる乱数(同じ小節はいつも同じ)。mulberry32。 */
function rngFor(bar: number): () => number {
  let a = (bar * 0x9e3779b9 + 0x6d2b79f5) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rng: () => number, items: readonly T[]): T {
  return items[Math.floor(rng() * items.length)] as T;
}

/** 段数 idx から、和音の構成音にいちばん近い段へ寄せる。 */
function snapToChord(idx: number, triad: readonly number[]): number {
  const wanted = new Set(triad.map((n) => ((n % 12) + 12) % 12));
  for (let d = 0; d < LADDER.length; d++) {
    for (const sign of [1, -1]) {
      const i = idx + d * sign;
      if (i < 0 || i >= LADDER.length) continue;
      if (wanted.has((LADDER[i] as number) % 12)) return i;
    }
  }
  return idx;
}

/**
 * 8 小節ぶんの旋律をまとめて作る。
 *
 * 小節ごとに独立に作ると、小節の頭で音域が飛んで「でたらめ」に聞こえる。
 * 1 周ぶんを続けて歩かせ、前半は上り・後半は下りに寄せて山なりの節にする。
 */
function loopMelody(loop: number): Note[][] {
  const rng = rngFor(loop * 101 + 7);
  const section = SECTION_PARAMS[loop % SECTIONS] as (typeof SECTION_PARAMS)[number];
  const bars: Note[][] = [];
  let idx = 1 + Math.floor(rng() * 3);
  let repeats = 0;

  for (let b = 0; b < BARS_PER_LOOP; b++) {
    const chord = PROGRESSION[b] as (typeof PROGRESSION)[number];
    const rhythm = pick(rng, RHYTHMS);
    const notes: Note[] = [];
    for (let slot = 0; slot < rhythm.length; slot++) {
      if (rhythm[slot] !== 1) continue;
      const onBeat = slot % 2 === 0;
      const before = idx;
      const step = pick(rng, b < BARS_PER_LOOP / 2 ? STEPS_UP : STEPS_DOWN);
      idx = Math.min(LADDER.length - 1, Math.max(0, idx + step));
      // 強拍は和音の音に寄せる(どこで切り取っても濁らない)
      if (onBeat) idx = snapToChord(idx, chord.triad);
      // 同じ音が続きすぎたら必ず動かす
      if (idx === before && ++repeats >= 2) {
        idx = Math.min(LADDER.length - 1, Math.max(0, idx + (rng() < 0.5 ? -1 : 1)));
        repeats = 0;
      } else if (idx !== before) {
        repeats = 0;
      }
      // 密度が低い節では頭以外を間引く
      if (slot !== 0 && rng() > section.density) continue;
      const closing = b === BARS_PER_LOOP - 1 && slot >= 6;
      notes.push({
        beat: slot / 2,
        voice: "lead",
        midi: LADDER[idx] as number,
        dur: closing ? 1 : 0.45,
        gain: section.leadGain * (onBeat ? 1 : 0.8),
      });
    }
    bars.push(notes);
  }
  return bars;
}

/** 直前に作った 1 周ぶんを覚えておく(毎小節作り直さない)。結果は loop だけで決まる。 */
let cachedLoop = -1;
let cachedMelody: Note[][] = [];

function melodyFor(loop: number, bar: number): Note[] {
  if (loop !== cachedLoop) {
    cachedMelody = loopMelody(loop);
    cachedLoop = loop;
  }
  return cachedMelody[bar] ?? [];
}

/**
 * 通し小節番号 `bar`(0 から)の音符。
 * 同じ `bar` からは必ず同じ結果が返る(テストと、途中から鳴らし始めるため)。
 */
export function barNotes(bar: number): Note[] {
  const n = Math.max(0, Math.floor(bar));
  const loop = Math.floor(n / BARS_PER_LOOP);
  const inLoop = n % BARS_PER_LOOP;
  const chord = PROGRESSION[inLoop] as (typeof PROGRESSION)[number];
  const section = SECTION_PARAMS[loop % SECTIONS] as (typeof SECTION_PARAMS)[number];
  const notes: Note[] = [];

  // 低音: 頭に主音、裏で 5 度と 1 オクターブ上。跳ねるが出しゃばらない。
  const bass = 36 + chord.root;
  notes.push({ beat: 0, voice: "bass", midi: bass, dur: 1.2, gain: 0.5 });
  notes.push({ beat: 1.5, voice: "bass", midi: bass + 7, dur: 0.5, gain: 0.32 });
  notes.push({ beat: 2.5, voice: "bass", midi: bass + 12, dur: 0.5, gain: 0.3 });

  // 和音刻み: 裏拍(2・4 拍目)。盛り上がりの節では 4 拍すべて。
  // 基準は C3(48)。ここを C 以外にすると進行ごと移調してしまうので 12 の倍数に保つ。
  const stabBeats = section.busyChord ? [0, 1, 2, 3] : [1, 3];
  for (const beat of stabBeats) {
    for (const t of chord.triad) {
      notes.push({
        beat,
        voice: "chord",
        midi: 48 + t,
        dur: 0.35,
        gain: beat % 2 === 1 ? 0.15 : 0.1,
      });
    }
  }

  // 打楽器
  notes.push({ beat: 0, voice: "kick", midi: 0, dur: 0.2, gain: 0.5 });
  notes.push({ beat: 2, voice: "kick", midi: 0, dur: 0.2, gain: 0.42 });
  if (section.shaker) {
    for (const beat of [0.5, 1.5, 2.5, 3.5]) {
      notes.push({ beat, voice: "shaker", midi: 0, dur: 0.1, gain: beat === 2.5 ? 0.07 : 0.05 });
    }
  }

  notes.push(...melodyFor(loop, inLoop));
  return notes.sort((a, b) => a.beat - b.beat);
}

/** MIDI ノート番号 → 周波数(Hz)。 */
export function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/** 1 小節の長さ(秒)。 */
export function barSeconds(bpm: number): number {
  return (60 / bpm) * BEATS_PER_BAR;
}

/**
 * これから予約すべき小節番号(先読み。`player.ts` の時計から呼ぶ)。
 * 1 回に 8 小節までしか返さない(タブ復帰などで時計が飛んでも暴走しない)。
 */
export function barsToSchedule(
  elapsedSec: number,
  barSec: number,
  nextBar: number,
  lookaheadSec: number,
): number[] {
  const bars: number[] = [];
  for (let bar = nextBar; bar * barSec <= elapsedSec + lookaheadSec; bar++) {
    bars.push(bar);
    if (bars.length >= 8) break;
  }
  return bars;
}
