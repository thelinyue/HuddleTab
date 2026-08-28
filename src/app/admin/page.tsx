import {
  ArchiveRestoreIcon,
  ChevronRightIcon,
  MonitorCogIcon,
  SlidersHorizontalIcon,
  UsersRoundIcon,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";

import { AppFrame } from "@/components/design-system/app-frame";
import { MeSubpageHeader } from "@/features/me/components/me-subpage-header";

const adminEntries = [
  {
    href: "/admin/users",
    label: "用户管理",
    description: "管理用户状态与系统管理员权限",
    Icon: UsersRoundIcon,
  },
  {
    href: "/admin/settings",
    label: "系统设置",
    description: "注册策略与服务运行设置",
    Icon: SlidersHorizontalIcon,
  },
  {
    href: "/admin/backups",
    label: "备份与恢复",
    description: "创建、查看与恢复系统备份",
    Icon: ArchiveRestoreIcon,
  },
  {
    href: "/admin/system",
    label: "系统信息",
    description: "查看运行环境与系统状态",
    Icon: MonitorCogIcon,
  },
] as const satisfies readonly {
  readonly href: string;
  readonly label: string;
  readonly description: string;
  readonly Icon: LucideIcon;
}[];

/**
 * 系统管理首页仅映射已经实现并受服务端守卫保护的四个页面。
 * SMTP 等能力归属系统设置，避免首页展示不存在的独立入口。
 */
export default function AdminPage() {
  return (
    <AppFrame wide>
      <section className="py-2">
        <MeSubpageHeader title="系统管理" />
        <div className="mt-4 divide-y overflow-hidden rounded-lg border bg-surface">
          {adminEntries.map(({ href, label, description, Icon }) => (
            <Link
              key={href}
              href={href}
              aria-label={label}
              className="flex min-h-14 items-center gap-3 px-3 py-2 text-foreground transition-colors hover:bg-muted/45 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-ring/50"
            >
              <span
                aria-hidden="true"
                className="flex size-10 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary"
              >
                <Icon className="size-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="type-body block font-medium">{label}</span>
                <span className="type-caption mt-0.5 block truncate text-muted-foreground">
                  {description}
                </span>
              </span>
              <ChevronRightIcon
                aria-hidden="true"
                className="size-4 shrink-0 text-muted-foreground"
              />
            </Link>
          ))}
        </div>
      </section>
    </AppFrame>
  );
}
