/**
 * random ボット(docs/06 §4)。置ける手から一様ランダムに選ぶ。
 * ルールの生存性(初手ゲームオーバー率)の下限を測るための基準線。
 */
import { validPositions } from "../../src/core/board";
import { getShape } from "../../src/core/shapes";
import type { Rng } from "../../src/core/rng";
import type { GameState, ResolvedConfig } from "../../src/core/types";
import type { Bot, Move } from "./types";
import { trayPieces } from "./types";

export const randomBot: Bot = {
  name: "random",
  chooseMove(state: GameState, _config: ResolvedConfig, rng: Rng): Move | null {
    const moves: Move[] = [];
    for (const { trayIndex, shapeId } of trayPieces(state)) {
      const shape = getShape(shapeId);
      if (shape === undefined) continue;
      for (const [x, y] of validPositions(state.board, state.size, shape)) {
        moves.push({ trayIndex, x, y });
      }
    }
    if (moves.length === 0) return null;
    return moves[rng.nextInt(moves.length)] ?? null;
  },
};
