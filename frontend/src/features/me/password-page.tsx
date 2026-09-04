import { ArrowLeft, CheckCircle2 } from "lucide-react";
import { type FormEvent, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { errorMessage } from "../../api/error";
import { ProductBottomNavigation } from "../../components/product-bottom-navigation";
import { Button, ErrorNotice, Input } from "../../components/ui";
import { useChangePasswordMutation } from "../auth/api";

const PASSWORD_MISMATCH = "新密码与确认密码不一致。";

/** 独立账户页保留当前登录；改密后的 Session 与 CSRF 轮换由 auth adapter 统一处理。 */
export function ChangePasswordPage() {
  const mutation = useChangePasswordMutation();
  const submittingRef = useRef(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmedPassword, setConfirmedPassword] = useState("");
  const [saveError, setSaveError] = useState<string>();
  const [successNotice, setSuccessNotice] = useState<string>();
  const [submitting, setSubmitting] = useState(false);
  const passwordsMismatch = saveError === PASSWORD_MISMATCH;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submittingRef.current) return;
    if (newPassword !== confirmedPassword) {
      setSaveError(PASSWORD_MISMATCH);
      setSuccessNotice(undefined);
      return;
    }

    submittingRef.current = true;
    setSubmitting(true);
    setSaveError(undefined);
    setSuccessNotice(undefined);
    try {
      await mutation.mutateAsync({ currentPassword, newPassword });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmedPassword("");
      setSuccessNotice("密码已修改。");
    } catch (reason) {
      setSaveError(errorMessage(reason));
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  return (
    <div className="top-level-page">
      <main className="app-frame app-frame--with-nav">
        <header className="me-subpage-header">
          <Link className="icon-button" to="/me" aria-label="返回我的" title="返回我的">
            <ArrowLeft aria-hidden="true" size={20} />
          </Link>
          <h1>修改密码</h1>
          <span aria-hidden="true" />
        </header>

        <form className="password-form" onSubmit={(event) => void submit(event)}>
          <div className="field">
            <label className="field__label" htmlFor="account-current-password">当前密码</label>
            <Input
              id="account-current-password"
              type="password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              autoComplete="current-password"
              minLength={8}
              maxLength={128}
              required
              aria-invalid={saveError && !passwordsMismatch ? true : undefined}
              aria-describedby={saveError && !passwordsMismatch ? "password-error" : undefined}
            />
          </div>
          <div className="field">
            <label className="field__label" htmlFor="account-new-password">新密码</label>
            <Input
              id="account-new-password"
              type="password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              autoComplete="new-password"
              minLength={8}
              maxLength={128}
              required
              aria-invalid={saveError ? true : undefined}
              aria-describedby={saveError ? "new-password-hint password-error" : "new-password-hint"}
            />
            <span className="field__hint" id="new-password-hint">
              8–128 个字符，可以使用密码管理器生成和粘贴。
            </span>
          </div>
          <div className="field">
            <label className="field__label" htmlFor="account-confirm-password">确认新密码</label>
            <Input
              id="account-confirm-password"
              type="password"
              value={confirmedPassword}
              onChange={(event) => setConfirmedPassword(event.target.value)}
              autoComplete="new-password"
              minLength={8}
              maxLength={128}
              required
              aria-invalid={saveError ? true : undefined}
              aria-describedby={saveError ? "password-error" : undefined}
            />
          </div>

          {saveError ? <div id="password-error"><ErrorNotice error={new Error(saveError)} /></div> : null}
          {successNotice ? (
            <div className="notice notice--success" role="status">
              <CheckCircle2 aria-hidden="true" size={18} />
              <span>{successNotice}</span>
            </div>
          ) : null}
          <Button type="submit" busy={submitting}>
            {submitting ? "修改中…" : "确认修改"}
          </Button>
        </form>
      </main>
      <ProductBottomNavigation />
    </div>
  );
}
