import { notFound } from "next/navigation";

import { UpdateBanner } from "@/features/pwa/update-banner";

/** 仅供开发态 E2E 验证更新提示，不在生产环境暴露测试界面。 */
export default async function PwaUpdateTestPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ pending?: string; waiting?: string }>;
}) {
  if (process.env.NODE_ENV === "production") notFound();
  const params = await searchParams;
  return (
    <main className="min-h-dvh bg-background p-4">
      <UpdateBanner
        pendingOverride={params.pending === "1"}
        waitingOverride={params.waiting === "1"}
      />
    </main>
  );
}
