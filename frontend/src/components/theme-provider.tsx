import { createContext, useCallback, useContext, useEffect, useMemo, useState, type PropsWithChildren } from "react";

export type ThemePreference = "SYSTEM" | "LIGHT" | "DARK";
export type ResolvedTheme = "light" | "dark";

const STORAGE_KEY = "huddletab-theme";
const LIGHT_THEME_COLOR = "#f6f8f7";
const DARK_THEME_COLOR = "#0d1512";

function preferenceFromStoredValue(value: string | null): ThemePreference {
  if (value === "dark" || value === "DARK") return "DARK";
  if (value === "light" || value === "LIGHT") return "LIGHT";
  return "SYSTEM";
}

export function readThemePreference(): ThemePreference {
  if (typeof window === "undefined") return "SYSTEM";
  try {
    return preferenceFromStoredValue(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return "SYSTEM";
  }
}

function systemTheme(): ResolvedTheme {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

export function resolveTheme(preference: ThemePreference): ResolvedTheme {
  return preference === "DARK" ? "dark" : preference === "LIGHT" ? "light" : systemTheme();
}

function updateThemeColor(theme: ResolvedTheme) {
  if (typeof document === "undefined") return;
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  meta?.setAttribute("content", theme === "dark" ? DARK_THEME_COLOR : LIGHT_THEME_COLOR);
}

/** 在 React 首屏前同步根节点主题，并让独立 PWA 的系统栏跟随实际明暗背景。 */
export function applyThemePreference(preference: ThemePreference, transition = false) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (transition) root.classList.add("theme-transition");
  root.classList.toggle("light", preference === "LIGHT");
  root.classList.toggle("dark", preference === "DARK");
  root.dataset.themePreference = preference;
  updateThemeColor(resolveTheme(preference));
  if (transition) {
    window.setTimeout(() => root.classList.remove("theme-transition"), 180);
  }
}

function persistThemePreference(preference: ThemePreference) {
  try {
    window.localStorage.setItem(STORAGE_KEY, preference.toLowerCase());
  } catch {
    // 隐私模式禁用 localStorage 时仍允许本次页面切换主题。
  }
}

type ThemeContextValue = {
  preference: ThemePreference;
  resolvedTheme: ResolvedTheme;
  setPreference: (preference: ThemePreference) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

/** 主题状态只属于当前设备；服务端 Session 不参与主题选择或恢复。 */
export function ThemeProvider({ children }: PropsWithChildren) {
  const [preference, setPreferenceState] = useState<ThemePreference>(() => readThemePreference());
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() => resolveTheme(preference));

  const syncSystemTheme = useCallback(() => {
    const next = resolveTheme(preference);
    setResolvedTheme(next);
    if (preference === "SYSTEM") applyThemePreference(preference);
  }, [preference]);

  useEffect(() => {
    applyThemePreference(preference);
    setResolvedTheme(resolveTheme(preference));
    if (preference !== "SYSTEM" || typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    if (typeof media.addEventListener === "function") {
      media.addEventListener("change", syncSystemTheme);
      return () => media.removeEventListener("change", syncSystemTheme);
    }
    media.addListener?.(syncSystemTheme);
    return () => media.removeListener?.(syncSystemTheme);
  }, [preference, syncSystemTheme]);

  const setPreference = useCallback((nextPreference: ThemePreference) => {
    persistThemePreference(nextPreference);
    setPreferenceState(nextPreference);
    applyThemePreference(nextPreference, true);
    setResolvedTheme(resolveTheme(nextPreference));
  }, []);

  const value = useMemo(() => ({ preference, resolvedTheme, setPreference }), [preference, resolvedTheme, setPreference]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useThemePreference(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (!value) throw new Error("useThemePreference 必须在 ThemeProvider 中使用。");
  return value;
}
