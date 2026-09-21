/**
 * BGM の再生(docs/10 §3)。Web Audio API だけを使い、音源ファイルは持たない。
 *
 * `score.ts` が作る音符を、25 ms ごとに 0.3 秒先まで予約する(setInterval では鳴らさない。
 * 鳴らすのは AudioContext の時計)。AudioContext は効果音と共有する(`context.ts`)。
 * ブラウザは操作前に音を出せないので、止まっている間は時計を進めず、無音の小節を飛ばさない。
 */
import { acquireAudio, releaseAudio, resumeAudio } from "./context";
import { barNotes, barSeconds, barsToSchedule, midiToFreq, type Note } from "./score";

export interface MusicPlayer {
  /** 鳴らし始める(すでに鳴っていれば何もしない)。 */
  start(): void;
  /** 止める(フェードアウト)。`start()` で続きから再開する。 */
  stop(): void;
  dispose(): void;
  readonly playing: boolean;
}

export interface MusicOptions {
  /** テンポ(docs/02 §4.1 `audio.bpm`)。 */
  bpm: number;
  /** 全体の音量 0〜1(docs/02 §4.1 `audio.volume`)。 */
  volume: number;
}

const LOOKAHEAD_SEC = 0.3;
const TICK_MS = 25;
const FADE_IN_SEC = 0.8;
const FADE_OUT_SEC = 0.35;

/** 環境が Web Audio に対応していなければ null(呼び出し側は無視してよい)。 */
export function createMusicPlayer(opts: MusicOptions): MusicPlayer | null {
  const beatSec = 60 / opts.bpm;
  const barSec = barSeconds(opts.bpm);

  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let leadBus: GainNode | null = null;
  let noise: AudioBuffer | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let origin = 0;
  let bar = 0;
  let playing = false;
  let disposed = false;

  function build(): boolean {
    if (ctx !== null) return true;
    const c = acquireAudio();
    if (c === null) return false;
    ctx = c;

    // 出口: 音量 → 少し丸める低域通過 → スピーカー。耳に刺さらないようにする。
    const out = c.createBiquadFilter();
    out.type = "lowpass";
    out.frequency.value = 6000;
    out.Q.value = 0.7;
    out.connect(c.destination);

    master = c.createGain();
    master.gain.value = 0;
    master.connect(out);

    // 旋律だけ付点 8 分のディレイに送る(きらめき)。
    const delay = c.createDelay(1);
    delay.delayTime.value = beatSec * 0.75;
    const feedback = c.createGain();
    feedback.gain.value = 0.25;
    const send = c.createGain();
    send.gain.value = 0.16;
    leadBus = c.createGain();
    leadBus.gain.value = 1;
    leadBus.connect(master);
    leadBus.connect(delay);
    delay.connect(feedback);
    feedback.connect(delay);
    delay.connect(send);
    send.connect(master);

    // シェイカー用の白色雑音(0.2 秒を使い回す)。
    const frames = Math.floor(c.sampleRate * 0.2);
    noise = c.createBuffer(1, frames, c.sampleRate);
    const data = noise.getChannelData(0);
    let seed = 1;
    for (let i = 0; i < frames; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      data[i] = (seed / 0x3fffffff - 1) * 0.6;
    }
    return true;
  }

  function envelope(when: number, peak: number, attack: number, dur: number): GainNode {
    const c = ctx as AudioContext;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.linearRampToValueAtTime(peak, when + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, when + Math.max(attack + 0.02, dur));
    return g;
  }

  function osc(type: OscillatorType, freq: number, when: number, until: number): OscillatorNode {
    const c = ctx as AudioContext;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, when);
    o.start(when);
    o.stop(until);
    return o;
  }

  function playNote(note: Note, when: number): void {
    const c = ctx as AudioContext;
    const dur = note.dur * beatSec;
    const end = when + dur + 0.1;

    if (note.voice === "lead") {
      // 鉄琴のような撥弦: 基音 + 3 倍音の短い減衰。
      const f = midiToFreq(note.midi);
      const body = envelope(when, note.gain, 0.006, dur);
      osc("sine", f, when, end).connect(body);
      const bell = envelope(when, note.gain * 0.2, 0.004, dur * 0.4);
      osc("sine", f * 3, when, end).connect(bell);
      body.connect(leadBus as GainNode);
      bell.connect(leadBus as GainNode);
      return;
    }

    if (note.voice === "chord") {
      const g = envelope(when, note.gain, 0.02, dur);
      const o = osc("triangle", midiToFreq(note.midi), when, end);
      o.detune.setValueAtTime(note.beat % 2 === 0 ? -4 : 4, when);
      o.connect(g);
      g.connect(master as GainNode);
      return;
    }

    if (note.voice === "bass") {
      const lp = c.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 700;
      const g = envelope(when, note.gain, 0.012, dur);
      osc("triangle", midiToFreq(note.midi), when, end).connect(lp);
      lp.connect(g);
      g.connect(master as GainNode);
      return;
    }

    if (note.voice === "kick") {
      const o = c.createOscillator();
      o.type = "sine";
      o.frequency.setValueAtTime(130, when);
      o.frequency.exponentialRampToValueAtTime(45, when + 0.09);
      const g = envelope(when, note.gain, 0.004, 0.18);
      o.connect(g);
      g.connect(master as GainNode);
      o.start(when);
      o.stop(when + 0.3);
      return;
    }

    // shaker
    const src = c.createBufferSource();
    src.buffer = noise;
    const hp = c.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 6500;
    const g = envelope(when, note.gain, 0.003, 0.06);
    src.connect(hp);
    hp.connect(g);
    g.connect(master as GainNode);
    src.start(when);
    src.stop(when + 0.12);
  }

  function tick(): void {
    if (ctx === null || !playing) return;
    if (ctx.state !== "running") {
      // 操作待ち・タブが隠れている間は時計を進めない(無音の小節を飛ばさない)。
      origin = ctx.currentTime - bar * barSec;
      return;
    }
    const elapsed = ctx.currentTime - origin;
    for (const b of barsToSchedule(elapsed, barSec, bar, LOOKAHEAD_SEC)) {
      const barStart = origin + b * barSec;
      for (const note of barNotes(b)) playNote(note, barStart + note.beat * beatSec);
      bar = b + 1;
    }
  }

  return {
    get playing() {
      return playing;
    },
    start() {
      if (disposed || playing) return;
      if (!build()) return;
      const c = ctx as AudioContext;
      playing = true;
      origin = c.currentTime + 0.06 - bar * barSec;
      const g = (master as GainNode).gain;
      g.cancelScheduledValues(c.currentTime);
      g.setValueAtTime(Math.max(0.0001, g.value), c.currentTime);
      g.linearRampToValueAtTime(opts.volume, c.currentTime + FADE_IN_SEC);
      resumeAudio();
      timer = setInterval(tick, TICK_MS);
      tick();
    },
    stop() {
      if (!playing) return;
      playing = false;
      if (timer !== null) clearInterval(timer);
      timer = null;
      if (ctx === null || master === null) return;
      const now = ctx.currentTime;
      master.gain.cancelScheduledValues(now);
      master.gain.setValueAtTime(Math.max(0.0001, master.gain.value), now);
      master.gain.exponentialRampToValueAtTime(0.0001, now + FADE_OUT_SEC);
    },
    dispose() {
      this.stop();
      if (disposed) return;
      disposed = true;
      const had = ctx !== null;
      ctx = null;
      master = null;
      leadBus = null;
      noise = null;
      if (had) releaseAudio();
    },
  };
}
