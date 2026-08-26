import { ApplicationError } from "@/server/errors/application-error";

/**
 * Route Handler 只把预期的业务错误暴露为稳定 API 契约；未知异常继续抛出，
 * 交由框架记录，避免将数据库细节或凭证相关信息返回给客户端。
 */
export function applicationErrorResponse(error: unknown): Response | undefined {
  if (!(error instanceof ApplicationError)) return undefined;

  return Response.json(
    {
      error: {
        code: error.code,
        message: error.message,
        fieldErrors: {},
        details: error.details,
      },
    },
    { status: error.status },
  );
}
