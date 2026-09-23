/** でたらめに置くボット(下限の目安)。 */
import { validPositions } from "../../src/core/board";
import type { Rng } from "../../src/core/rng";
import type { GameState, ResolvedConfig } from "../../src/core/types";
import type { Bot, Move } from "./types";

export const randomBot: Bot = {
  name: "random",
  chooseMove(state: GameState, _config: ResolvedConfig, rng: Rng): Move | null {
    const spots = validPositions(state.board, state.size, state.piece);
    if (spots.length === 0) return null;
    const [x, y] = spots[rng.nextInt(spots.length)] as [number, number];
    return { x, y };
  },
};
