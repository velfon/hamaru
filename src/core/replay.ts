/**
 * 手順の再生(docs/08 §2)。サーバ(Worker)がデイリーの得点を検証するのに使う。
 *
 * core は決定的なので、同じ config・同じシード・同じ手の列からは必ず同じ状態になる。
 * クライアントは得点ではなく**手の列**を送り、サーバがここで再生して得点を確定する
 * (クライアントが申告した得点は信用しない)。
 */
import { newGame, place } from "./game";
import type { GameState, Mode, ResolvedConfig } from "./types";

/** 1 手 = [トレイの位置 0〜2, x, y](x, y はピースのバウンディングボックスの左上)。 */
export type Move = readonly [trayIndex: number, x: number, y: number];

/** 1 ゲームの手数の上限(暴走・過大な入力の防止)。 */
export const MAX_REPLAY_MOVES = 2000;

export type ReplayResult =
  | { ok: true; state: GameState }
  | { ok: false; error: "too_many_moves" | "invalid_move" | "moves_after_end"; at: number };

export function replay(
  config: ResolvedConfig,
  mode: Mode,
  seed: string,
  moves: readonly Move[],
): ReplayResult {
  if (moves.length > MAX_REPLAY_MOVES) {
    return { ok: false, error: "too_many_moves", at: MAX_REPLAY_MOVES };
  }
  let state = newGame(config, mode, seed, 0);
  for (let i = 0; i < moves.length; i++) {
    if (state.status !== "playing") return { ok: false, error: "moves_after_end", at: i };
    const [t, x, y] = moves[i] as Move;
    const { state: next, result } = place(state, config, t, x, y);
    if (!result.ok) return { ok: false, error: "invalid_move", at: i };
    state = next;
  }
  return { ok: true, state };
}
