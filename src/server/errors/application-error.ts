/**
 * 应用层错误统一携带机器可读的错误码、HTTP 状态和可选上下文，
 * 使路由可以安全地向部署者或调用方返回明确的中文错误，而不暴露底层实现细节。
 */
export class ApplicationError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "ApplicationError";
  }
}
