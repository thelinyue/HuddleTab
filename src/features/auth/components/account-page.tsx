import { ArrowRight } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";

/**
 * 登录与注册共用的公开认证页壳。顶部插画负责建立产品场景，表单面板只承载
 * 真实可完成的认证操作，并在窄屏与宽屏保持同一条单列信息路径。
 */
export function AccountPage({
  title,
  description,
  children,
  alternateAction,
}: {
  readonly title: string;
  readonly description: string;
  readonly children: ReactNode;
  readonly alternateAction: {
    readonly prompt?: string;
    readonly label: string;
    readonly href: string;
  };
}) {
  return (
    <main className="mx-auto min-h-dvh w-full max-w-[672px] bg-background px-4 py-4 sm:px-6 sm:py-8">
      <div className="mx-auto w-full max-w-[640px] overflow-hidden rounded-lg border border-border/80 bg-surface shadow-sm">
        <div className="relative aspect-[950/625] overflow-hidden bg-muted">
          <Image
            alt=""
            className="object-cover"
            fill
            preload
            sizes="(max-width: 687px) calc(100vw - 32px), 640px"
            src="/auth/auth-hero.webp"
          />
          <div
            aria-hidden="true"
            className="absolute inset-0 hidden bg-background/20 dark:block"
          />
        </div>

        <section className="relative z-10 -mt-6 rounded-t-lg bg-surface px-5 pt-5 pb-6 shadow-overlay sm:-mt-8 sm:px-8 sm:pt-7 sm:pb-8">
          <div className="flex items-center gap-4">
            <Image
              alt=""
              className="size-16 shrink-0 rounded-lg object-cover"
              height={64}
              src="/icons/icon-192.png"
              width={64}
            />
            <div className="min-w-0">
              <p className="text-2xl leading-8 font-semibold text-brand">
                伙记
              </p>
              <p className="text-sm text-muted-foreground">HuddleTab</p>
            </div>
          </div>

          <h1 className="mt-7 text-2xl leading-8 font-bold">{title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
          {children}

          <div className="mt-7 flex items-center gap-3">
            <span
              aria-hidden="true"
              className="h-px min-w-4 flex-1 bg-border"
            />
            <div className="flex flex-wrap items-center justify-center gap-x-2 text-sm">
              {alternateAction.prompt ? (
                <span className="text-muted-foreground">
                  {alternateAction.prompt}
                </span>
              ) : null}
              <Link
                className="inline-flex min-h-11 items-center gap-1 font-medium text-primary hover:underline"
                href={alternateAction.href}
              >
                {alternateAction.label}
                <ArrowRight className="size-4" aria-hidden="true" />
              </Link>
            </div>
            <span
              aria-hidden="true"
              className="h-px min-w-4 flex-1 bg-border"
            />
          </div>
        </section>
      </div>
    </main>
  );
}
