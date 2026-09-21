/**
 * 共有の AudioContext(docs/10 §3)。BGM と効果音で 1 つだけ作る。
 *
 * ブラウザは操作前に音を出せない。`resumeAudio()` は失敗せず、最初の `pointerdown` で
 * 自動的に再挑戦する。タブが隠れている間は止める(電池)。
 * 使う側は `acquireAudio()` / `releaseAudio()` を対で呼ぶ。誰も使わなくなったら閉じる。
 */

type Ctor = new () => AudioContext;

let ctx: AudioContext | null = null;
let users = 0;
let bound = false;

function ctor(): Ctor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { AudioContext?: Ctor; webkitAudioContext?: Ctor };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

const onGesture = (): void => resumeAudio();

const onVisibility = (): void => {
  if (ctx === null) return;
  if (document.visibilityState === "hidden") void ctx.suspend().catch(() => {});
  else resumeAudio();
};

/** 使い始める。環境が Web Audio に対応していなければ null。 */
export function acquireAudio(): AudioContext | null {
  if (ctx === null) {
    const Ctx = ctor();
    if (Ctx === null) return null;
    try {
      ctx = new Ctx();
    } catch {
      return null; // 端末が作らせない(古い iOS など)
    }
  }
  users++;
  if (!bound) {
    document.addEventListener("pointerdown", onGesture);
    document.addEventListener("visibilitychange", onVisibility);
    bound = true;
  }
  return ctx;
}

/** 使い終わる。最後の 1 人が離れたら閉じる。 */
export function releaseAudio(): void {
  users = Math.max(0, users - 1);
  if (users > 0) return;
  if (bound) {
    document.removeEventListener("pointerdown", onGesture);
    document.removeEventListener("visibilitychange", onVisibility);
    bound = false;
  }
  const closing = ctx;
  ctx = null;
  if (closing !== null) void closing.close().catch(() => {});
}

/** 止まっていたら動かす。まだ操作がなければ何もしない(次の pointerdown で再挑戦)。 */
export function resumeAudio(): void {
  if (ctx === null || ctx.state === "running") return;
  void ctx.resume().catch(() => {});
}
