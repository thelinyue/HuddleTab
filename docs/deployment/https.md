# HTTPS 与反向代理

HuddleTab 可以直接以 HTTP 运行。默认 Compose 在 `http://localhost:5660` 提供服务，适合本机、受控 LAN 和部署者自己的反向代理之后的内部通信。核心 `compose.yaml` 只包含 `app` 与 `postgres`，不会内置 Caddy、Nginx、Traefik、TLS 证书或域名管理。

公网访问、完整 PWA 安全上下文和更安全的 Session 传输建议由部署者在应用外提供 HTTPS。反向代理和容器日志均应仅向部署管理员开放。

## Caddy 示例

以下配置由部署者放在 Compose 之外。Caddy 监听公网 HTTPS，再转发给只在本机开放的 HuddleTab 端口：

```caddyfile
huddletab.example.com {
  reverse_proxy 127.0.0.1:5660
}
```

将 Compose 的应用端口限制为回环地址：

```yaml
services:
  app:
    ports:
      - "127.0.0.1:5660:5660"
```

然后设置公开 HTTPS 地址，并让 Cookie 在 HTTPS 部署中使用 Secure 属性：

```env
BETTER_AUTH_URL=https://huddletab.example.com
APP_BASE_URL=https://huddletab.example.com
```

HTTP 部署可以继续使用 `http://` 地址；HTTPS 不是应用启动前提。

## 可信代理边界

默认 `TRUST_PROXY=false`。此时 HuddleTab 不信任 `Forwarded`、`X-Forwarded-For`、`X-Real-IP` 或其他客户端可伪造的地址 Header。

只有部署者能够同时保证以下边界时，才设置 `TRUST_PROXY=true`：

1. 应用只可经由自己控制的反向代理访问。
2. 代理会删除客户端提交的 `X-Real-IP`。
3. 代理会按真实连接重新设置唯一可信的 `X-Real-IP`。
4. 不可信客户端不能绕过代理直接访问应用端口。

启用后，V1 只读取 `X-Real-IP`，不解析或混合信任 `Forwarded`、`X-Forwarded-For`、`CF-Connecting-IP` 等 Header。`TRUST_PROXY` 与 HTTPS 没有绑定关系；错误启用它会使 IP 限流可能被伪造或绕过。登录、注册、初始化和邀请限流还会结合用户名或 Invite Token 等稳定标识，不能只依赖 IP。

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
