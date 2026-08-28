import { defineConfig, globalIgnores } from "eslint/config";
import nextTypeScript from "eslint-config-next/typescript";
import nextVitals from "eslint-config-next/core-web-vitals";

export default defineConfig([
  ...nextVitals,
  ...nextTypeScript,
  globalIgnores([
    ".next/**",
    ".worktrees/**",
    "coverage/**",
    "playwright-report/**",
    "test-results/**",
    "artifacts/**",
    // Serwist 在构建时生成压缩的第三方 Service Worker，不能作为项目源代码执行 ESLint。
    "public/sw.js",
  ]),
]);
