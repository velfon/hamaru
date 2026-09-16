/**
 * DOM を組み立てる最小のヘルパ。
 *
 * 実装ノート: docs/02 §2 のツリーには無いファイルだが、フレームワークを入れない方針
 * (docs/02 §1)で 5 画面を書くと `document.createElement` の定型が全画面に散るため、
 * 20 行のヘルパだけを切り出した。依存は増やしていない。
 */

type Attrs = Record<string, string | number | boolean | undefined | null>;
type Child = Node | string | null | undefined | false;

/** 属性とテキストを一度に指定して要素を作る。`class` / `data-*` / `aria-*` はそのまま属性名で書く。 */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  children: Child[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    node.setAttribute(key, value === true ? "" : String(value));
  }
  append(node, children);
  return node;
}

export function append(parent: Node, children: Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    parent.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
  }
}

/** アイコン用の inline SVG(画像ファイルを増やさない)。 */
export function svg(paths: readonly string[], attrs: Record<string, string> = {}): SVGSVGElement {
  const ns = "http://www.w3.org/2000/svg";
  const node = document.createElementNS(ns, "svg");
  node.setAttribute("viewBox", "0 0 24 24");
  node.setAttribute("fill", "none");
  node.setAttribute("stroke", "currentColor");
  node.setAttribute("stroke-width", "1.8");
  node.setAttribute("stroke-linecap", "round");
  node.setAttribute("stroke-linejoin", "round");
  node.setAttribute("aria-hidden", "true");
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  for (const d of paths) {
    const path = document.createElementNS(ns, "path");
    path.setAttribute("d", d);
    node.appendChild(path);
  }
  return node;
}

/** `prefers-reduced-motion` の現在値。 */
export function systemPrefersReducedMotion(): boolean {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

/**
 * `{name}` の位置だけを要素に差し替えたフラグメントを作る。
 * 「ベスト **12,340**」のように数値だけ別書体にしたいときに使う。
 */
export function fillSlot(template: string, name: string, node: Node): DocumentFragment {
  const frag = document.createDocumentFragment();
  const marker = `{${name}}`;
  const index = template.indexOf(marker);
  if (index < 0) {
    frag.appendChild(document.createTextNode(template));
    return frag;
  }
  const before = template.slice(0, index);
  const after = template.slice(index + marker.length);
  if (before !== "") frag.appendChild(document.createTextNode(before));
  frag.appendChild(node);
  if (after !== "") frag.appendChild(document.createTextNode(after));
  return frag;
}
