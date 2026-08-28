import { AccountForm } from "@/features/auth/components/account-form";
import { AccountPage } from "@/features/auth/components/account-page";
import {
  invitationTokenFromCallbackURL,
  normalizeInvitationCallbackURL,
} from "@/lib/invitation-return";

/** 注册页保留邀请凭证入口，最终准入仍完全由服务端注册策略决定。 */
export default async function RegisterPage({
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
