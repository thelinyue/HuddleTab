"use client";

import { Database, FolderArchive, HardDrive, LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";

import { AppFrame } from "@/components/design-system/app-frame";

type Storage = {
  readonly databaseBytes: string;
  readonly uploadsBytes: string;
  readonly totalBytes: string;
};

type Information = {
  readonly appVersion: string;
  readonly pwaVersion: string;
  readonly databaseVersion: string;
  readonly dataDirectory: string;
};

async function readData<T>(response: Response): Promise<T> {
  const body = (await response.json()) as {
    data?: T;
    error?: { message?: string };
  };
  if (!response.ok || !body.data)
    throw new Error(body.error?.message ?? "系统信息加载失败，请稍后重试。");
  return body.data;
}

/** 服务器传来的字节数是十进制 bigint 字符串，展示时才在浏览器中格式化。 */
function formatBytes(value: string) {
  const bytes = BigInt(value);
  const units = ["B", "KB", "MB", "GB", "TB"];
  let unit = 0;
  let whole = bytes;
  while (whole >= 1024n && unit < units.length - 1) {
    whole /= 1024n;
    unit += 1;
  }
  return `${new Intl.NumberFormat("zh-CN").format(whole)} ${units[unit]}`;
}

/** 管理页面保持单列扫描节奏；敏感绝对路径只来自已受服务端守卫的同源 API。 */
export default function AdminSystemPage() {
  const [storage, setStorage] = useState<Storage | null>(null);
  const [information, setInformation] = useState<Information | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void Promise.all([
      fetch("/api/admin/storage", { cache: "no-store" }).then(
        readData<Storage>,
      ),
      fetch("/api/admin/system-information", { cache: "no-store" }).then(
        readData<Information>,
      ),
    ])
      .then(([nextStorage, nextInformation]) => {
        setStorage(nextStorage);
        setInformation(nextInformation);
      })
      .catch((reason: unknown) =>
        setError(
          reason instanceof Error
            ? reason.message
            : "系统信息加载失败，请稍后重试。",
        ),
      );
  }, []);

  if (error)
    return (
      <AppFrame>
        <p role="alert" className="py-8 text-sm text-destructive">
          {error}
        </p>
      </AppFrame>
    );
  if (!storage || !information)
    return (
      <AppFrame>
        <div className="flex min-h-48 items-center gap-2 text-sm text-muted-foreground">
          <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
          正在加载系统信息…
        </div>
      </AppFrame>
    );

  return (
    <AppFrame>
      <section className="py-5">
        <div className="flex items-start gap-3">
          <span className="grid size-11 place-items-center rounded-lg bg-primary/10 text-primary">
            <HardDrive className="size-5" aria-hidden="true" />
          </span>
          <div>
            <h1 className="text-2xl font-bold">系统信息</h1>
            <p className="mt-1 text-sm text-muted-foreground">存储与运行版本</p>
          </div>
        </div>

        <section aria-labelledby="storage-heading" className="mt-7">
          <h2 id="storage-heading" className="text-base font-semibold">
            存储使用
          </h2>
          <dl className="mt-3 divide-y border-y text-sm">
            <Metric
              icon={<Database aria-hidden="true" />}
              label="数据库"
              value={formatBytes(storage.databaseBytes)}
            />
            <Metric
              icon={<FolderArchive aria-hidden="true" />}
              label="上传文件"
              value={formatBytes(storage.uploadsBytes)}
            />
            <Metric
              label="合计"
              value={formatBytes(storage.totalBytes)}
              strong
            />
          </dl>
        </section>

        <section aria-labelledby="runtime-heading" className="mt-8">
          <h2 id="runtime-heading" className="text-base font-semibold">
            运行信息
          </h2>
          <dl className="mt-3 divide-y border-y text-sm">
            <Detail label="应用版本" value={information.appVersion} />
            <Detail label="PWA 版本" value={information.pwaVersion} />
            <Detail label="数据库" value={information.databaseVersion} />
            <Detail label="数据目录" value={information.dataDirectory} />
          </dl>
        </section>
      </section>
    </AppFrame>
  );
}

function Metric({
  icon,
  label,
  value,
  strong = false,
}: {
  readonly icon?: React.ReactNode;
  readonly label: string;
  readonly value: string;
  readonly strong?: boolean;
}) {
  return (
    <div className="flex min-h-12 items-center justify-between gap-4 py-2">
      <dt className="flex min-w-0 items-center gap-2 text-muted-foreground">
        {icon ? <span className="size-4 shrink-0">{icon}</span> : null}
        {label}
      </dt>
      <dd className={strong ? "font-semibold" : "font-medium"}>{value}</dd>
    </div>
  );
}

function Detail({
  label,
  value,
}: {
  readonly label: string;
  readonly value: string;
}) {
  return (
    <div className="flex min-h-12 items-center justify-between gap-4 py-2">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-all text-right font-medium">{value}</dd>
    </div>
  );
}
