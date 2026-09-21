/**
 * `npm run audio:preview` — BGM と効果音を WAV に書き出す(耳で確かめるための開発用)。
 *
 *   tsx scripts/audio-preview.ts [--seconds 74] [--bpm 104] [--out /tmp/hamaru-bgm.wav]
 *   tsx scripts/audio-preview.ts --sfx [--out /tmp/hamaru-sfx.wav]   # 効果音の見本
 *
 * 音符は本番とまったく同じ `src/audio/score.ts` から作る。音色はブラウザの Web Audio
 * (`src/audio/player.ts`)を Node 上で単純化して真似たもの — 同じ波形・同じ包絡だが、
 * フィルタは 1 次、ディレイはフィードバック 1 段。**曲の確認用で、音そのものの正本ではない**。
 */
import { writeFileSync } from "node:fs";
import { DEFAULT_CONFIG } from "../src/config";
import { BEATS_PER_BAR, barNotes, barSeconds, midiToFreq, type Note } from "../src/audio/score";
import { sfxNotes, type SfxContext, type SfxName } from "../src/audio/sfx";

const RATE = 44100;

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] !== undefined ? (process.argv[i + 1] as string) : fallback;
}

/** WebAudio の exponentialRampToValueAtTime と同じ形の減衰。 */
function envelope(t: number, peak: number, attack: number, dur: number): number {
  if (t < 0) return 0;
  if (t < attack) return (peak * t) / attack;
  const d = Math.max(attack + 0.02, dur);
  if (t > d) return 0;
  return peak * Math.pow(0.0001 / peak, (t - attack) / (d - attack));
}

const triangle = (phase: number): number => 2 * Math.abs(2 * (phase - Math.floor(phase + 0.5))) - 1;
const sine = (phase: number): number => Math.sin(2 * Math.PI * phase);

/** 1 次のローパス(player.ts の BiquadFilter の代わり)。 */
function lowpass(buf: Float32Array, cutoff: number): void {
  const a = 1 - Math.exp((-2 * Math.PI * cutoff) / RATE);
  let y = 0;
  for (let i = 0; i < buf.length; i++) {
    y += a * ((buf[i] as number) - y);
    buf[i] = y;
  }
}

interface SfxEvent {
  at: number;
  name: SfxName;
  ctx?: SfxContext;
}

/** 効果音の見本(前半は効果音だけ、後半は BGM の上で鳴らす)。 */
const DEMO: SfxEvent[] = [
  { at: 0.6, name: "place", ctx: { cells: 1 } },
  { at: 1.1, name: "place", ctx: { cells: 3 } },
  { at: 1.6, name: "place", ctx: { cells: 5 } },
  { at: 2.6, name: "clear", ctx: { lines: 1, streak: 0 } },
  { at: 3.6, name: "clear", ctx: { lines: 1, streak: 1 } },
  { at: 4.6, name: "clear", ctx: { lines: 2, streak: 2 } },
  { at: 5.6, name: "clear", ctx: { lines: 3, streak: 3 } },
  { at: 7.0, name: "boardClear" },
  { at: 9.5, name: "levelClear" },
  { at: 12.0, name: "gameOver" },
  // ここから BGM の上に重ねる(音量の釣り合いを見る)
  { at: 17.0, name: "place", ctx: { cells: 2 } },
  { at: 17.6, name: "place", ctx: { cells: 4 } },
  { at: 18.4, name: "clear", ctx: { lines: 1, streak: 0 } },
  { at: 19.6, name: "clear", ctx: { lines: 2, streak: 1 } },
  { at: 21.0, name: "clear", ctx: { lines: 2, streak: 2 } },
  { at: 22.4, name: "boardClear" },
  { at: 25.0, name: "gameOver" },
];

const DEMO_BGM_FROM = 15;

