/**
 * docs/06 §5 の `offline` シナリオ。
 * Service Worker 登録後にオフラインでリロードしても起動する。
 *
 * これだけは**本番ビルド**(`vite preview`、4173)に対して実行する。
 * 開発サーバはモジュールを都度配信するため precache の検証にならない。
 */
import { expect, test } from "@playwright/test";
import { PREVIEW_URL } from "../../playwright.config";

test.describe("offline", () => {
  test.skip(
    ({ browserName }) => browserName !== "chromium",
    "Service Worker + オフライン制御は Chromium のみで検証する(WebKit は週次の手動確認)",
  );

  test("SW 登録後、オフラインでもリロードで起動する", async ({ page, context }) => {
    await page.goto(PREVIEW_URL);
    await expect(page.getByTestId("home-screen")).toBeVisible();

    await page.waitForFunction(
      async () => {
        const reg = await navigator.serviceWorker.getRegistration();
        return reg?.active?.state === "activated";
      },
      undefined,
      { timeout: 20_000 },
    );
    // precache の完了と controller の取得を待つ。
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, {
      timeout: 20_000,
    });

    await context.setOffline(true);
    await page.reload();
    await expect(page.getByTestId("home-screen")).toBeVisible();
    await expect(page.getByTestId("daily-card")).toBeVisible();
    await context.setOffline(false);
  });

  test("manifest とアイコンが配信されている(docs/03 §8)", async ({ page, request }) => {
    await page.goto(PREVIEW_URL);
    const manifest = await request.get(`${PREVIEW_URL}/manifest.webmanifest`);
    expect(manifest.ok()).toBe(true);
    const json = (await manifest.json()) as {
      name: string;
      icons: Array<{ src: string; purpose?: string }>;
    };
    expect(json.name).toBe("HAMARU");
    expect(json.icons.some((i) => i.purpose === "maskable")).toBe(true);

    for (const icon of json.icons) {
      const res = await request.get(`${PREVIEW_URL}/${icon.src.replace(/^\//, "")}`);
      expect(res.ok(), `${icon.src} が配信されていません`).toBe(true);
    }
  });
});
