"use client";

import { useState } from "react";

import {
  useThemePreference,
  type ThemePreference,
} from "@/components/design-system/theme-provider";

import { MeSubpageHeader } from "./me-subpage-header";
import { ThemeSelector } from "./theme-selector";

/**
 * 主题页让 ThemeProvider 处理服务端保存与本地 Theme 切换的顺序；
 * 当前选择只会在请求成功后更新，从而避免本地视觉状态与服务端偏好脱节。
 */
export function ThemePage() {
  const { preference, updateThemePreference } = useThemePreference();
  const [selectedTheme, setSelectedTheme] =
    useState<ThemePreference>(preference);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const selectTheme = async (nextTheme: ThemePreference) => {
    if (submitting || nextTheme === selectedTheme) return;

    setSubmitting(true);
    setSaveError(null);
    try {
      await updateThemePreference(nextTheme);
      setSelectedTheme(nextTheme);
    } catch (reason) {
      setSaveError(
        reason instanceof Error
          ? reason.message
          : "主题偏好保存失败，请稍后重试。",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="pb-6">
      <MeSubpageHeader title="主题" />
      <div className="mx-auto mt-5 grid max-w-md gap-5">
        <ThemeSelector
          value={selectedTheme}
          onChange={(nextTheme) => void selectTheme(nextTheme)}
          disabled={submitting}
          describedBy={saveError ? "theme-error" : undefined}
        />
        {submitting ? (
          <p role="status" className="type-label text-muted-foreground">
            正在保存主题偏好…
          </p>
        ) : null}
        {saveError ? (
          <p
            id="theme-error"
            role="alert"
            className="type-label text-destructive"
          >
            {saveError}
          </p>
        ) : null}
      </div>
    </section>
  );
}
