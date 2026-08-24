// 各业务阶段在本目录增加 schema 文件；此入口只统一导出，不承载业务规则。
export * from "./auth";
export * from "./system";

// Better Auth Drizzle adapter 以单数模型名查找 table；保留复数导出供业务代码使用。
export {
  accounts as account,
  sessions as session,
  users as user,
  verifications as verification,
} from "./auth";
