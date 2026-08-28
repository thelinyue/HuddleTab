"use client";

import {
  ThemeProvider as NextThemesProvider,
  useTheme,
} from "next-themes";
import { useCallback, type ReactNode } from "react";

export type ThemePreference = "SYSTEM" | "LIGHT" | "DARK";

const themeName: Record<ThemePreference, "system" | "light" | "dark"> = {
  SYSTEM: "system",
  LIGHT: "light",
  DARK: "dark",
};

/**
 * 主题边界统一 Next Themes 的首屏脚本与本地系统主题监听。用户主动切换时先成功写入
 * 已认证资料，再更新本地主题，避免页面显示与服务器偏好不一致。
 */
export function ThemeProvider({ children }: { readonly children: ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  );
}

/** 主题选择器只依赖此 Hook，不直接耦合存储键或 `/api/me/theme` HTTP 细节。 */
export function useThemePreference() {
  const { theme, setTheme } = useTheme();
  const preference: ThemePreference =
    theme === "dark" ? "DARK" : theme === "light" ? "LIGHT" : "SYSTEM";

  /** 已从认证资料读取偏好时只同步本地显示，避免初始化重复写入服务端。 */
  const applyThemePreference = useCallback(
    (nextPreference: ThemePreference) => {
      setTheme(themeName[nextPreference]);
    },
    [setTheme],
  );

  async function updateThemePreference(nextPreference: ThemePreference) {
    const response = await fetch("/api/me/theme", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ theme: nextPreference }),
    });
    if (!response.ok) throw new Error("主题偏好保存失败，请稍后重试。");
    applyThemePreference(nextPreference);
  }

  return { preference, applyThemePreference, updateThemePreference } as const;
}
