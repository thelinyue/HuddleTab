"use client";

import { useEffect, useState } from "react";
import { AppFrame } from "@/components/design-system/app-frame";

type UserRow = { readonly id: string; readonly nickname: string; readonly username: string; readonly disabled: boolean; readonly isSystemAdmin: boolean };

/** 用户管理仅发出明确命令；最后管理员与禁用后的 Session 撤销始终由服务事务执行。 */
export default function AdminUsersPage() {
  const [users, setUsers] = useState<readonly UserRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = () => void fetch("/api/admin/users", { cache: "no-store" }).then(async (response) => { const body = await response.json() as { data?: readonly UserRow[]; error?: { message?: string } }; if (!response.ok || !body.data) throw new Error(body.error?.message ?? "用户列表加载失败，请稍后重试。"); return body.data; }).then(setUsers).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "用户列表加载失败，请稍后重试。"));
  useEffect(reload, []);
  const command = async (user: UserRow, path: "status" | "system-admin", body: object) => { const response = await fetch(`/api/admin/users/${encodeURIComponent(user.id)}/${path}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); if (!response.ok) { const result = await response.json() as { error?: { message?: string } }; throw new Error(result.error?.message ?? "用户操作失败，请稍后重试。"); } reload(); };
  return <AppFrame wide><section className="py-5"><h1 className="text-2xl font-bold">用户管理</h1>{error ? <p role="alert" className="mt-4 text-sm text-destructive">{error}</p> : null}{!users ? <p className="py-8 text-muted-foreground">正在加载用户…</p> : <ul className="mt-5 divide-y border-y">{users.map((user) => <li key={user.id} className="py-3"><div className="flex items-center justify-between gap-3"><div><strong>{user.nickname}</strong><p className="text-sm text-muted-foreground">{user.username} · {user.disabled ? "已禁用" : "正常"}{user.isSystemAdmin ? " · 系统管理员" : ""}</p></div><div className="flex flex-wrap justify-end gap-2"><button type="button" className="min-h-11 border px-3 text-sm" onClick={() => void command(user, "status", { disabled: !user.disabled }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "用户操作失败，请稍后重试。"))}>{user.disabled ? "启用" : "禁用"}</button><button type="button" className="min-h-11 border px-3 text-sm" onClick={() => void command(user, "system-admin", { granted: !user.isSystemAdmin }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "用户操作失败，请稍后重试。"))}>{user.isSystemAdmin ? "撤销管理员" : "设为管理员"}</button></div></div></li>)}</ul>}</section></AppFrame>;
}
