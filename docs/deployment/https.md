# HTTPS 与反向代理

## 出站汇率服务

“获取参考汇率”会由 Rust 服务端访问 `https://api.frankfurter.dev`。防火墙需要允许该 HTTPS 出站连接；Frankfurter 日参考数据不是实时交易报价，服务不可用时用户仍可手工输入汇率。HuddleTab 不要求 API Key，也不接受浏览器直连 Provider。

HuddleTab 可以直接以 HTTP 运行。默认 Compose 在 `http://localhost:5660` 提供服务，适合本机、受控 LAN 和部署者自己的反向代理之后的内部通信。核心 `compose.yaml` 只包含 `app` 与 `postgres`，不会内置 Caddy、Nginx、Traefik、TLS 证书或域名管理。

公网访问、完整 PWA 安全上下文和更安全的 Session 传输建议由部署者在应用外提供 HTTPS。反向代理和容器日志均应仅向部署管理员开放。

## Caddy 示例

以下配置由部署者放在 Compose 之外。Caddy 监听公网 HTTPS，再转发给只在本机开放的 HuddleTab 端口：

```caddyfile
huddletab.example.com {
  reverse_proxy 127.0.0.1:5660
}
```

## Nginx / Nginx Proxy Manager 上传上限

附件原图最多 10 MiB，应用额外预留 multipart 协议开销，因此反向代理必须允许至少 11 MiB 的请求体。Nginx 默认请求体上限通常为 1 MiB；通过 Nginx 或 Nginx Proxy Manager 的域名访问时，请在对应 `server` 或 Proxy Host 的 Advanced 配置中加入：

```nginx
client_max_body_size 11m;
```

保存并重新加载代理后，再通过公开域名上传附件。若代理仍返回 HTTP 413，请检查 CDN、网关或第二层反向代理是否设置了更小的上限。HuddleTab 自身仍会拒绝超过 10 MiB、格式不允许、内容签名不匹配、损坏或超过像素安全限制的图片。

将 Compose 的应用端口限制为回环地址：

```yaml
services:
  app:
    ports:
      - "127.0.0.1:5660:5660"
```

然后设置公开 HTTPS 地址，并让 Cookie 在 HTTPS 部署中使用 Secure 属性：

```env
APP_BASE_URL=https://huddletab.example.com
```

HTTP 部署可以继续使用 `http://` 地址；HTTPS 不是应用启动前提。

## 首次管理员账号

服务在监听 HTTP 前创建管理员，支持 ADMIN_USERNAME 和 ADMIN_PASSWORD 环境变量。用户名留空使用 admin；密码留空安全随机生成，并仅在首次创建成功后打印到应用日志。手动配置的密码不打印。登录后可在“我的 → 账户与安全”修改用户名或密码；重启不覆盖网页修改结果。

部署日志可能包含首次随机密码，应仅供部署者访问。网页登录和凭据修改继续使用同源 CSRF 校验；公开访问请配置 HTTPS。

## 可信代理边界

默认 `TRUST_PROXY=false`。此时 HuddleTab 不信任 `Forwarded`、`X-Forwarded-For`、`X-Real-IP` 或其他客户端可伪造的地址 Header。

只有部署者能够同时保证以下边界时，才设置 `TRUST_PROXY=true`：

1. 应用只可经由自己控制的反向代理访问。
2. 代理会删除客户端提交的 `X-Real-IP`。
3. 代理会按真实连接重新设置唯一可信的 `X-Real-IP`。
4. 不可信客户端不能绕过代理直接访问应用端口。

启用后，应用只读取格式合法的单值 `X-Real-IP`，不解析或混合信任 `Forwarded`、`X-Forwarded-For`、`CF-Connecting-IP` 等 Header；缺失或无效时回退到 TCP 对端地址。`TRUST_PROXY` 与 HTTPS 没有绑定关系；错误启用它会使 IP 限流可能被伪造或绕过。

当前进程内固定窗口限流只覆盖以下敏感操作：

- 登录和注册共用 `10/分钟/IP`；均先通过 pre-auth CSRF 校验。
- 邀请预览和 join 共用 `30/分钟/IP`；join 在鉴权前计数，避免匿名探测绕过限制。
- 创建邀请、撤销邀请和修改密码共用 `10/分钟/用户`；均先通过有效 Session 和 CSRF 校验。

普通活动、成员、账务等业务写入，以及结算摘要和 CSV 读取不经过该限流器。限流响应为标准 JSON 错误 envelope，含 `RATE_LIMITED` 和整数秒 `Retry-After`；限流状态只存在当前应用进程，重启后会清空。

部署者仅在满足上述边界并设置 `TRUST_PROXY=true` 时，才应在 Caddy 的 `reverse_proxy` 中删除客户端提交的 Header 并按直接连接重设它：

```caddyfile
huddletab.example.com {
  reverse_proxy 127.0.0.1:5660 {
    header_up -X-Real-IP
    header_up X-Real-IP {http.request.remote.host}
  }
}
```

不要同时传递或让 HuddleTab 解析 `X-Forwarded-For`、`Forwarded` 等代理链 Header。
