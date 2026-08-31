import { defineConfig } from "vite";
import { resolve } from "path";

export default defineConfig({
  // 相對路徑:GitHub Pages 部署在 /<repo>/ 子路徑下也能正常載入資源
  base: "./",
  build: {
    rollupOptions: {
      // 多頁面應用:村莊/整備/探索/戰鬥各是獨立頁面,共用 localStorage
      input: {
        village: resolve(__dirname, "village.html"),
        prep: resolve(__dirname, "prep.html"),
        explore: resolve(__dirname, "explore.html"),
        combat: resolve(__dirname, "index.html"),
      },
    },
  },
});
