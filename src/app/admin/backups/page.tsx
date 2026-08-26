"use client";

import {
  ArchiveRestore,
  Download,
  HardDriveDownload,
  LoaderCircle,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { AppFrame } from "@/components/design-system/app-frame";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type Backup = {
  readonly id: string;
  readonly filename: string;
  readonly sizeBytes: string;
  readonly checksum: string;
  readonly status: "READY" | "RESTORING" | "FAILED";
  readonly createdAt?: string;
};

type Action = "create" | { type: "restore" | "delete"; backup: Backup };

async function readData<T>(response: Response): Promise<T> {
  const body = (await response.json()) as {
    data?: T;
    error?: { message?: string };
  };
  if (!response.ok || !body.data)
    throw new Error(body.error?.message ?? "备份操作失败，请稍后重试。");
  return body.data;
}

/** 备份容量以服务端 bigint 字符串传输，浏览器只在展示时格式化，避免精度丢失。 */
function formatBytes(value: string) {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let bytes = BigInt(value);
  let unit = 0;
  while (bytes >= 1024n && unit < units.length - 1) {
    bytes /= 1024n;
    unit += 1;
  }
  return `${new Intl.NumberFormat("zh-CN").format(bytes)} ${units[unit]}`;
}

/**
 * 恢复是不可逆的运维操作，所以 UI 不会直接调用 API：创建、删除、恢复都先显示说明明确的
 * 确认层。服务端仍会再次校验 confirmed 和 System Admin，界面不是安全边界。
 */
export default function AdminBackupsPage() {
  const [backups, setBackups] = useState<readonly Backup[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<Action | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadBackups = useCallback(async () => {
    return readData<readonly Backup[]>(
      await fetch("/api/admin/backups", { cache: "no-store" }),
    );
  }, []);

  const refresh = useCallback(async () => {
    setBackups(await loadBackups());
  }, [loadBackups]);

  useEffect(() => {
    let disposed = false;
    void loadBackups()
      .then((records) => {
        if (!disposed) setBackups(records);
      })
      .catch((reason: unknown) => {
        if (!disposed)
          setError(
            reason instanceof Error
              ? reason.message
              : "备份列表加载失败，请稍后重试。",
          );
      })
      .finally(() => {
        if (!disposed) setLoading(false);
      });
    return () => {
      disposed = true;
    };
  }, [loadBackups]);

  async function confirmAction() {
    if (!pending) return;
    setSubmitting(true);
    setError(null);
    setNotice(null);
    try {
      if (pending === "create") {
        const created = await readData<Backup>(
          await fetch("/api/admin/backups", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ confirmed: true }),
          }),
        );
        setBackups((current) => [created, ...current]);
        setNotice("完整备份已创建。");
      } else if (pending.type === "restore") {
        await readData<{ restored: true }>(
          await fetch(
            `/api/admin/backups/${encodeURIComponent(pending.backup.id)}/restore`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ confirmed: true }),
            },
          ),
        );
        await refresh();
        setNotice("备份已恢复，系统已完成恢复后的检查。");
      } else {
        const response = await fetch(
          `/api/admin/backups/${encodeURIComponent(pending.backup.id)}`,
          {
            method: "DELETE",
          },
        );
        if (!response.ok) {
          const body = (await response.json()) as {
            error?: { message?: string };
          };
          throw new Error(body.error?.message ?? "删除备份失败，请稍后重试。");
        }
        setBackups((current) =>
          current.filter((backup) => backup.id !== pending.backup.id),
        );
        setNotice("备份已删除。");
      }
      setPending(null);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "备份操作失败，请稍后重试。",
      );
    } finally {
      setSubmitting(false);
    }
  }

  const dialog = dialogCopy(pending);
  return (
    <AppFrame>
      <section className="py-5">
        <div className="flex items-start gap-3">
          <span className="grid size-11 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
            <HardDriveDownload className="size-5" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h1 className="text-2xl font-bold">备份与恢复</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              数据库与上传文件
            </p>
          </div>
        </div>

        <div className="mt-7 flex items-center justify-between gap-3 border-y py-4">
          <div>
            <h2 className="text-base font-semibold">完整备份</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              包含数据库、上传文件和兼容信息
            </p>
          </div>
          <Button
            onClick={() => setPending("create")}
            disabled={loading || submitting}
          >
            <HardDriveDownload aria-hidden="true" />
            创建备份
          </Button>
        </div>

        {error ? (
          <p role="alert" className="mt-4 text-sm text-destructive">
            {error}
          </p>
        ) : null}
        {notice ? (
          <p role="status" className="mt-4 text-sm text-primary">
            {notice}
          </p>
        ) : null}

        <section aria-labelledby="backup-list-heading" className="mt-7">
          <h2 id="backup-list-heading" className="text-base font-semibold">
            可用备份
          </h2>
          {loading ? (
            <div className="flex min-h-32 items-center gap-2 text-sm text-muted-foreground">
              <LoaderCircle
                className="size-4 animate-spin"
                aria-hidden="true"
              />
              正在加载备份…
            </div>
          ) : backups.length === 0 ? (
            <p className="py-8 text-sm text-muted-foreground">暂无可用备份。</p>
          ) : (
            <ul className="mt-3 divide-y border-y">
              {backups.map((backup) => (
                <li key={backup.id} className="py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {backup.filename}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {formatBytes(backup.sizeBytes)}
                        {backup.createdAt
                          ? ` · ${new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(backup.createdAt))}`
                          : ""}
                      </p>
                    </div>
                    <Badge
                      variant={
                        backup.status === "READY" ? "secondary" : "outline"
                      }
                    >
                      {backup.status === "READY" ? "可恢复" : backup.status}
                    </Badge>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button variant="outline" size="sm" asChild>
                      <a
                        href={`/api/admin/backups/${encodeURIComponent(backup.id)}`}
                        aria-label={`下载 ${backup.filename}`}
                      >
                        <Download aria-hidden="true" />
                        下载
                      </a>
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={backup.status !== "READY" || submitting}
                      onClick={() => setPending({ type: "restore", backup })}
                    >
                      <ArchiveRestore aria-hidden="true" />
                      恢复
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      title={`删除 ${backup.filename}`}
                      aria-label={`删除 ${backup.filename}`}
                      disabled={submitting}
                      onClick={() => setPending({ type: "delete", backup })}
                    >
                      <Trash2 aria-hidden="true" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </section>

      <AlertDialog
        open={pending !== null}
        onOpenChange={(open) => !open && setPending(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{dialog.title}</AlertDialogTitle>
            <AlertDialogDescription>
              {dialog.description}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={submitting}>取消</AlertDialogCancel>
            <AlertDialogAction
              variant={
                pending !== "create" && pending?.type === "delete"
                  ? "destructive"
                  : "default"
              }
              disabled={submitting}
              onClick={(event) => {
                event.preventDefault();
                void confirmAction();
              }}
            >
              {submitting ? (
                <LoaderCircle className="animate-spin" aria-hidden="true" />
              ) : null}
              {dialog.action}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppFrame>
  );
}

function dialogCopy(action: Action | null) {
  if (action === "create")
    return {
      title: "创建完整备份",
      description:
        "将创建数据库和上传文件的完整归档，备份文件保存在服务器数据目录。",
      action: "确认创建",
    };
  if (action?.type === "restore")
    return {
      title: "恢复备份",
      description:
        "恢复会覆盖当前数据库和上传文件。系统会进入维护模式，完成迁移与检查后才恢复写入。",
      action: "确认恢复",
    };
  if (action?.type === "delete")
    return {
      title: "删除备份",
      description: "删除后无法恢复该归档文件。",
      action: "确认删除",
    };
  return { title: "", description: "", action: "确认" };
}
