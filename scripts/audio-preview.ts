/**
 * `npm run audio:preview` — BGM を WAV に書き出す(耳で確かめるための開発用)。
 *
 *   tsx scripts/audio-preview.ts [--seconds 74] [--bpm 104] [--out /tmp/hamaru-bgm.wav]
 *
 * 音符は本番とまったく同じ `src/audio/score.ts` から作る。音色はブラウザの Web Audio
 * (`src/audio/player.ts`)を Node 上で単純化して真似たもの — 同じ波形・同じ包絡だが、
 * フィルタは 1 次、ディレイはフィードバック 1 段。**曲の確認用で、音そのものの正本ではない**。
 */
import { writeFileSync } from "node:fs";
import { DEFAULT_CONFIG } from "../src/config";
import { BEATS_PER_BAR, barNotes, barSeconds, midiToFreq, type Note } from "../src/audio/score";

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

function render(seconds: number, bpm: number, volume: number): Float32Array {
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

  for (let bar = 0; bar * barSec < seconds; bar++) {
    for (const note of barNotes(bar)) voice(note, bar * barSec + note.beat * beatSec);
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

const seconds = Number(arg("--seconds", String(barSeconds(DEFAULT_CONFIG.audio.bpm) * 32)));
const bpm = Number(arg("--bpm", String(DEFAULT_CONFIG.audio.bpm)));
const volume = Number(arg("--volume", String(DEFAULT_CONFIG.audio.volume)));
const out = arg("--out", "/tmp/hamaru-bgm.wav");
const samples = render(seconds, bpm, volume);
writeFileSync(out, toWav(samples));
console.log(
  `audio:preview: ${out}(${seconds.toFixed(1)} 秒 / ${bpm} BPM / ${BEATS_PER_BAR} 拍子 / 音量 ${volume})`,
);
