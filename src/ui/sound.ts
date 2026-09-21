/**
 * 音の切り替えと効果音の呼び出し口(docs/10 §4)。
 *
 * ホームとゲーム画面のヘッダに音符ボタンを置く。これは **BGM と効果音のまとめて入切**で、
 * 片方だけ使いたい人は設定画面でそれぞれを切り替える。既定はどちらも OFF(docs/00 §5)。
 * BGM が鳴るのは遊んでいる画面だけなので、ホームでは `playsMusic: false` で作り、
 * ON にした合図として短い音だけ鳴らす。
 * 音を出す部分は **ON にした時に初めて読み込む**(`import()`)。OFF のままなら
 * 初回 JS にも AudioContext にも一切費用がかからない。
 */
import type { ResolvedConfig } from "../core/types";
import type { MusicPlayer, Sfx, SfxContext, SfxName } from "../audio";
import { t } from "../i18n";
import type { Settings } from "../storage/local";
import { el, svg } from "./dom";
import { langStore, settingsStore } from "./store";

/** 音符(ON)。 */
export const ICON_SOUND = [
  "M9 18V5l12-2v13",
  "M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z",
  "M21 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z",
];

/** 音符 + 斜線(OFF)。 */
export const ICON_SOUND_OFF = [...ICON_SOUND, "M3 3l18 18"];

export interface SoundControl {
  /** ヘッダに置くボタン。 */
  readonly button: HTMLButtonElement;
  /** 効果音を鳴らす(設定が OFF なら何もしない)。 */
  play(name: SfxName, ctx?: SfxContext): void;
  destroy(): void;
}

export interface SoundControlOptions {
  /** この画面で BGM を鳴らすか(既定 true。ホームは false)。 */
  playsMusic?: boolean;
}

export function createSoundControl(
  config: ResolvedConfig,
  options: SoundControlOptions = {},
): SoundControl {
  const playsMusic = options.playsMusic !== false;
  let player: MusicPlayer | null = null;
  let sfx: Sfx | null = null;
  let loading = false;
  let destroyed = false;

  const button = el("button", { type: "button", class: "iconbtn", "data-testid": "sound" });
  button.addEventListener("click", () => {
    let turnedOn = false;
    settingsStore.update((s) => {
      const on = !(s.music || s.sfx);
      turnedOn = on;
      return { ...s, music: on, sfx: on };
    });
    // BGM が鳴らない画面では、ON にしても何も聞こえない。短い合図を鳴らす。
    if (turnedOn && !playsMusic) {
      sfx?.prime();
      sfx?.play("confirm");
    }
  });

  function render(on: boolean): void {
    const label = on ? t("game.sound.on") : t("game.sound.off");
    button.replaceChildren(svg(on ? ICON_SOUND : ICON_SOUND_OFF));
    button.classList.toggle("iconbtn--on", on);
    button.setAttribute("aria-pressed", String(on));
    button.setAttribute("aria-label", label);
    button.setAttribute("title", label);
  }

  function load(): void {
    if (loading || destroyed) return;
    loading = true;
    void import("../audio").then((audio) => {
      if (destroyed) return;
      player ??= audio.createMusicPlayer({
        bpm: config.audio.bpm,
        volume: config.audio.volume,
      });
      sfx ??= audio.createSfx({ volume: config.audio.sfxVolume });
      const now = settingsStore.get();
      apply(now); // 読み込んでいる間に変わっているかもしれない
      if (gestured && now.sfx) sfx?.prime();
      // ボタンを押した流れで読み込んだ場合は、読み込み終わりに合図を鳴らす
      if (!playsMusic && gestured && now.sfx && !confirmed) {
        confirmed = true;
        sfx?.play("confirm");
      }
    });
  }

  function apply(s: Settings): void {
    render(s.music || s.sfx);
    if (s.music || s.sfx) load();
    // ボタンで ON にした時は、その操作の中で音を温めておく(Safari 対策)。
    if (s.sfx) sfx?.prime();
    if (s.music && playsMusic) player?.start();
    else player?.stop();
  }

  // 効果音は「置いた瞬間」に鳴る。最初の操作の中で AudioContext を作っておかないと
  // 1 音目が捨てられるので、最初の pointerdown で温める。
  let gestured = false;
  let confirmed = false;
  const onGesture = (): void => {
    gestured = true;
    if (settingsStore.get().sfx) sfx?.prime();
  };
  document.addEventListener("pointerdown", onGesture);

  const unsubscribe = settingsStore.subscribe(apply);
  const unsubscribeLang = langStore.subscribe(() => {
    const s = settingsStore.get();
    render(s.music || s.sfx);
  });
  apply(settingsStore.get());

  return {
    button,
    play(name, ctx) {
      if (!settingsStore.get().sfx) return;
      sfx?.play(name, ctx);
    },
    destroy() {
      destroyed = true;
      document.removeEventListener("pointerdown", onGesture);
      unsubscribe();
      unsubscribeLang();
      player?.dispose();
      sfx?.dispose();
      player = null;
      sfx = null;
    },
  };
}
