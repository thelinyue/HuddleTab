import { ArrowLeft, Check, Clipboard, KeyRound, Plus, Trash2 } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Link } from "react-router-dom";
import { Button, ConfirmDialog, ErrorNotice, Field, Input, Select } from "../../components/ui";
import { ProductBottomNavigation } from "../../components/product-bottom-navigation";
import { useSessionQuery } from "../auth/api";
import { useCreateMcpTokenMutation, useMcpTokensQuery, useRevokeMcpTokenMutation, type CreateMcpTokenInput, type McpToken } from "./mcp-api";

type ExpiryChoice = "30" | "90" | "365" | "custom" | "permanent";

function expiryValue(choice: ExpiryChoice, custom: string): string | null {
  if (choice === "permanent") return null;
  if (choice === "custom") return custom ? new Date(custom).toISOString() : null;
  const expiry = new Date();
  expiry.setDate(expiry.getDate() + Number(choice));
  return expiry.toISOString();
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "永不过期";
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function scopeLabel(scope: string): string {
  return scope === "EXPENSES_CREATE" ? "读取 + 直接新增账单" : "仅读取";
}

function TokenRow({ token, onRevoke }: { token: McpToken; onRevoke: (token: McpToken) => void }) {
  const active = !token.revokedAt;
  return (
    <li className="mcp-token-row">
      <div className="mcp-token-row__icon" aria-hidden="true"><KeyRound size={18} /></div>
      <div className="mcp-token-row__body">
        <strong>{token.name}</strong>
        <span><code>{token.tokenPrefix}…</code> · {scopeLabel(token.scope)}</span>
        <small>{active ? `到期：${formatDate(token.expiresAt)}` : `已于 ${formatDate(token.revokedAt)} 撤销`}</small>
      </div>
      {active ? <Button className="mcp-token-row__revoke" variant="ghost" type="button" onClick={() => onRevoke(token)}><Trash2 aria-hidden="true" size={17} />撤销</Button> : <span className="mcp-token-row__status">已撤销</span>}
    </li>
  );
}

/** 管理个人 MCP Bearer 令牌；密钥原文只在创建成功后的当前页面显示一次。 */
export function McpPage() {
  const session = useSessionQuery();
  const userId = session.data?.userId ?? "";
  const tokens = useMcpTokensQuery(userId);
  const create = useCreateMcpTokenMutation(userId);
  const revoke = useRevokeMcpTokenMutation(userId);
  const [name, setName] = useState("");
  const [scope, setScope] = useState<CreateMcpTokenInput["scope"]>("READ");
  const [expiry, setExpiry] = useState<ExpiryChoice>("90");
  const [customExpiry, setCustomExpiry] = useState("");
  const [created, setCreated] = useState<ReturnType<typeof useCreateMcpTokenMutation>["data"]>();
  const [copied, setCopied] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<McpToken | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = name.trim();
    if (!normalized || normalized.length > 80) return;
    if (expiry === "custom" && (!customExpiry || new Date(customExpiry).valueOf() <= Date.now())) return;
    try {
      const result = await create.mutateAsync({ name: normalized, scope, expiresAt: expiryValue(expiry, customExpiry) });
      setCreated(result);
      setName("");
      setCopied(false);
    } catch {
      // 页面内展示 mutation.error，保留表单内容供用户重试。
    }
  }

  async function copySecret() {
    if (!created?.secret) return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(created.secret);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = created.secret;
        textarea.setAttribute("readonly", "true");
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        textarea.remove();
      }
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  async function confirmRevoke() {
    if (!revokeTarget) return;
    try {
      await revoke.mutateAsync(revokeTarget.tokenId);
      setRevokeTarget(null);
    } catch {
      // 对话框保留打开状态，便于用户重试。
    }
  }

  return (
    <div className="top-level-page">
      <main className="app-frame app-frame--with-nav mcp-page">
        <header className="page-header"><Link className="inline-back" to="/me"><ArrowLeft aria-hidden="true" size={18} />返回我的</Link><h1>MCP 连接</h1></header>
        <p className="mcp-page__intro">为桌面 AI 客户端创建个人令牌。连接地址是 <code>/mcp</code>；新增账单令牌会直接记账，不需要网页确认。</p>
        <section className="mcp-card" aria-labelledby="mcp-create-heading">
          <h2 id="mcp-create-heading">创建令牌</h2>
          <form className="form-stack" onSubmit={(event) => void submit(event)}>
            <Field label="名称" hint="例如：Claude Desktop；最多 80 个字符。"><Input value={name} maxLength={80} required placeholder="给这个连接起个名字" onChange={(event) => setName(event.target.value)} /></Field>
            <Field label="权限"><Select value={scope} onChange={(event) => setScope(event.target.value)}><option value="READ">仅读取活动账务</option><option value="EXPENSES_CREATE">读取并直接新增账单</option></Select></Field>
            <Field label="有效期"><Select value={expiry} onChange={(event) => setExpiry(event.target.value as ExpiryChoice)}><option value="30">30 天</option><option value="90">90 天</option><option value="365">365 天</option><option value="custom">自定义时间</option><option value="permanent">永不过期</option></Select></Field>
            {expiry === "custom" ? <Field label="到期时间"><Input type="datetime-local" value={customExpiry} required onChange={(event) => setCustomExpiry(event.target.value)} /></Field> : null}
            {create.error ? <ErrorNotice error={create.error} /> : null}
            <Button type="submit" busy={create.isPending}><Plus aria-hidden="true" size={18} />创建令牌</Button>
          </form>
        </section>
        {created ? <section className="mcp-card mcp-secret-card" aria-labelledby="mcp-secret-heading"><h2 id="mcp-secret-heading">令牌已创建</h2><div className="notice notice--warning" role="alert">请立即复制完整令牌；离开此页面后将无法再次查看。</div><code className="mcp-secret">{created.secret}</code><div className="mcp-secret__actions"><Button variant="secondary" type="button" onClick={() => void copySecret()}>{copied ? <Check aria-hidden="true" size={18} /> : <Clipboard aria-hidden="true" size={18} />}{copied ? "已复制" : "复制令牌"}</Button><Button variant="ghost" type="button" onClick={() => setCreated(undefined)}>我已保存</Button></div></section> : null}
        <section className="mcp-card" aria-labelledby="mcp-list-heading"><div className="mcp-card__heading"><h2 id="mcp-list-heading">已创建的令牌</h2><span>{tokens.data?.length ?? 0}</span></div>{tokens.isPending ? <p className="page-state">正在加载令牌…</p> : tokens.error ? <ErrorNotice error={tokens.error} /> : tokens.data?.length ? <ul className="mcp-token-list">{tokens.data.map((token) => <TokenRow key={token.tokenId} token={token} onRevoke={setRevokeTarget} />)}</ul> : <p className="mcp-empty">还没有 MCP 令牌。</p>}</section>
      </main>
      <ProductBottomNavigation />
      <ConfirmDialog open={revokeTarget !== null} title="撤销 MCP 令牌" message={revokeTarget ? <>“{revokeTarget.name}”撤销后，使用它的客户端会立即无法访问。</> : null} error={revoke.error ? <ErrorNotice error={revoke.error} /> : undefined} confirmLabel="撤销令牌" busy={revoke.isPending} onCancel={() => setRevokeTarget(null)} onConfirm={() => void confirmRevoke()} />
    </div>
  );
}
