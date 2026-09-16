/**
 * Worker(docs/02 §7)。
 *
 *   POST /api/events  → 検証して Analytics Engine に書く(204)
 *   GET  /api/health  → `{ ok, version }`
 *   それ以外          → 静的資産(`env.ASSETS`)
 *
 * `run_worker_first: ["/api/*"]`(wrangler.jsonc)なので、この Worker が最初に見るのは
 * 実質 `/api/*` だけ。それ以外は Asset Worker が先に応答するが、
 * 素通し先として `env.ASSETS.fetch` を残しておく(ローカル開発と将来の経路変更のため)。
 */
import { handleEvents } from "./events";

/** `request.cf.country` を粗い地域として使う。IP は保存しない(docs/02 §10)。 */
function country(request: Request): string {
  const cf = request.cf;
  const value = cf === undefined ? undefined : cf.country;
  return typeof value === "string" ? value : "";
}

export default {
  async fetch(request, env, _ctx) {
    const url = new URL(request.url);

    if (url.pathname === "/api/events") {
      return handleEvents(request, env, country(request));
    }

    if (url.pathname === "/api/health") {
      return Response.json(
        { ok: true, version: env.APP_VERSION },
        { headers: { "x-content-type-options": "nosniff", "cache-control": "no-store" } },
      );
    }

    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
