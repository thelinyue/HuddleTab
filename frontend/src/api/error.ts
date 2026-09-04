import type { components } from "./generated/openapi";

type ErrorEnvelope = components["schemas"]["ErrorEnvelope"];

/** 页面只处理这一种错误，保留服务端 requestId 方便部署者定位中文日志。 */
export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fieldErrors: ErrorEnvelope["error"]["fieldErrors"];
  readonly details: ErrorEnvelope["error"]["details"];
  readonly requestId: string;

  constructor(status: number, envelope?: ErrorEnvelope) {
    const error = envelope?.error;
    super(error?.message ?? "请求失败，请稍后重试。");
    this.name = "ApiRequestError";
    this.status = status;
    this.code = error?.code ?? "REQUEST_FAILED";
    this.fieldErrors = error?.fieldErrors ?? {};
    this.details = error?.details ?? {};
    this.requestId = error?.requestId ?? "";
  }
}

export type ApiResult<T> = {
  data?: T;
  error?: unknown;
  response: Response;
};

export function unwrap<T>(result: ApiResult<T>): T {
  if (result.data !== undefined) return result.data;
  throw new ApiRequestError(
    result.response.status,
    result.error as ErrorEnvelope | undefined,
  );
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "请求失败，请稍后重试。";
}
