# HuddleTab Task 31：存储与系统信息设计

## 范围

Task 31 只收口 System Admin 的存储占用和系统信息读取。接口属于 Rust/Axum 新栈，必须在未禁用的 `SYSTEM_ADMIN` Session 授权后读取，且不因此扩展 Activity 数据权限。

## 读取模型

- `GET /api/admin/storage` 返回数据库、上传文件和合计字节数，三者均以十进制字符串传输。
- `GET /api/admin/system-information` 返回应用版本、PWA 版本、PostgreSQL 版本和数据目录。
- 两个响应都使用 `Cache-Control: private, no-store`。
- 数据库大小使用 `pg_database_size(current_database())`；上传目录递归统计 `DATA_DIR/uploads` 下的普通文件，忽略符号链接，目录不存在视为零。
- `APP_VERSION` 同时作为 `appVersion` 与 `pwaVersion`，未设置时为 `dev`。当前不显示或发布 `0.0.3`。
- 探针失败只记录不含连接串和宿主路径的中文固定日志，并返回统一中文 500 envelope。

## 界面

系统管理首页沿用 `v0.0.2` 的紧凑单列入口和返回层级，新增“系统信息”项。页面按“存储使用”和“运行信息”分组；浏览器用 `BigInt` 格式化 API 的字节字符串，离线时不读取管理缓存并提示需要联网。

## 明确移出范围

SMTP、邮件测试及应用级备份/还原不再是产品能力，不新增 Rust API、页面、Migration 或运行时依赖。宿主/NAS 快照与恢复说明保留在 `docs/deployment/data-protection.md`；Activity 软删除的 30 天恢复仍是既有业务功能。