function render(
  seconds: number,
  bpm: number,
  volume: number,
  demo?: { sfxVolume: number; bgmFrom: number },
): Float32Array {
  const beatSec = 60 / bpm;
  const barSec = barSeconds(bpm);
  const frames = Math.ceil(seconds * RATE);
  const lead = new Float32Array(frames);
  const rest = new Float32Array(frames);
  let noiseSeed = 1;
  const noise = (): number => {
    noiseSeed = (noiseSeed * 1103515245 + 12345) & 0x7fffffff;
    return noiseSeed / 0x3fffffff - 1;
  };

  const add = (buf: Float32Array, at: number, dur: number, fn: (t: number) => number): void => {
    const from = Math.max(0, Math.floor(at * RATE));
    const to = Math.min(frames, Math.ceil((at + dur) * RATE));
    for (let i = from; i < to; i++) buf[i] = (buf[i] as number) + fn(i / RATE - at);
  };

  const voice = (note: Note, at: number): void => {
    const dur = note.dur * beatSec;
    const f = midiToFreq(note.midi);
    if (note.voice === "lead") {
      add(lead, at, dur + 0.1, (t) => sine(f * t) * envelope(t, note.gain, 0.006, dur));
      add(
        lead,
        at,
        dur * 0.4 + 0.05,
        (t) => sine(3 * f * t) * envelope(t, note.gain * 0.2, 0.004, dur * 0.4),
      );
      return;
    }
    if (note.voice === "chord") {
      const detune = Math.pow(2, (note.beat % 2 === 0 ? -4 : 4) / 1200);
      add(rest, at, dur + 0.1, (t) => triangle(f * detune * t) * envelope(t, note.gain, 0.02, dur));
      return;
    }
    if (note.voice === "bass") {
      const one = new Float32Array(Math.ceil((dur + 0.1) * RATE));
      for (let i = 0; i < one.length; i++) {
        const t = i / RATE;
        one[i] = triangle(f * t) * envelope(t, note.gain, 0.012, dur);
      }
      lowpass(one, 700);
      add(rest, at, dur + 0.1, (t) => one[Math.floor(t * RATE)] ?? 0);
      return;
    }
    if (note.voice === "kick") {
      // 130 → 45 Hz へ 90 ms で落とす(player.ts と同じ)。位相を積分して出す。
      let phase = 0;
      add(rest, at, 0.3, (t) => {
        const freq = t < 0.09 ? 130 * Math.pow(45 / 130, t / 0.09) : 45;
        phase += freq / RATE;
        return sine(phase) * envelope(t, note.gain, 0.004, 0.18);
      });
      return;
    }
    // shaker: 白色雑音 + 高域通過(1 次のハイパス = 原音 − ローパス)
    let lp = 0;
    add(rest, at, 0.12, (t) => {
      const x = noise() * 0.6;
      lp += 0.35 * (x - lp);
      return (x - lp) * envelope(t, note.gain, 0.003, 0.06);
    });
  };

  // 効果音(player 側の音色を Node で真似る。§7 の注記どおり近似)。
  // 出口で volume を掛けるので、効果音は sfxVolume / volume 倍しておく。
  const sfxVoice = (
    note: { midi: number; dur: number; gain: number; timbre: string },
    when: number,
    scale: number,
  ): void => {
    const f = midiToFreq(note.midi);
    const g = note.gain * scale;
    if (note.timbre === "click") {
      let lo = 0;
      let hi = 0;
      add(rest, when, 0.06, (t) => {
        const x = noise();
        hi += 0.5 * (x - hi); // f*3 あたりまでを通す粗い帯域通過
        lo += 0.12 * (x - lo);
        return (hi - lo) * envelope(t, g * 0.5, 0.001, 0.03);
      });
      add(rest, when, note.dur + 0.05, (t) => triangle(f * t) * envelope(t, g, 0.003, note.dur));
      return;
    }
    if (note.timbre === "pluck") {
      add(lead, when, note.dur + 0.1, (t) => sine(f * t) * envelope(t, g, 0.005, note.dur));
      add(
        lead,
        when,
        note.dur * 0.35 + 0.05,
        (t) => sine(3 * f * t) * envelope(t, g * 0.22, 0.004, note.dur * 0.35),
      );
      return;
    }
    if (note.timbre === "bell") {
      add(lead, when, note.dur + 0.1, (t) => sine(f * t) * envelope(t, g, 0.01, note.dur));
      add(
        lead,
        when,
        note.dur * 0.5 + 0.05,
        (t) => sine(2.76 * f * t) * envelope(t, g * 0.18, 0.01, note.dur * 0.5),
      );
      return;
    }
    // warm
    const one = new Float32Array(Math.ceil((note.dur + 0.1) * RATE));
    for (let i = 0; i < one.length; i++) {
      one[i] = triangle((f * i) / RATE) * envelope(i / RATE, g, 0.02, note.dur);
    }
    lowpass(one, 1800);
    add(rest, when, note.dur + 0.1, (t) => one[Math.floor(t * RATE)] ?? 0);
  };

  const bgmFrom = demo?.bgmFrom ?? 0;
  for (let bar = 0; bgmFrom + bar * barSec < seconds; bar++) {
    for (const note of barNotes(bar)) voice(note, bgmFrom + bar * barSec + note.beat * beatSec);
  }

  if (demo !== undefined) {
    for (const event of DEMO) {
      for (const note of sfxNotes(event.name, event.ctx)) {
        sfxVoice(note, event.at + note.at, demo.sfxVolume / volume);
      }
    }
  }

  // 旋律に付点 8 分のディレイ(player.ts: send 0.16 / feedback 0.25)
  const delaySamples = Math.round(beatSec * 0.75 * RATE);
  const echo = new Float32Array(frames);
  for (let i = delaySamples; i < frames; i++) {
    echo[i] = ((lead[i - delaySamples] as number) + 0.25 * (echo[i - delaySamples] as number)) * 1;
  }

  const out = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    out[i] = (lead[i] as number) + (rest[i] as number) + 0.16 * (echo[i] as number);
  }
  lowpass(out, 6000);
  for (let i = 0; i < frames; i++) out[i] = (out[i] as number) * volume;
  return out;
}

