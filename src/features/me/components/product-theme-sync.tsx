"use client";

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  useThemePreference,
  type ThemePreference,
} from "@/components/design-system/theme-provider";
import { getMeProfile } from "@/features/me/api";

interface ProductThemeSyncState {
  readonly loading: boolean;
  readonly preference: ThemePreference | null;
}

const ProductThemeSyncContext = createContext<ProductThemeSyncState | null>(
  null,
);

/**
 * 每次进入认证产品壳层都从账户资料恢复主题，覆盖其他设备或上一账户留下的本地值。
 * 卸载后忽略迟到响应，避免账户切换时旧资料污染新会话；失败时静默保留本地主题。
 */
export function ProductThemeSync({
  children,
}: {
  readonly children: ReactNode;
}) {
  const { applyThemePreference } = useThemePreference();
  const applyThemePreferenceRef = useRef(applyThemePreference);
  const [state, setState] = useState<ProductThemeSyncState>({
    loading: true,
    preference: null,
  });

  useEffect(() => {
    applyThemePreferenceRef.current = applyThemePreference;
  }, [applyThemePreference]);

  useEffect(() => {
    let active = true;

    void getMeProfile()
      .then((profile) => {
        if (!active) return;
        applyThemePreferenceRef.current(profile.themePreference);
        setState({ loading: false, preference: profile.themePreference });
      })
      .catch(() => {
        if (active) setState({ loading: false, preference: null });
      });

    return () => {
      active = false;
    };
  }, []);

  return (
    <ProductThemeSyncContext.Provider value={state}>
      {children}
    </ProductThemeSyncContext.Provider>
  );
}

/** 主题设置页消费壳层已经读取的偏好，避免再次请求或重复应用主题。 */
export function useProductThemeSync() {
  const state = useContext(ProductThemeSyncContext);
  if (!state) throw new Error("主题同步组件缺失，请检查产品布局。");
  return state;
}
