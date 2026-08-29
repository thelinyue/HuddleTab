import type { MetadataRoute } from "next";

/**
 * PWA 清单：声明应用名称、主题色和可安装场景使用的多尺寸图标。
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "伙记",
    short_name: "伙记",
    description: "一起花，清楚分。",
    start_url: "/",
    display: "standalone",
    background_color: "#F6F8F7",
    theme_color: "#F6F8F7",
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
    ],
  };
}
