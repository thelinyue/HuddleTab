import { redirect } from "next/navigation";

import { AccountPage } from "@/features/auth/components/account-page";
import { AccountForm } from "@/features/auth/components/account-form";
import { normalizeInvitationCallbackURL } from "@/lib/invitation-return";
import { isSetupRequired } from "@/server/services/setup-status-service";

/** 初始化状态来自请求时数据库，认证页不能在构建阶段预渲染。 */
export const dynamic = "force-dynamic";

/** 独立登录页避免将受邀注册字段带入日常登录路径。 */
export default async function LoginPage({
  searchParams,
}: {
  readonly searchParams: Promise<{
    readonly callbackURL?: string | readonly string[];
  }>;
}) {
  /** 页面级守卫保护到达服务器的认证页请求；历史 HTML 由导航缓存边界负责隔离。 */
  if (await isSetupRequired()) redirect("/setup");

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
      alternateAction={{
        prompt: "还没有账号？",
        label: "注册新账号",
        href: registerHref,
      }}
    >
      <AccountForm mode="login" callbackURL={callbackURL} />
    </AccountPage>
  );
}
