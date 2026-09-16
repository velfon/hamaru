import { defineConfig, devices } from "@playwright/test";

/**
 * E2E(docs/06 §5)。デバイスは Pixel 7 / iPhone 15 / Desktop Chrome。
 * **CI は Chromium のみ**(iPhone 15 = WebKit は週次)。
 *
 * サーバは 2 つ立てる:
 *   - 5173: `vite dev`。`?state=` によるテスト用状態の差し込みは開発ビルドのみ有効。
 *   - 4173: `vite preview`(本番ビルド)。Service Worker のオフライン起動を見る。
 */
const DEV_PORT = 5173;
const PREVIEW_PORT = 4173;

export const DEV_URL = `http://localhost:${DEV_PORT}`;
export const PREVIEW_URL = `http://localhost:${PREVIEW_PORT}`;

const isCI = process.env["CI"] === "true" || process.env["CI"] === "1";
/** 週次ワークフロー(e2e-weekly.yml)は WebKit を含む全プロジェクトを回す。 */
const allBrowsers = process.env["E2E_ALL_BROWSERS"] === "true";

const projects = [
  { name: "Pixel 7", use: { ...devices["Pixel 7"] } },
  { name: "iPhone 15", use: { ...devices["iPhone 15"] } },
  { name: "Desktop Chrome", use: { ...devices["Desktop Chrome"] } },
];

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  workers: isCI ? 2 : undefined,
  reporter: isCI ? [["github"], ["html", { open: "never" }]] : [["list"]],
  timeout: 30_000,
  expect: { timeout: 7_000 },
  use: {
    baseURL: DEV_URL,
    // 表示言語の自動判定(docs/01 §12)がブレないよう固定する。切替そのものは settings.spec で見る。
    locale: "en-US",
    trace: "on-first-retry",
    video: "off",
  },
  projects: isCI && !allBrowsers ? projects.filter((p) => p.name !== "iPhone 15") : projects,
  webServer: [
    {
      command: `npm run dev -- --port ${DEV_PORT} --strictPort`,
      url: DEV_URL,
      reuseExistingServer: !isCI,
      timeout: 60_000,
    },
    {
      command: `npm run build && npm run preview -- --port ${PREVIEW_PORT} --strictPort`,
      url: PREVIEW_URL,
      reuseExistingServer: !isCI,
      timeout: 120_000,
    },
  ],
});
