import Link from "next/link";

import { AccountForm } from "@/features/auth/components/account-form";

/** 独立登录页避免将受邀注册字段带入日常登录路径。 */
export default function LoginPage() {
  return <AccountPage title="登录" description="继续管理你的活动和账目"><AccountForm mode="login" /><Link className="mt-5 text-center text-sm text-primary" href="/register">注册新账号</Link></AccountPage>;
}

export function AccountPage({ title, description, children }: { readonly title: string; readonly description: string; readonly children: React.ReactNode }) {
  return <main className="mx-auto flex min-h-svh w-full max-w-md flex-col justify-center px-5 py-12 sm:px-8"><p className="text-sm font-semibold">伙记</p><h1 className="mt-1 text-2xl font-bold">{title}</h1><p className="mt-1 text-sm text-muted-foreground">{description}</p>{children}</main>;
}
