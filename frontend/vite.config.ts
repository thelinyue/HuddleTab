import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    tailwindcss(),
    react(),
    VitePWA({
      registerType: "prompt",
      includeAssets: [
        "apple-touch-icon.png",
        "icons/icon-192.png",
        "icons/icon-512.png",
        "illustrations/activity-list-empty.webp",
        "activity-covers/*.webp",
        "member-avatars/*.webp",
      ],
      workbox: {
        // 默认封面和头像必须能在离线状态回退显示；生成插画单张可能超过 Workbox 默认 2 MiB 上限。
        maximumFileSizeToCacheInBytes: 12 * 1024 * 1024,
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api(?:\/|$)/],
        importScripts: ["/push-service-worker.js"],
        runtimeCaching: [],
      },
      manifest: {
        name: "HuddleTab / 伙记",
        short_name: "伙记",
        description: "一起花，清楚分。",
        theme_color: "#f6f8f7",
        background_color: "#f6f8f7",
        display: "standalone",
        id: "/",
        start_url: "/",
        icons: [
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
    }),
  ],
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          // 将首屏共享的 React 和动画依赖独立分包，保留业务懒加载及默认体积告警。
          // React 优先归组，动画包复用同一运行时；依赖递归收集沿用默认行为。
          groups: [
            {
              name: "react-vendor",
              test: /[\\/]node_modules[\\/](?:react|react-dom|scheduler)[\\/]/,
              priority: 20,
            },
            {
              name: "motion-vendor",
              test: /[\\/]node_modules[\\/](?:motion|motion-dom|motion-utils|framer-motion)[\\/]/,
              priority: 10,
            },
          ],
        },
      },
    },
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    proxy: { "/api": "http://127.0.0.1:5660" },
  },
  test: {
    environment: "jsdom",
    setupFiles: "./src/test/setup.ts",
    exclude: [...configDefaults.exclude, "e2e/**"],
  },
});
