/**
 * 効果音(docs/10 §6)。BGM と同じハ長調・同じ音源なしの方針で合成する。
 *
 * 置く音は**短く小さく**(毎手鳴るので疲れさせない)、消える音は BGM と同じ
 * ペンタトニックの分散和音。連鎖(streak)が続くほど音が上がっていく。
 *
 * `sfxNotes()` は純粋。音の設計をここに閉じ込めておくと、調から外れていないか・
 * 長すぎないかを単体テストで確かめられるし、`npm run audio:preview -- --sfx` で
 * そのまま WAV に書き出せる。
 */
import { acquireAudio, releaseAudio, resumeAudio } from "./context";
import { LADDER, midiToFreq } from "./score";

export type SfxName = "place" | "clear" | "boardClear" | "levelClear" | "gameOver" | "confirm";

/** 音色。player.ts の声部と違い、効果音は短い単発。 */
export type Timbre = "click" | "pluck" | "bell" | "warm";

export interface SfxNote {
  /** 効果音の先頭からの秒数。 */
  readonly at: number;
  readonly midi: number;
  /** 減衰の長さ(秒)。 */
  readonly dur: number;
  /** 0〜1。 */
  readonly gain: number;
  readonly timbre: Timbre;
}

export interface SfxContext {
  /** 消えた行 + 列の数。 */
  lines?: number;
  /** 連鎖の回数(0 から)。上がるほど音が高くなる。 */
  streak?: number;
  /** 置いたかけらのセル数(1〜9)。置く音の高さに少しだけ効く。 */
  cells?: number;
}

/** 連鎖で上がる段数の上限(上がりすぎると耳につく)。 */
const STREAK_MAX_STEP = 5;

const at = (midi: number, time: number, dur: number, gain: number, timbre: Timbre): SfxNote => ({
  at: time,
  midi,
  dur,
  gain,
  timbre,
});

function ladder(step: number): number {
  return LADDER[Math.min(LADDER.length - 1, Math.max(0, step))] as number;
}

/** 効果音 1 つぶんの音符。同じ入力からは必ず同じ結果(乱数を使わない)。 */
export function sfxNotes(name: SfxName, ctx: SfxContext = {}): SfxNote[] {
  const streak = Math.min(STREAK_MAX_STEP, Math.max(0, Math.floor(ctx.streak ?? 0)));
  const lines = Math.min(4, Math.max(0, Math.floor(ctx.lines ?? 0)));

  switch (name) {
    case "place": {
      // 陶器を置く「コッ」。大きいかけらほど少し低く、どれも 80 ms で消える。
      const cells = Math.min(9, Math.max(1, Math.floor(ctx.cells ?? 1)));
      const step = Math.max(0, 3 - Math.floor((cells - 1) / 2));
      return [at(ladder(step), 0, 0.08, 0.22, "click")];
    }
    case "clear": {
      // 消えた行数だけ音を重ね、連鎖のぶん高いところから始める。
      const count = Math.min(3, Math.max(1, lines));
      return Array.from({ length: count }, (_, i) =>
        at(ladder(streak + i), i * 0.06, 0.5, 0.3 - i * 0.03, "pluck"),
      );
    }
    case "boardClear": {
      // 全消し: 駆け上がり + 余韻の鐘。
      const run = [0, 1, 2, 3, 4, 5].map((i) => at(ladder(i), i * 0.05, 0.6, 0.26, "pluck"));
      return [...run, at(ladder(7), 0.3, 1.6, 0.16, "bell")];
    }
    case "levelClear": {
      const run = [0, 2, 3, 5].map((s, i) => at(ladder(s), i * 0.07, 0.7, 0.28, "pluck"));
      return [...run, at(ladder(5), 0.28, 1.4, 0.18, "bell")];
    }
    case "confirm":
      // 音を ON にしたときの合図。BGM が鳴らない画面(ホーム)で、音量の当たりを付けてもらう。
      return [at(ladder(0), 0, 0.45, 0.26, "pluck"), at(ladder(3), 0.08, 0.5, 0.24, "pluck")];
    case "gameOver":
      // 下がる 3 音。責めない音にする(ラ → ファ → レ)。
      return [
        at(69, 0, 0.7, 0.28, "warm"),
        at(65, 0.16, 0.7, 0.26, "warm"),
        at(62, 0.34, 1.2, 0.24, "warm"),
      ];
  }
}