function toWav(samples: Float32Array): Buffer {
  const data = Buffer.alloc(samples.length * 2);
  let peak = 0;
  for (const s of samples) peak = Math.max(peak, Math.abs(s));
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i] as number));
    data.writeInt16LE(Math.round(v * 32767), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // モノラル
  header.writeUInt32LE(RATE, 24);
  header.writeUInt32LE(RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  console.log(`peak ${peak.toFixed(3)}${peak >= 1 ? " (クリップ!)" : ""}`);
  return Buffer.concat([header, data]);
}

const sfxMode = process.argv.includes("--sfx");
const seconds = Number(
  arg("--seconds", sfxMode ? "30" : String(barSeconds(DEFAULT_CONFIG.audio.bpm) * 32)),
);
const bpm = Number(arg("--bpm", String(DEFAULT_CONFIG.audio.bpm)));
const volume = Number(arg("--volume", String(DEFAULT_CONFIG.audio.volume)));
const sfxVolume = Number(arg("--sfx-volume", String(DEFAULT_CONFIG.audio.sfxVolume)));
const out = arg("--out", sfxMode ? "/tmp/hamaru-sfx.wav" : "/tmp/hamaru-bgm.wav");
const samples = render(
  seconds,
  bpm,
  volume,
  sfxMode ? { sfxVolume, bgmFrom: DEMO_BGM_FROM } : undefined,
);
writeFileSync(out, toWav(samples));
console.log(
  sfxMode
    ? `audio:preview --sfx: ${out}(${seconds.toFixed(1)} 秒。前半は効果音だけ、${DEMO_BGM_FROM} 秒から BGM に重ねる / 効果音の音量 ${sfxVolume})`
    : `audio:preview: ${out}(${seconds.toFixed(1)} 秒 / ${bpm} BPM / ${BEATS_PER_BAR} 拍子 / 音量 ${volume})`,
);
