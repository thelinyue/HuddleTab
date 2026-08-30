import type { NextConfig } from "next";
import withSerwistInit from "@serwist/next";

const isDevelopment = process.env.NODE_ENV === "development";
/** Next.js 开发态 Webpack 需要 unsafe-eval；生产态保持严格脚本策略。 */
const scriptSource = isDevelopment
  ? "'self' 'unsafe-inline' 'unsafe-eval'"
  : "'self' 'unsafe-inline'";
const contentSecurityPolicy = `default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; img-src 'self' data: blob:; script-src ${scriptSource}; style-src 'self' 'unsafe-inline'; connect-src 'self'; font-src 'self' data:; manifest-src 'self'; worker-src 'self' blob:`;

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "Content-Security-Policy",
            value: contentSecurityPolicy,
          },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          {
            key: "Permissions-Policy",
            value:
              "camera=(), geolocation=(), microphone=(), payment=(), usb=()",
          },
        ],
      },
      {
        source: "/sw.js",
        headers: [
          {
            key: "Cache-Control",
            value: "no-cache, no-store, must-revalidate",
          },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
    ];
  },
};

/** 开发态禁用 Serwist，生产态由更新提示显式控制 waiting worker 的激活。 */
export default withSerwistInit({
  swSrc: "src/app/sw.ts",
  swDest: "public/sw.js",
  disable: process.env.NODE_ENV !== "production",
  register: true,
  cacheOnNavigation: false,
  reloadOnOnline: false,
})(nextConfig);
