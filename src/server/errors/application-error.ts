/**
 * 应用层统一错误契约：机器码保持稳定，中文消息可直接面向部署者和最终用户。
 * Route Handler 在后续阶段将它转换为统一 API 错误响应。
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
