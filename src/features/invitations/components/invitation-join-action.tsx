"use client";

import {
  ArrowRightIcon,
  CircleAlertIcon,
  Clock3Icon,
  LoaderCircleIcon,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { type ReactNode, useState } from "react";

import { Button } from "@/components/ui/button";

type InviteMode = "DIRECT_JOIN" | "REQUIRE_APPROVAL";
type ViewerState = "ANONYMOUS" | "CAN_JOIN" | "PENDING_APPROVAL" | "MEMBER";

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

type JoinResponse = {
  readonly data?: JoinResult;
  readonly error?: {
    readonly code?: string;
    readonly message?: string;
  };
};

/**
 * 客户端边界只拥有 CTA 和提交后的瞬时状态。服务端预览作为 ReactNode 传入，
 * 不会因为按钮交互而在浏览器中重复拼装活动上下文。
 */
export function InvitationJoinAction({
  activityId,
  content,
  inviteMode,
  inviteToken,
  securityNotice,
  viewerState,
}: {
  readonly activityId?: string;
  readonly content: ReactNode;
  readonly inviteMode: InviteMode;
  readonly inviteToken: string;
  readonly securityNotice: ReactNode;
  readonly viewerState: ViewerState;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [submittedForApproval, setSubmittedForApproval] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fatalError, setFatalError] = useState<string | null>(null);

  if (fatalError) {
    return <InvalidInvitation message={fatalError} />;
  }

  const callbackURL = `/join/${inviteToken}`;
  const pendingApproval =
    viewerState === "PENDING_APPROVAL" || submittedForApproval;
  const requiresApproval = inviteMode === "REQUIRE_APPROVAL";

  async function submitInvitation() {
    if (submitting) return;

    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/invitations/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inviteProof: inviteToken }),
      });
      const body = (await response.json().catch(() => undefined)) as
        JoinResponse | undefined;

      if (response.status === 401) {
        window.location.assign(
          new URL(
            `/login?callbackURL=${encodeURIComponent(callbackURL)}`,
            window.location.origin,
          ).toString(),
        );
        return;
      }

      if (!response.ok || !body?.data) {
        const message =
          body?.error?.message ?? "加入活动失败，请检查网络后重试。";
        if (body?.error?.code === "INVALID_INVITATION") {
          setFatalError(message);
        } else {
          setError(message);
        }
        return;
      }

      if (body.data.status === "PENDING_APPROVAL") {
        setSubmittedForApproval(true);
        return;
      }

      window.location.replace(
        new URL(
          `/activities/${body.data.activityId}`,
          window.location.origin,
        ).toString(),
      );
    } catch {
      setError("加入活动失败，请检查网络后重试。");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="mx-auto min-h-dvh w-full max-w-[680px] px-4 py-4 sm:px-6 sm:py-8">
      <article className="overflow-hidden rounded-lg border border-border/80 bg-surface shadow-sm">
        {content}
        <section className="px-5 pt-8 pb-7 sm:px-8 sm:pb-8" aria-live="polite">
          {pendingApproval ? (
            <PendingApproval />
          ) : viewerState === "MEMBER" && activityId ? (
            <Button asChild className="w-full" size="lg">
              <Link href={`/activities/${activityId}`}>
                进入活动
                <ArrowRightIcon aria-hidden="true" data-icon="inline-end" />
              </Link>
            </Button>
          ) : viewerState === "ANONYMOUS" ? (
            <AnonymousActions
              callbackURL={callbackURL}
              requiresApproval={requiresApproval}
            />
          ) : (
            <>
              {error ? (
                <p
                  className="mb-3 rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive"
                  role="alert"
                >
                  {error}
                </p>
              ) : null}
              <Button
                aria-busy={submitting}
                className="w-full"
                disabled={submitting}
                onClick={() => void submitInvitation()}
                size="lg"
                type="button"
              >
                {submitting ? (
                  <LoaderCircleIcon
                    aria-hidden="true"
                    className="animate-spin motion-reduce:animate-none"
                    data-icon="inline-start"
                  />
                ) : null}
                {submitting
                  ? requiresApproval
                    ? "正在申请"
                    : "正在加入"
                  : requiresApproval
                    ? "申请加入"
                    : "加入活动"}
              </Button>
            </>
          )}
        </section>
      </article>

      {securityNotice}
    </main>
  );
}

function AnonymousActions({
  callbackURL,
  requiresApproval,
}: {
  readonly callbackURL: string;
  readonly requiresApproval: boolean;
}) {
  return (
    <div className="space-y-3">
      <Button asChild className="w-full" size="lg">
        <Link href={`/register?callbackURL=${encodeURIComponent(callbackURL)}`}>
          {requiresApproval ? "注册并申请加入" : "注册并加入"}
          <ArrowRightIcon aria-hidden="true" data-icon="inline-end" />
        </Link>
      </Button>
      <Link
        className="inline-flex min-h-11 w-full items-center justify-center text-sm font-medium text-primary hover:underline"
        href={`/login?callbackURL=${encodeURIComponent(callbackURL)}`}
      >
        已有账号？登录
      </Link>
    </div>
  );
}

function PendingApproval() {
  return (
    <div className="text-center">
      <Clock3Icon aria-hidden="true" className="mx-auto size-8 text-primary" />
      <h2 className="mt-3 text-lg font-semibold">申请已提交</h2>
      <p className="mt-1 text-sm text-muted-foreground">等待活动管理员审批。</p>
      <Button asChild className="mt-5 w-full" size="lg" variant="outline">
        <Link href="/activities">返回活动列表</Link>
      </Button>
    </div>
  );
}

function InvalidInvitation({ message }: { readonly message: string }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[680px] items-center px-4 py-8 sm:px-6">
      <section className="w-full overflow-hidden rounded-lg border border-border/80 bg-surface shadow-sm">
        <div className="flex min-h-16 items-center gap-3 px-5 sm:px-8">
          <Image
            alt=""
            className="size-8 rounded-md object-cover"
            height={32}
            src="/icons/icon-192.png"
            width={32}
          />
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
            <span className="text-base font-semibold text-brand">伙记</span>
            <span className="text-xs text-muted-foreground">HuddleTab</span>
          </div>
        </div>
        <div className="border-t border-border px-5 py-12 text-center sm:px-8 sm:py-16">
          <span className="mx-auto flex size-12 items-center justify-center rounded-lg bg-destructive/10 text-destructive">
            <CircleAlertIcon aria-hidden="true" className="size-6" />
          </span>
          <h1 className="mt-5 text-xl font-semibold">无法加入活动</h1>
          <p
            className="mx-auto mt-2 max-w-md text-sm leading-6 text-destructive"
            role="alert"
          >
            {message}
          </p>
        </div>
      </section>
    </main>
  );
}
