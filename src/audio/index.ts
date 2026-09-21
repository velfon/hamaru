/**
 * 音(docs/10)。BGM と効果音をまとめた入口。
 *
 * UI からは `import("../audio")` で **音を使う時に初めて**読み込む(初回 JS に載せない)。
 */
export { createMusicPlayer, type MusicPlayer } from "./player";
export { createSfx, sfxNotes, type Sfx, type SfxContext, type SfxName } from "./sfx";