export interface Sfx {
  play(name: SfxName, ctx?: SfxContext): void;
  /**
   * 最初の操作の**その中で**呼ぶと、AudioContext をそこで作って動かす。
   * Safari は「操作の中で作って resume したもの」しか鳴らさないので、
   * これを呼んでおかないと最初の 1 音が捨てられる。
   */
  prime(): void;
  dispose(): void;
}

export interface SfxOptions {
  /** 効果音の音量 0〜1(docs/02 §4.1 `audio.sfxVolume`)。 */
  volume: number;
}

/** 環境が Web Audio に対応していなければ null。 */
export function createSfx(opts: SfxOptions): Sfx | null {
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let noise: AudioBuffer | null = null;
  let disposed = false;

  function build(): boolean {
    if (ctx !== null) return true;
    const c = acquireAudio();
    if (c === null) return false;
    ctx = c;
    master = c.createGain();
    master.gain.value = opts.volume;
    master.connect(c.destination);

    const frames = Math.floor(c.sampleRate * 0.1);
    noise = c.createBuffer(1, frames, c.sampleRate);
    const data = noise.getChannelData(0);
    let seed = 7;
    for (let i = 0; i < frames; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      data[i] = seed / 0x3fffffff - 1;
    }
    return true;
  }

  function envelope(when: number, peak: number, attack: number, dur: number): GainNode {
    const c = ctx as AudioContext;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.linearRampToValueAtTime(peak, when + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, when + Math.max(attack + 0.02, dur));
    g.connect(master as GainNode);
    return g;
  }

  function tone(type: OscillatorType, freq: number, when: number, until: number): OscillatorNode {
    const c = ctx as AudioContext;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, when);
    o.start(when);
    o.stop(until);
    return o;
  }

  function playNote(note: SfxNote, when: number): void {
    const c = ctx as AudioContext;
    const f = midiToFreq(note.midi);
    const end = when + note.dur + 0.1;

    if (note.timbre === "click") {
      // 硬い当たり(雑音の短い粒)+ 芯になる正弦波。
      const src = c.createBufferSource();
      src.buffer = noise;
      const bp = c.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = f * 2.5;
      bp.Q.value = 1.2;
      src.connect(bp);
      bp.connect(envelope(when, note.gain * 0.5, 0.001, 0.03));
      src.start(when);
      src.stop(when + 0.06);
      tone("triangle", f, when, end).connect(envelope(when, note.gain, 0.003, note.dur));
      return;
    }

    if (note.timbre === "pluck") {
      // BGM の旋律と同じ音色(基音 + 3 倍音)。
      tone("sine", f, when, end).connect(envelope(when, note.gain, 0.005, note.dur));
      tone("sine", f * 3, when, end).connect(
        envelope(when, note.gain * 0.22, 0.004, note.dur * 0.35),
      );
      return;
    }

    if (note.timbre === "bell") {
      tone("sine", f, when, end).connect(envelope(when, note.gain, 0.01, note.dur));
      tone("sine", f * 2.76, when, end).connect(
        envelope(when, note.gain * 0.18, 0.01, note.dur * 0.5),
      );
      return;
    }

    // warm: 丸い三角波
    const lp = c.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 1800;
    tone("triangle", f, when, end).connect(lp);
    lp.connect(envelope(when, note.gain, 0.02, note.dur));
  }

  return {
    prime() {
      if (disposed || !build()) return;
      resumeAudio();
    },
    play(name, context) {
      if (disposed || !build()) return;
      resumeAudio();
      const c = ctx as AudioContext;
      if (c.state === "closed") return;
      // まだ動き出していなくても予約する。resume() は非同期なので、ここで捨てると
      // 「音を出して最初の 1 手」が無音になる(遅い端末ほど起きやすい)。
      const now = c.currentTime + 0.005;
      for (const note of sfxNotes(name, context)) playNote(note, now + note.at);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      const had = ctx !== null;
      ctx = null;
      master = null;
      noise = null;
      if (had) releaseAudio();
    },
  };
}
