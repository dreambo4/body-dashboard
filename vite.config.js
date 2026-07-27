import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// 產物輸出到 public/daily/，與 public/inbody.html 併成同一個 Hosting 站台。
// base 設為 /daily/ 讓打包後的 assets 路徑正確指向子目錄。
export default defineConfig({
  plugins: [react()],
  base: "/daily/",
  // outDir 位於 public/ 之下，必須關閉 Vite 的 publicDir，
  // 否則 Vite 會把 public/ 視為靜態資源來源而重複複製。
  publicDir: false,
  build: {
    outDir: "public/daily",
    emptyOutDir: true,
    rollupOptions: {
      output: {
        // 拆出體積大的第三方套件，讓瀏覽器能分別快取。
        // react 不另外拆：recharts 會將其一併內聯，單獨拆會產生空 chunk。
        manualChunks: {
          recharts: ["recharts", "react", "react-dom"],
          xlsx: ["xlsx"],
        },
      },
    },
  },
});
