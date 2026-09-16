/**
 * ハッシュルータ(docs/01 §9、docs/02 §5)。
 * 画面は `mount(container, query) → unmount()` を持つ。
 */

export interface Screen {
  unmount(): void;
}

export type ScreenFactory = (container: HTMLElement, query: URLSearchParams) => Screen;

export interface Route {
  path: string;
  screen: ScreenFactory;
}

export interface Router {
  start(): void;
  stop(): void;
  /** 現在のパス(`/play` など)。 */
  path(): string;
}

/** `#/play?new=1` を `{ path: "/play", query }` に分解する。 */
export function parseHash(hash: string): { path: string; query: URLSearchParams } {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  const [path = "", search = ""] = raw.split("?", 2);
  return {
    path: path === "" ? "/" : path,
    query: new URLSearchParams(search),
  };
}

export function navigate(path: string): void {
  if (location.hash === `#${path}`) {
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    return;
  }
  location.hash = path;
}

export function createRouter(container: HTMLElement, routes: readonly Route[]): Router {
  let current: Screen | null = null;
  let currentPath = "";

  function render(): void {
    const { path, query } = parseHash(location.hash);
    const route = routes.find((r) => r.path === path) ?? routes[0];
    if (route === undefined) return;
    current?.unmount();
    container.replaceChildren();
    currentPath = route.path;
    current = route.screen(container, query);
    // 画面遷移のたびに先頭へ(ゲーム → 設定 → ゲームでスクロール位置が残らないように)。
    window.scrollTo(0, 0);
  }

  const onHashChange = (): void => render();

  return {
    start() {
      window.addEventListener("hashchange", onHashChange);
      render();
    },
    stop() {
      window.removeEventListener("hashchange", onHashChange);
      current?.unmount();
      current = null;
    },
    path: () => currentPath,
  };
}
