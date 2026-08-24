import { NextResponse } from "next/server";
import { sql } from "@/server/db";

/** 健康检查通过轻量查询确认应用当前可访问其主数据库。 */
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
