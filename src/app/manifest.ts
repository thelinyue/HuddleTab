import type { MetadataRoute } from "next";

/** PWA 安装信息与图标路径集中在此处，运行时不依赖任何设计生成工具。 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "伙记 HuddleTab",
    short_name: "伙记",
    description: "一起花，清楚分。",
    start_url: "/activities",
    scope: "/",
    display: "standalone",
    background_color: "#F8FAFC",
    theme_color: "#0F766E",
    lang: "zh-CN",
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
      },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
