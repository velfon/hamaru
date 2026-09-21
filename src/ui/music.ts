/**
 * BGM の切り替え(docs/10 §4)。ゲーム画面のヘッダに音符ボタンを置き、設定 `music` と同期する。
 *
 * 既定は OFF(docs/00 §5)。設定画面まで行かなくても 1 タップで試せるように、
 * 遊んでいる画面にボタンを出す。プレイヤは ON にした時に初めて作る(OFF のままなら
 * AudioContext を作らない)。
 */
import type { ResolvedConfig } from "../core/types";
import { createMusicPlayer, type MusicPlayer } from "../audio/player";
import { t } from "../i18n";
import { el, svg } from "./dom";
import { langStore, settingsStore } from "./store";

/** 音符(ON)。 */
export const ICON_MUSIC = [
  "M9 18V5l12-2v13",
  "M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z",
  "M21 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z",
];

/** 音符 + 斜線(OFF)。 */
export const ICON_MUSIC_OFF = [...ICON_MUSIC, "M3 3l18 18"];

export interface MusicControl {
  /** ヘッダに置くボタン。 */
  readonly button: HTMLButtonElement;
  destroy(): void;
}

export function createMusicControl(config: ResolvedConfig): MusicControl {
  let player: MusicPlayer | null = null;

  const button = el("button", { type: "button", class: "iconbtn", "data-testid": "music" });
  button.addEventListener("click", () => {
    settingsStore.update((s) => ({ ...s, music: !s.music }));
  });

  function render(on: boolean): void {
    const label = on ? t("game.music.on") : t("game.music.off");
    button.replaceChildren(svg(on ? ICON_MUSIC : ICON_MUSIC_OFF));
    button.classList.toggle("iconbtn--on", on);
    button.setAttribute("aria-pressed", String(on));
    button.setAttribute("aria-label", label);
    button.setAttribute("title", label);
  }

  function apply(on: boolean): void {
    render(on);
    if (on) {
      player ??= createMusicPlayer({ bpm: config.audio.bpm, volume: config.audio.volume });
      player?.start();
    } else {
      player?.stop();
    }
  }

  const unsubscribe = settingsStore.subscribe((s) => apply(s.music));
  const unsubscribeLang = langStore.subscribe(() => render(settingsStore.get().music));
  apply(settingsStore.get().music);

  return {
    button,
    destroy() {
      unsubscribe();
      unsubscribeLang();
      player?.dispose();
      player = null;
    },
  };
}
