import type { Rng } from "../../src/core/rng";
import type { GameState, ResolvedConfig } from "../../src/core/types";

export interface Move {
  trayIndex: number;
  x: number;
  y: number;
}

export interface Bot {
  readonly name: string;
  /** 打つ手を選ぶ。置ける手が無ければ null(= ゲームオーバー)。 */
  chooseMove(state: GameState, config: ResolvedConfig, rng: Rng): Move | null;
}

/** トレイの (スロット, 形状) の組を列挙する。 */
export function* trayPieces(state: GameState): Generator<{ trayIndex: number; shapeId: string }> {
  for (let i = 0; i < state.tray.length; i++) {
    const piece = state.tray[i];
    if (piece === null || piece === undefined) continue;
    yield { trayIndex: i, shapeId: piece.shapeId };
  }
}
