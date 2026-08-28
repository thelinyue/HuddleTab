"use client";

import {
  CircleAlertIcon,
  LoaderCircleIcon,
  UserRoundCheckIcon,
} from "lucide-react";
import { useEffect, useState } from "react";

type JoinResult =
  | {
      readonly status: "JOINED" | "ALREADY_MEMBER";
      readonly activityId: string;
      readonly memberId: string;
    }
  | {
      readonly status: "PENDING_APPROVAL";
      readonly activityId: string;
      readonly requestId: string;
    };

/** 邀请页只负责恢复流程；是否能加入完全由 token-only API 的事务结果决定。 */
export function InvitationJoin({
  inviteToken,
}: {
  readonly inviteToken: string;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/invitations/join", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ inviteProof: inviteToken }),
      signal: controller.signal,
    })
      .then(async (response) => {
        const body = (await response.json().catch(() => undefined)) as
          | {
              readonly data?: JoinResult;
              readonly error?: { readonly message?: string };
            }
          | undefined;
        if (response.status === 401) {
          const callbackURL = `/join/${inviteToken}`;
          window.location.assign(
            new URL(
              `/login?callbackURL=${encodeURIComponent(callbackURL)}`,
              window.location.origin,
            ).toString(),
          );
          return;
        }
        if (!response.ok || !body?.data) {
          throw new Error(
            body?.error?.message ?? "邀请链接无法使用，请稍后重试。",
          );
        }
        if (body.data.status === "PENDING_APPROVAL") {
          setPending(true);
          return;
        }
        window.location.replace(
          new URL(
            `/activities/${body.data.activityId}`,
            window.location.origin,
          ).toString(),
        );
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        setError(
          reason instanceof Error
            ? reason.message
            : "邀请链接无法使用，请稍后重试。",
        );
      });
    return () => controller.abort();
  }, [inviteToken]);

  if (error) {
    return (
      <InvitationState icon={CircleAlertIcon} title="无法加入活动">
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      </InvitationState>
    );
  }
  if (pending) {
    return (
      <InvitationState icon={UserRoundCheckIcon} title="等待审批">
        <p className="text-sm text-muted-foreground">
          管理员通过后，你会在通知中收到结果。
        </p>
      </InvitationState>
    );
  }
  return (
    <InvitationState icon={LoaderCircleIcon} title="正在验证邀请" spinning>
      <p role="status" className="text-sm text-muted-foreground">
        正在确认登录状态和活动邀请…
      </p>
    </InvitationState>
  );
}

function InvitationState({
  icon: Icon,
  title,
  spinning = false,
  children,
}: {
  readonly icon: typeof CircleAlertIcon;
  readonly title: string;
  readonly spinning?: boolean;
  readonly children: React.ReactNode;
}) {
  return (
    <main className="mx-auto flex min-h-svh w-full max-w-md flex-col items-center justify-center px-5 py-12 text-center">
      <Icon
        aria-hidden="true"
        className={`mb-4 size-10 text-primary ${spinning ? "animate-spin motion-reduce:animate-none" : ""}`}
      />
      <h1 className="text-xl font-semibold">{title}</h1>
      <div className="mt-2">{children}</div>
    </main>
  );
}
