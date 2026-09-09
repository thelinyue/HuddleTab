import { ArrowLeft, CheckCircle2 } from "lucide-react";
import { type FormEvent, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { errorMessage } from "../../api/error";
import { ProductBottomNavigation } from "../../components/product-bottom-navigation";
import { Button, ErrorNotice, Input } from "../../components/ui";
import { useChangeUsernameMutation, useSessionQuery } from "../auth/api";

const USERNAME_HINT = "3–32 位小写字母、数字、点、下划线或连字符。";
const normalize = (value: string) => value.normalize("NFKC").trim().toLowerCase();

/** 登录用户名与昵称分开编辑；失败保留草稿，成功同步身份且不清除离线数据。 */
export function ChangeUsernamePage() {
  const session = useSessionQuery();
  const mutation = useChangeUsernameMutation();
  const [username, setUsername] = useState(session.data?.username ?? "");
  const [password, setPassword] = useState("");
  const [touched, setTouched] = useState(false);
  const [saveError, setSaveError] = useState<string>();
  const [success, setSuccess] = useState(false);
  const submitting = useRef(false);
  const normalized = normalize(username);
  const valid = /^[a-z0-9._-]{3,32}$/.test(normalized);
  const changed = normalized !== session.data?.username;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setTouched(true);
    if (!valid || !changed || submitting.current) return;
    submitting.current = true;
    setSaveError(undefined);
    setSuccess(false);
    try {
      const result = await mutation.mutateAsync({ newUsername: username, currentPassword: password });
      setUsername(result.username);
      setPassword("");
      setSuccess(true);
    } catch (error) {
      setSaveError(errorMessage(error));
    } finally {
      submitting.current = false;
    }
  }

  return (
    <div className="top-level-page">
      <main className="app-frame app-frame--with-nav">
        <header className="me-subpage-header">
          <Link className="icon-button" to="/me" aria-label="返回我的"><ArrowLeft aria-hidden="true" size={20} /></Link>
          <h1>修改用户名</h1><span aria-hidden="true" />
        </header>
        <form className="password-form" onSubmit={(event) => void submit(event)}>
          <p className="field__hint">用户名用于登录，与昵称不同。修改后，发给旧用户名但尚未使用的定向邀请将失效，请邀请人使用新用户名重新邀请。</p>
          <div className="field">
            <label className="field__label" htmlFor="account-new-username">新用户名</label>
            <Input id="account-new-username" autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false}
              value={username} required disabled={mutation.isPending} onBlur={() => setTouched(true)}
              aria-invalid={touched && !valid ? true : undefined} aria-describedby="username-hint"
              onChange={(event) => { setUsername(event.target.value); setSaveError(undefined); setSuccess(false); }} />
            <span id="username-hint" className="field__hint" role={touched && !valid ? "alert" : undefined}>{touched && !valid ? "用户名无效。" : ""}{USERNAME_HINT}</span>
          </div>
          <div className="field">
            <label className="field__label" htmlFor="username-current-password">当前密码</label>
            <Input id="username-current-password" type="password" autoComplete="current-password" value={password}
              required minLength={8} maxLength={128} disabled={mutation.isPending}
              onChange={(event) => { setPassword(event.target.value); setSaveError(undefined); }} />
          </div>
          {saveError ? <ErrorNotice error={new Error(saveError)} /> : null}
          {success ? <div className="notice notice--success" role="status"><CheckCircle2 aria-hidden="true" size={18} /><span>用户名已修改，下次请使用新用户名登录。</span></div> : null}
          <Button type="submit" busy={mutation.isPending} disabled={!valid || !changed || !password || mutation.isPending}>
            {mutation.isPending ? "保存中…" : "保存用户名"}
          </Button>
        </form>
      </main>
      <ProductBottomNavigation />
    </div>
  );
}
