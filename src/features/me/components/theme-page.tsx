"use client";

import { useState } from "react";

import {
  useThemePreference,
  type ThemePreference,
} from "@/components/design-system/theme-provider";

import { MeSubpageHeader } from "./me-subpage-header";
import { useProductThemeSync } from "./product-theme-sync";
import { ThemeSelector } from "./theme-selector";

/**
 * 主题页复用认证产品壳层已经读取并应用的服务端偏好；用户主动选择仍由
 * ThemeProvider 先持久化，成功后才切换本地主题和 radio。
 */
export function ThemePage() {
  const {
    loading,
    preference: syncedPreference,
    commitPreference,
  } = useProductThemeSync();

  return (
    <section className="pb-6">
      <MeSubpageHeader title="主题" />
      {loading ? (
        <p role="status" className="py-8 text-muted-foreground">
          正在加载主题偏好…
        </p>
      ) : (
        <ThemeSettings
          syncedPreference={syncedPreference}
          commitPreference={commitPreference}
        />
      )}
    </section>
  );
}

function ThemeSettings({
  syncedPreference,
  commitPreference,
}: {
  readonly syncedPreference: ThemePreference | null;
  readonly commitPreference: (preference: ThemePreference) => void;
}) {
  const { preference, updateThemePreference } = useThemePreference();
  const [selectedTheme, setSelectedTheme] = useState<ThemePreference>(
    syncedPreference ?? preference,
  );
  const [saveError, setSaveError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const selectTheme = async (nextTheme: ThemePreference) => {
    if (submitting || nextTheme === selectedTheme) return;

    setSubmitting(true);
    setSaveError(null);
    try {
      await updateThemePreference(nextTheme);
      commitPreference(nextTheme);
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
  );
}
