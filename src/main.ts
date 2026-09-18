/**
 * エントリポイント(docs/02 §5)。
 * 設定・統計の読み込み → テーマ / 言語の適用 → config 解決 → テレメトリ → ルータ起動。
 */
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/game.css";

import { DEFAULT_CONFIG, DEFAULT_EXPERIMENTS, resolveAssignment, resolveConfig } from "./config";
import { cyrb53 } from "./core/rng";
import { detectLang, getLang, setLang, t } from "./i18n";
import {
  loadInstall,
  loadSettings,
  loadStats,
  saveSettings,
  saveStats,
  type Settings,
} from "./storage/local";
import { detectPlatform, getQueue, initTelemetry, track, updateContext } from "./telemetry/client";
import { initVitals } from "./telemetry/vitals";
import { createRouter, type Route } from "./ui/router";
import { aboutScreen } from "./ui/screens/about";
import { gameScreen } from "./ui/screens/game";
import { levelScreen } from "./ui/screens/level";
import { levelsScreen } from "./ui/screens/levels";
import { rankingScreen } from "./ui/screens/ranking";
import { homeScreen } from "./ui/screens/home";
import { settingsScreen } from "./ui/screens/settings";
import { langStore, setContext, settingsStore, statsStore } from "./ui/store";

const APP_VERSION = String(import.meta.env["VITE_APP_VERSION"] ?? "dev");
/** セッションの更新間隔(docs/04 §2「30 分無操作で更新」)。 */
const SESSION_IDLE_MS = 30 * 60_000;

function uuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/* ------------------------------------------------------------------ */
/* テーマ・言語の適用                                                    */
/* ------------------------------------------------------------------ */

function themeColor(): string {
  return getComputedStyle(document.documentElement).getPropertyValue("--kiln").trim() || "#17262A";
}

function applyThemeColor(): void {
  let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (meta === null) {
    meta = document.createElement("meta");
    meta.name = "theme-color";
    document.head.appendChild(meta);
  }
  meta.content = themeColor();
}

function applySettings(settings: Settings, previousLang: string): boolean {
  const root = document.documentElement;
  root.dataset["theme"] = settings.theme;
  root.dataset["motion"] = settings.motion === "always" ? "reduced" : "system";

  const lang = settings.lang === "auto" ? detectLang(navigator.languages) : settings.lang;
  setLang(lang);
  root.lang = lang;
  langStore.set(lang);
  applyThemeColor();
  return lang !== previousLang;
}

/* ------------------------------------------------------------------ */
/* 起動                                                                */
/* ------------------------------------------------------------------ */

function boot(): void {
  const app = document.querySelector<HTMLElement>("#app");
  if (app === null) return;

  const settings = loadSettings();
  settingsStore.set(settings);
  statsStore.set(loadStats());
  applySettings(settings, "");

  settingsStore.subscribe((next) => {
    saveSettings(next);
    const changedLang = applySettings(next, getLang());
    if (changedLang) {
      updateContext({ lang: getLang() });
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    }
  });
  statsStore.subscribe(saveStats);

  window
    .matchMedia?.("(prefers-color-scheme: dark)")
    .addEventListener("change", () => applyThemeColor());

  const install = loadInstall(uuid, Date.now(), APP_VERSION);
  const assignment = resolveAssignment(DEFAULT_EXPERIMENTS, install.id, "endless");
  const config = resolveConfig(
    DEFAULT_CONFIG,
    DEFAULT_EXPERIMENTS,
    install.id,
    "endless",
    (message) =>
      track({
        event: "error",
        message: message.slice(0, 200),
        stackHash: hash(message),
        kind: "config",
      }),
  );

  setContext({
    installId: install.id,
    version: APP_VERSION,
    config,
    exp: assignment?.exp ?? "",
    variant: assignment?.variant ?? "",
  });

  const gpc = (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl;
  initTelemetry(
    {
      installId: install.id,
      sessionId: uuid(),
      version: APP_VERSION,
      lang: getLang(),
      platform: detectPlatform(navigator.userAgent),
      exp: assignment?.exp ?? "",
      variant: assignment?.variant ?? "",
      mode: "",
    },
    gpc === true,
  );

  track({ event: "session_start", ref: detectRef() });
  if (gpc !== true) initVitals();

  installErrorHandlers();
  watchSession();

  const routes: readonly Route[] = [
    { path: "/", screen: (container) => homeScreen(container) },
    { path: "/play", screen: gameScreen("endless") },
    { path: "/daily", screen: gameScreen("daily") },
    { path: "/settings", screen: (container) => settingsScreen(container) },
    { path: "/about", screen: (container) => aboutScreen(container) },
    { path: "/ranking", screen: rankingScreen },
    { path: "/levels", screen: (container) => levelsScreen(container) },
    { path: "/level", screen: levelScreen },
  ];

  const router = createRouter(app, routes);
  router.start();

  if (import.meta.env.DEV) {
    (window as unknown as Record<string, unknown>)["__hamaru"] = {
      telemetry: getQueue,
      t,
    };
  }
}

function hash(message: string): string {
  return cyrb53(message).toString(16);
}

function detectRef(): "direct" | "share" | "pwa" | "other" {
  const r = new URLSearchParams(location.search).get("r");
  if (window.matchMedia?.("(display-mode: standalone)").matches === true) return "pwa";
  if (r === "share") return "share";
  if (r !== null) return "other";
  return "direct";
}

function installErrorHandlers(): void {
  window.addEventListener("error", (ev) => {
    const message = String(ev.message ?? "error").slice(0, 200);
    track({ event: "error", message, stackHash: hash(`${ev.filename}:${ev.lineno}`), kind: "js" });
  });
  window.addEventListener("unhandledrejection", (ev) => {
    const message = String(ev.reason ?? "rejection").slice(0, 200);
    track({ event: "error", message, stackHash: hash(message), kind: "promise" });
  });
}

/** 30 分無操作で復帰したら新しいセッションとして数える(docs/04 §3)。 */
function watchSession(): void {
  let lastActive = Date.now();
  const touch = (): void => void (lastActive = Date.now());
  document.addEventListener("pointerdown", touch, { passive: true });
  document.addEventListener("keydown", touch, { passive: true });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") {
      touch();
      return;
    }
    if (Date.now() - lastActive < SESSION_IDLE_MS) {
      touch();
      return;
    }
    touch();
    updateContext({ sessionId: uuid() });
    track({ event: "session_start", ref: detectRef() });
  });
}

boot();
