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

/**
 * 初回 JS に載せたくない画面を、開いた時に読み込む(docs/02 §11 N-15)。
 * 読み込みが終わるまでは何も出ない(ほぼ一瞬)。失敗しても黙って戻る
 * (版の入れ替え直後など。開き直せば読み込み直す)。
 */
export function lazyScreen(
  container: HTMLElement,
  query: URLSearchParams,
  load: () => Promise<ScreenFactory>,
): Screen {
  let inner: Screen | null = null;
  let unmounted = false;
  void load().then(
    (factory) => {
      if (unmounted) return;
      inner = factory(container, query);
    },
    () => {
      /* 開き直せば読み込み直す */
    },
  );
  return {
    unmount() {
      unmounted = true;
      inner?.unmount();
    },
  };
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
