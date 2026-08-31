import {
  ChartNoAxesColumnIncreasingIcon,
  CheckCircle2Icon,
  CircleAlertIcon,
  ReceiptTextIcon,
  ShieldCheckIcon,
  UserRoundIcon,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import Image from "next/image";

import { InvitationJoinAction } from "./invitation-join-action";

type InviteMode = "DIRECT_JOIN" | "REQUIRE_APPROVAL";

type InvitationLandingBase = {
  readonly activityName: string;
  readonly activeMemberCount: number;
  readonly inviteMode: InviteMode;
  readonly inviterName: string;
};

/**
 * 匿名和非成员预览不携带活动 ID；只有服务端确认已是成员时，客户端才拿到
 * 可直接进入的活动地址，避免公开邀请页把内部标识暴露给未认证访问者。
 */
export type InvitationLandingData = InvitationLandingBase &
  (
    | {
        readonly viewerState: "ANONYMOUS" | "CAN_JOIN" | "PENDING_APPROVAL";
        readonly activityId?: never;
      }
    | {
        readonly viewerState: "MEMBER";
        readonly activityId: string;
      }
  );

const capabilities: ReadonlyArray<{
  readonly icon: LucideIcon;
  readonly title: string;
  readonly description: string;
}> = [
  {
    icon: ReceiptTextIcon,
    title: "记录消费",
    description: "多人共同记录每一笔支出",
  },
  {
    icon: ChartNoAxesColumnIncreasingIcon,
    title: "查看账单",
    description: "随时了解每个人的收支",
  },
  {
    icon: CheckCircle2Icon,
    title: "完成结算",
    description: "清楚确认最终结算结果",
  },
];

const invalidInvitationMessage =
  "邀请链接无效或已失效，请联系邀请人获取新链接。";

/**
 * 活动、邀请人和能力说明由 Server Component 输出；只有末尾操作区进入客户端，
 * 因而认证回跳能得到实时预览，也不会为静态上下文增加不必要的客户端逻辑。
 */
export function InvitationJoin({
  inviteToken,
  landing,
}: {
  readonly inviteToken: string;
  readonly landing: InvitationLandingData | null;
}) {
  if (!landing) {
    return <InvalidInvitation message={invalidInvitationMessage} />;
  }

  return (
    <InvitationJoinAction
      activityId={
        landing.viewerState === "MEMBER" ? landing.activityId : undefined
      }
      content={<InvitationContent landing={landing} />}
      inviteMode={landing.inviteMode}
      inviteToken={inviteToken}
      securityNotice={<SecurityNotice />}
      viewerState={landing.viewerState}
    />
  );
}

function InvitationContent({
  landing,
}: {
  readonly landing: InvitationLandingData;
}) {
  const requiresApproval = landing.inviteMode === "REQUIRE_APPROVAL";

  return (
    <>
      <BrandHeader />

      <div className="relative aspect-[950/560] overflow-hidden bg-muted">
        <Image
          alt=""
          className="object-cover"
          fill
          preload
          sizes="(max-width: 695px) calc(100vw - 32px), 632px"
          src="/auth/auth-hero.webp"
        />
        <div
          aria-hidden="true"
          className="absolute inset-0 hidden bg-background/20 dark:block"
        />
      </div>

      <div className="px-5 pt-7 sm:px-8 sm:pt-8">
        <header className="text-center">
          <p className="text-sm font-medium text-muted-foreground">
            你被邀请加入
          </p>
          <h1 className="mt-2 text-2xl leading-8 font-bold text-balance sm:text-3xl sm:leading-10">
            {landing.activityName}
          </h1>
          <p className="mx-auto mt-3 inline-flex min-h-8 items-center rounded-full bg-accent px-3 text-sm font-medium text-accent-foreground">
            {landing.activeMemberCount} 人 · 进行中
          </p>
        </header>

        <section
          aria-labelledby="inviter-heading"
          className="mt-7 border-y border-border py-5"
        >
          <div className="flex items-center gap-3">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-secondary text-primary">
              <UserRoundIcon aria-hidden="true" className="size-5" />
            </span>
            <div className="min-w-0">
              <h2
                className="text-xs font-medium text-muted-foreground"
                id="inviter-heading"
              >
                邀请人
              </h2>
              <p className="mt-0.5 break-words text-base font-semibold">
                {landing.inviterName}
              </p>
            </div>
          </div>
          <p className="mt-4 text-sm leading-6 text-muted-foreground">
            {requiresApproval
              ? "提交申请并通过审批后，就可以一起记录消费、查看账单和完成结算。"
              : "加入后可以一起记录消费、查看账单和完成结算。"}
          </p>
        </section>

        <section aria-labelledby="capabilities-heading" className="mt-7">
          <h2 className="text-base font-semibold" id="capabilities-heading">
            加入后可以
          </h2>
          <ul className="mt-4 grid gap-4 sm:grid-cols-3">
            {capabilities.map(({ icon: Icon, title, description }) => (
              <li
                className="flex min-w-0 items-start gap-3 sm:block"
                key={title}
              >
                <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-secondary text-primary sm:mb-3">
                  <Icon aria-hidden="true" className="size-5" />
                </span>
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold">{title}</h3>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    {description}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </>
  );
}

function BrandHeader() {
  return (
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
  );
}

function InvalidInvitation({ message }: { readonly message: string }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[680px] items-center px-4 py-8 sm:px-6">
      <section className="w-full overflow-hidden rounded-lg border border-border/80 bg-surface shadow-sm">
        <BrandHeader />
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

function SecurityNotice() {
  return (
    <footer className="mx-auto flex max-w-md items-start justify-center gap-3 px-4 py-6 text-muted-foreground">
      <ShieldCheckIcon
        aria-hidden="true"
        className="mt-0.5 size-5 shrink-0 text-primary"
      />
      <div>
        <p className="text-sm font-medium text-foreground">信息安全有保障</p>
        <p className="mt-0.5 text-xs leading-5">
          邀请凭证和账户信息仅用于确认本次活动加入请求。
        </p>
      </div>
    </footer>
  );
}
