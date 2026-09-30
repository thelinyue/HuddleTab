import { useState } from "react";
import { ApiRequestError } from "../../api/error";
import { usePwaUpdateBlock } from "../../app/pwa-update-safety";
import { Button, ErrorNotice, LoadingState } from "../../components/ui";
import { type AccessAddresses, useAccessAddressesQuery, useUpdateAccessAddressesMutation } from "./api";
import "./access-addresses.css";

/** 与服务端保持相同的 Origin 输入规则，避免 URL 自动修复掩盖路径或凭据。 */
export function normalizeAccessAddress(input: string): string {
  const value = input.trim();
  const match = /^[a-z]+:\/\/([^/?#]+)(\/?)$/i.exec(value);
  if (!match || /[\\*\x00-\x20\x7f]/.test(value) || /[@%]/.test(match[1])) {
    throw new Error("请填写仅包含协议、主机和端口的地址，例如 https://example.com。");
  }
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("访问地址格式不正确。"); }
  if (!["http:", "https:"].includes(url.protocol) || !url.hostname) throw new Error("仅支持 HTTP 和 HTTPS 地址。");
  return url.origin;
}

export function AccessAddressesEditor({ userId, online }: { userId: string; online: boolean }) {
  const query = useAccessAddressesQuery(userId, online);
  if (!query.data) {
    if (!online) return <div className="notice" role="status">当前离线，联网后才能读取访问地址。</div>;
    if (query.error) return <ErrorNotice error={query.error} />;
    return <LoadingState label="正在读取访问地址…" />;
  }
  return <AddressForm userId={userId} online={online} settings={query.data} reload={async () => {
    const result = await query.refetch();
    if (result.error) throw result.error;
    return result.data!;
  }} />;
}

/** 编辑草稿不跟随查询自动重置，保存失败或其他管理员修改时保留用户输入。 */
function AddressForm({ userId, online, settings, reload }: {
  userId: string; online: boolean; settings: AccessAddresses; reload: () => Promise<AccessAddresses>;
}) {
  const [saved, setSaved] = useState(settings);
  const [origins, setOrigins] = useState(settings.origins);
  const [input, setInput] = useState("");
  const [error, setError] = useState<unknown>();
  const [message, setMessage] = useState("");
  const [reloading, setReloading] = useState(false);
  const update = useUpdateAccessAddressesMutation(userId);
  const current = window.location.origin;
  const mismatch = normalizeAccessAddress(current) !== settings.currentOrigin;
  const busy = update.isPending || reloading;
  const dirty = JSON.stringify(origins) !== JSON.stringify(saved.origins);
  usePwaUpdateBlock(dirty || !!input.trim() || busy);
  function add(value: string) {
    try {
      const origin = normalizeAccessAddress(value);
      setOrigins((items) => items.includes(origin) ? items : [...items, origin]);
      setInput(""); setError(undefined); setMessage("");
    } catch (reason) { setError(reason); }
  }
  async function save() {
    if (!online || busy || mismatch || !origins.includes(current)) return;
    setError(undefined); setMessage("");
    try {
      const result = await update.mutateAsync({ origins, version: saved.version });
      setSaved(result); setOrigins(result.origins); setMessage("访问地址已保存，立即生效。");
    } catch (reason) { setError(reason); }
  }
  async function reloadSaved() {
    setReloading(true);
    try {
      const result = await reload();
      setSaved(result); setOrigins(result.origins); setInput(""); setError(undefined); setMessage("");
    } catch (reason) { setError(reason); }
    finally { setReloading(false); }
  }
  return <section className="admin-settings-card access-addresses" aria-label="允许的访问地址">
    <p className="form-hint">添加内网 IP 或公网域名，网页与 MCP 共用这些访问地址。不同域名需要分别登录。</p>
    <div className="access-addresses__current"><span>当前地址</span><code>{current}</code></div>
    <Button variant="secondary" disabled={!online || busy || origins.includes(current)} onClick={() => add(current)}>添加当前地址</Button>
    {!saved.origins.length ? <p className="notice">尚未配置访问地址，MCP 暂未开放。请添加当前地址后保存。</p> : null}
    {mismatch ? <p className="notice notice--warning">识别到的访问地址与浏览器不一致，请检查反向代理配置后刷新。</p> : null}
    {!online ? <p className="notice" role="status">当前离线，联网后才能保存。</p> : null}
    <ul className="access-addresses__list">
      {origins.map((origin) => <li key={origin}><code>{origin}</code>{origin === current ? <span className="form-hint">当前使用</span> : <Button variant="ghost" disabled={!online || busy} aria-label={`移除 ${origin}`} onClick={() => { setOrigins(origins.filter((item) => item !== origin)); setMessage(""); }}>移除</Button>}</li>)}
    </ul>
    <form className="access-addresses__add" onSubmit={(event) => { event.preventDefault(); add(input); }}>
      <label htmlFor="access-address-input">添加地址</label>
      <div><input className="input" id="access-address-input" type="text" inputMode="url" autoCapitalize="none" autoCorrect="off" spellCheck={false} placeholder="https://example.com" value={input} disabled={!online || busy} onChange={(event) => setInput(event.target.value)} /><Button variant="secondary" type="submit" disabled={!online || busy || !input.trim()}>添加</Button></div>
    </form>
    <p className="form-hint">更换地址时，先添加新地址并保存，再从新地址登录后移除旧地址。</p>
    {!origins.includes(current) ? <p className="form-hint">保存前请先添加当前访问地址。</p> : null}
    {error ? <ErrorNotice error={error} /> : null}
    {error instanceof ApiRequestError && error.status === 409 ? <Button variant="secondary" disabled={!online || busy} onClick={() => void reloadSaved()}>放弃当前修改，重新载入已保存地址</Button> : null}
    <div className="access-addresses__save"><span role="status">{update.isPending ? "正在保存…" : message || (dirty ? "有未保存的修改" : "")}</span><Button busy={update.isPending} disabled={!online || busy || !dirty || !!input.trim() || mismatch || !origins.includes(current)} onClick={() => void save()}>保存</Button></div>
  </section>;
}
