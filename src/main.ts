// エントリポイント。UI は M3 で実装する(docs/07 §1)。
const app = document.querySelector<HTMLDivElement>("#app");
if (app) {
  app.textContent = "HAMARU";
}
