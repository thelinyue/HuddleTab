"use client";
import { useEffect, useState } from "react";
type Row = {
  readonly id: string;
  readonly type: string;
  readonly readAt: string | null;
  readonly createdAt: string;
};
export function NotificationsPage() {
  const [rows, setRows] = useState<readonly Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void fetch("/api/notifications", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("通知加载失败，请稍后重试。");
        return (await response.json()).data as readonly Row[];
      })
      .then(setRows)
      .catch((reason: unknown) =>
        setError(
          reason instanceof Error
            ? reason.message
            : "通知加载失败，请稍后重试。",
        ),
      );
  }, []);
  if (error)
    return (
      <p role="alert" className="py-8 text-destructive">
        {error}
      </p>
    );
  if (!rows) return <p className="py-8 text-muted-foreground">正在加载通知…</p>;
  return (
    <section className="py-5">
      <h1 className="text-2xl font-bold">通知</h1>
      {rows.length ? (
        <div className="mt-4">
          {rows.map((row) => (
            <div key={row.id} className="border-b py-3">
              <strong>{row.type}</strong>
              <p className="mt-1 text-sm text-muted-foreground">
                {row.readAt ? "已读" : "未读"}
              </p>
            </div>
          ))}
        </div>
      ) : (
        <p className="py-8 text-center text-muted-foreground">暂时没有通知。</p>
      )}
    </section>
  );
}
