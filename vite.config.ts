// vite.config.ts
import path from "path";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// shared/*.cjs (sunucuyla PAYLASILAN saf moduller, ör. surveyConditions.cjs) DEV sunucusunda:
// Vite dev, kaynak agacindaki CommonJS dosyalarini donusturmez ("module is not defined" +
// "does not provide an export named ...") — Self Servis sayfasi dev'de hic acilmiyordu
// (2026-09-21). Uretim build'i rollup commonjs ile zaten calisiyor. Bu eklenti YALNIZ serve
// modunda `module.exports = { a, b }` bicimindeki dosyayi ESM'e sarar: adlandirilmis
// export'lar module.exports'taki anahtarlardan uretilir (yalniz bu basit bicim desteklenir).
function sharedCjsDevShim() {
  return {
    name: "shared-cjs-dev-shim",
    apply: "serve" as const,
    transform(code: string, id: string) {
      if (!/[\\/]shared[\\/][^\\/]+\.cjs(\?.*)?$/.test(id)) return null;
      const m = /module\.exports\s*=\s*\{([\s\S]*?)\}\s*;?/.exec(code);
      if (!m) return null;
      const keys = m[1]
        .split(",")
        .map((k) => k.trim().split(":")[0].trim())
        .filter((k) => /^[A-Za-z_$][\w$]*$/.test(k));
      // Dosyanin kendi fonksiyon adlariyla CAKISMASIN: `export const a = ...` yerine `export { a }`
      // (module.exports = { a, b } zaten ust kapsamdaki a ve b'yi gosterir).
      const named = keys.length ? `export { ${keys.join(", ")} };` : "";
      const wrapped = `const module = { exports: {} }; const exports = module.exports;\n${code}\n${named}\nexport default module.exports;\n`;
      return { code: wrapped, map: null };
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