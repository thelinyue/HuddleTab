import { redirect } from "next/navigation";

import { AccountForm } from "@/features/auth/components/account-form";
import { AccountPage } from "@/features/auth/components/account-page";
import {
  invitationTokenFromCallbackURL,
  normalizeInvitationCallbackURL,
} from "@/lib/invitation-return";
import { isSetupRequired } from "@/server/services/setup-status-service";

/** 初始化状态来自请求时数据库，认证页不能在构建阶段预渲染。 */
export const dynamic = "force-dynamic";

/** 注册页保留邀请凭证入口，最终准入仍完全由服务端注册策略决定。 */
export default async function RegisterPage({
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
  const invitationProof = invitationTokenFromCallbackURL(callbackURL);
  const loginHref = callbackURL
    ? `/login?callbackURL=${encodeURIComponent(callbackURL)}`
    : "/login";
  return (
    <AccountPage
      title="注册"
      description={
        callbackURL
          ? "创建账号后将继续加入受邀活动"
          : "创建账号后即可加入和管理活动"
      }
      alternateAction={{
        label: "已有账号，登录",
        href: loginHref,
      }}
    >
      <AccountForm
        mode="register"
        callbackURL={callbackURL}
        invitationProof={invitationProof}
      />
    </AccountPage>
  );
}
