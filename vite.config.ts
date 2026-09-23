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
        description: "10×10 のパズル。次のかけらは盤から返ってくる。",
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
        // 初回訪問でも SW がそのタブを制御する(= 次のリロードからオフラインで起動できる)。
        clientsClaim: true,
        // 新しい SW をすぐ有効にする。これが無いと、既にアプリを開いたことのある人には
        // **全部のタブを閉じるまで古い版が出続ける**(docs/02 §11 N-11)。
        skipWaiting: true,
      },
      devOptions: {
        // 開発サーバでは SW を登録しない。E2E の offline シナリオは
        // 本番ビルド(`vite preview`)に対して実行する(docs/06 §10 実装ノート N-3)。
        enabled: false,
      },
    }),
  ],
});
