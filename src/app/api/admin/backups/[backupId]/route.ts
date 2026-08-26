import { createReadStream } from "node:fs";
import { Readable } from "node:stream";

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ backupId: string }> };

/** 下载文件名由服务端生成，避免把数据库路径或客户端输入映射到 Content-Disposition。 */
export async function GET(request: Request, context: RouteContext) {
  const [
    { requireSession },
    { sql },
    { requireSystemAdmin },
    backups,
    { applicationErrorResponse },
  ] = await Promise.all([
    import("@/server/auth/session"),
    import("@/server/db/client"),
    import("@/server/permissions/require-system-admin"),
    import("@/server/backup/backup-service"),
    import("@/server/http/application-error-response"),
  ]);
  try {
    await requireSystemAdmin(sql, await requireSession(request.headers));
    const record = await backups.requireBackupFile(
      sql,
      (await context.params).backupId,
    );
    return new NextResponse(
      Readable.toWeb(createReadStream(record.path)) as ReadableStream,
      {
        headers: {
          "Content-Type": "application/gzip",
          "Content-Length": record.sizeBytes.toString(),
          "Content-Disposition": `attachment; filename="${record.filename}"`,
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (error) {
    const response = applicationErrorResponse(error);
    if (response) return response;
    throw error;
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  const [
    { requireSession },
    { sql },
    { requireSystemAdmin },
    backups,
    { applicationErrorResponse },
  ] = await Promise.all([
    import("@/server/auth/session"),
    import("@/server/db/client"),
    import("@/server/permissions/require-system-admin"),
    import("@/server/backup/backup-service"),
    import("@/server/http/application-error-response"),
  ]);
  try {
    await requireSystemAdmin(sql, await requireSession(request.headers));
    await backups.deleteBackup(sql, (await context.params).backupId);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    const response = applicationErrorResponse(error);
    if (response) return response;
    throw error;
  }
}
