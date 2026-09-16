import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

/**
 * PWA(docs/02 §1、docs/03 §8)。
 * `generateSW`(Workbox)で precache のみ。オフラインで起動できれば十分で、
 * ランタイムキャッシュは同一オリジンの静的資産しか無いので設定しない。
 */
export default defineConfig({
  build: {
    target: "es2022",
    sourcemap: true,
  },
  plugins: [
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: "script-defer",
      includeAssets: ["icons/favicon.svg", "icons/apple-touch-icon.png", "fonts/*.woff2"],
      manifest: {
        name: "HAMARU",
        short_name: "HAMARU",
        description: "10×10 のブロックはめ込みパズル。",
        lang: "ja",
        start_url: "/?r=pwa",
        scope: "/",
        display: "standalone",
        orientation: "portrait",
        background_color: "#17262A",
        theme_color: "#17262A",
        icons: [
          { src: "icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icons/icon-512.png", sizes: "512x512", type: "image/png" },
          {
            src: "icons/icon-maskable-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,woff2,png,svg,webmanifest}"],
        cleanupOutdatedCaches: true,
        navigateFallback: "index.html",
      },
      devOptions: {
        // 開発サーバでも SW を登録する(E2E の offline シナリオ用。docs/06 §5)。
        enabled: true,
        type: "module",
        navigateFallback: "index.html",
      },
    }),
  ],
});
