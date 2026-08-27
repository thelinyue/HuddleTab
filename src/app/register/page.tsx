import Link from "next/link";

import { AccountForm } from "@/features/auth/components/account-form";
import { AccountPage } from "@/app/login/page";

/** 注册页保留邀请凭证入口，最终准入仍完全由服务端注册策略决定。 */
export default function RegisterPage() {
  return <AccountPage title="注册" description="创建账号后即可加入和管理活动"><AccountForm mode="register" /><Link className="mt-5 text-center text-sm text-primary" href="/login">已有账号，登录</Link></AccountPage>;
}
