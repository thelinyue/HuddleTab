import { Check, Clipboard, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { Button, LoadingState } from "../../components/ui";
import { useSetupStatusQuery } from "./api";

const bootstrapCommand = "docker compose exec app huddletab bootstrap-user --username your-username";

export function SetupStatusError({ onRetry }: { onRetry: () => void }) {
  return (
    <main className="setup-page">
      <section className="setup-panel" role="alert">
        <ShieldCheck aria-hidden="true" size={28} />
        <h1>无法确认初始化状态</h1>
        <p>暂时无法连接数据库。请确认服务已启动后重新检查。</p>
        <Button onClick={onRetry}>重新检查</Button>
      </section>
    </main>
  );
}

export function SetupPage() {
  const status = useSetupStatusQuery();
  const [copied, setCopied] = useState(false);

  if (status.isPending) return <LoadingState label="正在确认初始化状态…" />;
  if (status.error || !status.data) return <SetupStatusError onRetry={() => void status.refetch()} />;
  if (!status.data.setupRequired) return null;

  async function copyCommand() {
    try {
      await navigator.clipboard.writeText(bootstrapCommand);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <main className="setup-page">
      <section className="setup-panel">
        <div className="setup-panel__brand"><span className="setup-panel__icon"><ShieldCheck aria-hidden="true" size={22} /></span><div><p className="eyebrow">伙记 HuddleTab</p><h1>初始化管理员</h1></div></div>
        <p>这是一个全新的数据库。请在运行 HuddleTab 的服务器上执行一次 CLI 命令，创建首位系统管理员。</p>
        <div className="setup-command" aria-label="初始化命令"><code>{bootstrapCommand}</code><Button variant="secondary" onClick={() => void copyCommand()} aria-label="复制命令">{copied ? <Check aria-hidden="true" size={17} /> : <Clipboard aria-hidden="true" size={17} />}{copied ? "已复制" : "复制命令"}</Button>{copied ? <span className="setup-command__status" role="status">命令已复制</span> : null}</div>
        <ol className="setup-steps"><li>在服务器终端执行上面的命令。</li><li>CLI 会在终端安全读取并确认密码，不要把密码写入命令行或日志。</li><li>完成后回到这里，点击“重新检查初始化状态”。</li></ol>
        <div className="setup-panel__actions"><Button onClick={() => void status.refetch()}>重新检查初始化状态</Button><p className="setup-panel__hint">部署说明和数据目录安全要求记录在仓库 README 与部署文档中。</p></div>
      </section>
    </main>
  );
}
