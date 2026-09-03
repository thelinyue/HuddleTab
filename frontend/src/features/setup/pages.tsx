import { ShieldCheck } from "lucide-react";
import { type FormEvent, useState } from "react";
import { useLoginMutation } from "../auth/api";
import { ApiRequestError } from "../../api/error";
import { Button, ErrorNotice, Field, Input, LoadingState } from "../../components/ui";
import { useInitializeSetupMutation, useSetupStatusQuery } from "./api";

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

type SetupValues = {
  displayName: string;
  username: string;
  password: string;
  confirmPassword: string;
};

const initialValues: SetupValues = {
  displayName: "",
  username: "",
  password: "",
  confirmPassword: "",
};

/**
 * 首次管理员初始化与 v0.0.2 保持相同的网页表单和自动登录路径。
 * 服务端只负责创建首位用户，Session 继续复用普通登录接口，避免维护第二套认证写入逻辑。
 */
export function SetupPage() {
  const status = useSetupStatusQuery();
  const setupMutation = useInitializeSetupMutation();
  const loginMutation = useLoginMutation();
  const [values, setValues] = useState(initialValues);
  const [error, setError] = useState<unknown>(null);

  if (status.isPending) return <LoadingState label="正在确认初始化状态…" />;
  if (status.error || !status.data) return <SetupStatusError onRetry={() => void status.refetch()} />;
  if (!status.data.setupRequired) return null;

  function update<Key extends keyof SetupValues>(key: Key, value: SetupValues[Key]) {
    setValues((current) => ({ ...current, [key]: value }));
    setError(null);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (values.password !== values.confirmPassword) {
      setError(new Error("两次输入的密码不一致。"));
      return;
    }

    try {
      try {
        await setupMutation.mutateAsync({
          displayName: values.displayName,
          username: values.username,
          password: values.password,
        });
      } catch (reason) {
        // 请求实际成功但响应丢失时，初始化已关闭；继续用当前凭据尝试登录。
        if (!(reason instanceof ApiRequestError && reason.code === "SETUP_COMPLETED")) throw reason;
      }
      await loginMutation.mutateAsync({ username: values.username, password: values.password });
      window.location.assign("/activities");
    } catch (reason) {
      setError(reason);
    }
  }

  const submitting = setupMutation.isPending || loginMutation.isPending;
  return (
    <main className="setup-page">
      <section className="setup-panel">
        <div className="setup-panel__brand">
          <span className="setup-panel__icon"><ShieldCheck aria-hidden="true" size={22} /></span>
          <div><p className="eyebrow">伙记 HuddleTab</p><h1>初始化管理员</h1></div>
        </div>
        <p>创建首位系统管理员，完成后即可登录并开始使用伙记。</p>
        <form className="setup-form" onSubmit={(event) => void submit(event)}>
          <Field label="管理员昵称">
            <Input name="displayName" value={values.displayName} onChange={(event) => update("displayName", event.target.value)} autoComplete="name" required maxLength={80} autoFocus />
          </Field>
          <Field label="用户名" hint="3–32 位，仅限小写字母、数字、点、下划线和连字符。">
            <Input name="username" value={values.username} onChange={(event) => update("username", event.target.value)} autoComplete="username" required minLength={3} maxLength={32} />
          </Field>
          <Field label="密码" hint="8–128 个字符，可以使用密码管理器生成和粘贴。">
            <Input name="password" value={values.password} onChange={(event) => update("password", event.target.value)} type="password" autoComplete="new-password" required minLength={8} maxLength={128} />
          </Field>
          <Field label="确认密码" error={error instanceof Error && error.message === "两次输入的密码不一致。" ? error.message : undefined}>
            <Input name="confirmPassword" value={values.confirmPassword} onChange={(event) => update("confirmPassword", event.target.value)} type="password" autoComplete="new-password" required minLength={8} maxLength={128} />
          </Field>
          {error && !(error instanceof Error && error.message === "两次输入的密码不一致。") ? <ErrorNotice error={error} /> : null}
          <Button type="submit" busy={submitting}>完成初始化</Button>
        </form>
        <p className="setup-panel__hint">首次初始化前请限制实例的网络访问，避免不受信任的访问者抢先创建管理员。</p>
      </section>
    </main>
  );
}
