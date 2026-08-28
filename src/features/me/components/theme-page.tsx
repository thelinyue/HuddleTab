"use client";

import { useEffect, useState } from "react";

import {
  useThemePreference,
  type ThemePreference,
} from "@/components/design-system/theme-provider";
import { getMeProfile } from "@/features/me/api";

import { MeSubpageHeader } from "./me-subpage-header";
import { ThemeSelector } from "./theme-selector";

/**
 * 主题页以认证资料中的服务端偏好作为初始值，并只在加载时同步本地显示；
 * 用户主动选择仍由 ThemeProvider 先持久化，成功后才切换本地主题和 radio。
 */
export function ThemePage() {
  const { preference, applyThemePreference, updateThemePreference } =
    useThemePreference();
  const [selectedTheme, setSelectedTheme] =
    useState<ThemePreference>(preference);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    void getMeProfile()
      .then((profile) => {
        setSelectedTheme(profile.themePreference);
        applyThemePreference(profile.themePreference);
      })
      .catch((reason: unknown) => {
        setLoadError(
          reason instanceof Error
            ? reason.message
            : "主题偏好加载失败，请稍后重试。",
        );
      })
      .finally(() => setLoading(false));
  }, [applyThemePreference]);

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
      {loadError ? (
        <p role="alert" className="py-8 text-destructive">
          {loadError}
        </p>
      ) : loading ? (
        <p role="status" className="py-8 text-muted-foreground">
          正在加载主题偏好…
        </p>
      ) : (
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
      )}
    </section>
  );
}
