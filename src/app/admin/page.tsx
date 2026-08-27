import Link from "next/link";
import { AppFrame } from "@/components/design-system/app-frame";

/** 系统管理首页只是受服务端守卫 API 支撑的导航，不赋予任何活动访问权。 */
export default function AdminPage() {
  return <AppFrame wide><section className="py-5"><h1 className="text-2xl font-bold">系统管理</h1><div className="mt-6 divide-y border-y"><Link href="/admin/users" className="flex min-h-12 items-center">用户管理</Link><Link href="/admin/settings" className="flex min-h-12 items-center">系统设置</Link><Link href="/admin/backups" className="flex min-h-12 items-center">备份与恢复</Link><Link href="/admin/system" className="flex min-h-12 items-center">系统信息</Link></div></section></AppFrame>;
}
