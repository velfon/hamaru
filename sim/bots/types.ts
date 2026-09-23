import type { Rng } from "../../src/core/rng";
import type { GameState, ResolvedConfig } from "../../src/core/types";

/** 逆手の 1 手 = かけらを置く位置(手持ちは 1 個)。 */
export interface Move {
  x: number;
  y: number;
}

export interface Bot {
  readonly name: string;
  /** 打つ手を選ぶ。置ける手が無ければ null(= ゲームオーバー)。 */
  chooseMove(state: GameState, config: ResolvedConfig, rng: Rng): Move | null;
}
