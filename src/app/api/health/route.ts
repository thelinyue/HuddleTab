import { NextResponse } from "next/server";
import { sql } from "@/server/db/client";

export const dynamic = "force-dynamic";

/** 容器与编排系统使用此端点确认应用仍可查询数据库。 */
export async function GET() {
  try {
    await sql`select 1`;

    return NextResponse.json({ status: "ok" });
  } catch {
    return NextResponse.json(
      { status: "error", message: "数据库连接不可用" },
      { status: 503 },
    );
  }
}
