import Link from "next/link";

import { PageReveal } from "@/components/design-system/page-reveal";
import { AccountForm } from "@/features/auth/components/account-form";
import { normalizeInvitationCallbackURL } from "@/lib/invitation-return";

/** 独立登录页避免将受邀注册字段带入日常登录路径。 */
export default async function LoginPage({
  searchParams,
}: {
  readonly searchParams: Promise<{
    readonly callbackURL?: string | readonly string[];
  }>;
}) {
  const raw = (await searchParams).callbackURL;
  const callbackURL = normalizeInvitationCallbackURL(
    typeof raw === "string" ? raw : null,
  );
  const registerHref = callbackURL
    ? `/register?callbackURL=${encodeURIComponent(callbackURL)}`
    : "/register";
  return (
    <AccountPage
      title="登录"
      description={
        callbackURL ? "登录后将继续加入受邀活动" : "继续管理你的活动和账目"
      }
    >
      <AccountForm mode="login" callbackURL={callbackURL} />
      <Link
        className="mt-5 text-center text-sm text-primary"
        href={registerHref}
      >
        注册新账号
      </Link>
    </AccountPage>
  );
}

export function AccountPage({
  title,
  description,
  children,
}: {
  readonly title: string;
  readonly description: string;
  readonly children: React.ReactNode;
}) {
  return (
    <PageReveal className="mx-auto flex min-h-svh w-full max-w-md flex-col justify-center px-5 py-12 sm:px-8">
      <p className="text-sm font-semibold">伙记</p>
      <h1 className="mt-1 text-2xl font-bold">{title}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      {children}
    </PageReveal>
  );
}
