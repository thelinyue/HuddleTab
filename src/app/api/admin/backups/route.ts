import { NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";

const confirmationInput = z.object({ confirmed: z.literal(true) });

function routeErrorResponse(
  error: unknown,
  applicationErrorResponse: (error: unknown) => Response | undefined,
) {
  if (error instanceof z.ZodError)
    return NextResponse.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "请明确确认后再执行备份操作。",
          fieldErrors: error.flatten().fieldErrors,
          details: {},
        },
      },
      { status: 422 },
    );
  return applicationErrorResponse(error);
}

/** 平台备份不读取任何 Activity；管理员身份只在 requireSystemAdmin 中解析。 */
export async function GET(request: Request) {
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
    const records = await backups.listBackups(sql);
    return NextResponse.json({ data: records.map(serializeBackup) });
  } catch (error) {
    const response = applicationErrorResponse(error);
    if (response) return response;
    throw error;
  }
}

export async function POST(request: Request) {
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
    const session = await requireSession(request.headers);
    const actorUserId = await requireSystemAdmin(sql, session);
    confirmationInput.parse(await request.json());
    const record = await backups
      .createDatabaseBackupService(sql)
      .create(actorUserId);
    return NextResponse.json(
      { data: serializeBackup(record) },
      { status: 201 },
    );
  } catch (error) {
    const response = routeErrorResponse(error, applicationErrorResponse);
    if (response) return response;
    throw error;
  }
}

function serializeBackup(record: {
  readonly id: string;
  readonly filename: string;
  readonly sizeBytes: bigint;
  readonly checksum: string;
  readonly createdAt?: Date;
  readonly status?: string;
}) {
  return {
    id: record.id,
    filename: record.filename,
    sizeBytes: record.sizeBytes.toString(),
    checksum: record.checksum,
    status: record.status ?? "READY",
    ...(record.createdAt ? { createdAt: record.createdAt.toISOString() } : {}),
  };
}
