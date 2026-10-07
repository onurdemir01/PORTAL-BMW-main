// vite.config.ts
import path from "path";
import { createRequire } from "module";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// shared/*.cjs (sunucuyla PAYLASILAN saf moduller, ör. surveyConditions.cjs) DEV sunucusunda:
// Vite dev, kaynak agacindaki CommonJS dosyalarini donusturmez ("module is not defined" +
// "does not provide an export named ...") — Self Servis sayfasi dev'de hic acilmiyordu
// (2026-09-21). Uretim build'i rollup commonjs ile zaten calisiyor. Bu eklenti YALNIZ serve
// modunda dosyayi ESM'e sarar. Disa aktarilan adlar metinden TAHMIN EDILMEZ, modul
// gercekten yuklenip okunur (bkz. scripts/shared-cjs-shim.cjs — eski regex, bir yorumdaki
// `module.exports = { a, b }` ornegini gercek disa aktarim sanip Crypto Hub'i dev'de dusuruyordu).
const sharedCjs = createRequire(import.meta.url)("./scripts/shared-cjs-shim.cjs") as {
  exportKeys: (dosya: string) => string[] | null;
  wrapSharedCjs: (code: string, keys: string[]) => string;
};

function sharedCjsDevShim() {
  return {
    name: "shared-cjs-dev-shim",
    apply: "serve" as const,
    transform(code: string, id: string) {
      if (!/[\\/]shared[\\/][^\\/]+\.cjs(\?.*)?$/.test(id)) return null;
      const keys = sharedCjs.exportKeys(id.replace(/\?.*$/, ""));
      if (!keys) return null;
      return { code: sharedCjs.wrapSharedCjs(code, keys), map: null };
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ".", "");

  // Ters-proxy (ör. bmwv2.fw.garanti.com.tr, HTTPS) arkasında dev çalıştırıldığında Vite'ın
  // HMR WebSocket'i tarayıcıya YANLIŞ host/port/protokol verir → `wss://.../` bağlanamaz.
  // Bu değerler .env.local'dan set edilerek HMR'ın proxy üzerinden bağlanması sağlanır.
  // (Prod'da dev sunucusu KULLANILMAZ — `npm run build` + statik servis; bkz. docs.)
  //   VITE_HMR_HOST      = tarayıcının göreceği host (ör. bmwv2.fw.garanti.com.tr)
  //   VITE_HMR_PROTOCOL  = wss | ws  (HTTPS proxy arkasında wss)
  //   VITE_HMR_CLIENT_PORT = tarayıcının bağlanacağı port (ör. 443 — proxy portu)
  //   VITE_ALLOWED_HOSTS = virgülle ayrılmış izinli host'lar (ör. bmwv2.fw.garanti.com.tr)
  const hmrHost = env.VITE_HMR_HOST || "";
  const hmr = hmrHost
    ? {
        host: hmrHost,
        protocol: env.VITE_HMR_PROTOCOL || "wss",
        clientPort: env.VITE_HMR_CLIENT_PORT ? Number(env.VITE_HMR_CLIENT_PORT) : 443,
      }
    : undefined; // set edilmezse Vite varsayılanı (localhost) — yerel geliştirme bozulmaz
  const allowedHosts = (env.VITE_ALLOWED_HOSTS || "")
    .split(",").map((h) => h.trim()).filter(Boolean);

  return {
    server: {
      port: 3000,
      host: "0.0.0.0",
      // Proxy arkasında host-başlığı reddini önler (Vite 5+ host doğrulaması).
      ...(allowedHosts.length ? { allowedHosts } : {}),
      // HMR: yalnızca VITE_HMR_HOST verilmişse override edilir (proxy senaryosu).
      ...(hmr ? { hmr } : {}),
      // Tarayıcıya verilen mutlak asset origin'i (proxy arkasında tutarlılık için).
      ...(env.VITE_ORIGIN ? { origin: env.VITE_ORIGIN } : {}),
      watch: {
        ignored: ["**/server/data/**"],
      },
      proxy: {
        "/api": {
          target: "http://localhost:5055",
          changeOrigin: true,
          secure: false,
        },
      },
    },
    plugins: [react(), tailwindcss(), sharedCjsDevShim()],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "src"),
      },
    },
  };
});