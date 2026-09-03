"use client";

import { LoaderCircle, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";

import { AppFrame } from "@/components/design-system/app-frame";
import { Button } from "@/components/ui/button";

type RegistrationPolicy = "INVITE_ONLY" | "OPEN";

async function readData<T>(response: Response): Promise<T> {
  const body = (await response.json()) as { data?: T; error?: { message?: string } };
  if (!response.ok || !body.data) throw new Error(body.error?.message ?? "设置加载失败，请稍后重试。");
  return body.data;
}

/** 系统设置只保留注册策略；邮件配置不属于当前产品范围。 */
export default function AdminSettingsPage() {
  const [policy, setPolicy] = useState<RegistrationPolicy>("INVITE_ONLY");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void fetch("/api/admin/registration-policy", { cache: "no-store" })
      .then(readData<{ policy: RegistrationPolicy }>)
      .then((value) => setPolicy(value.policy))
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "设置加载失败，请稍后重试。"))
      .finally(() => setLoading(false));
  }, []);

  async function savePolicy() {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await readData<{ policy: RegistrationPolicy }>(await fetch("/api/admin/registration-policy", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ policy }),
      }));
      setNotice("注册策略已保存。");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "注册策略保存失败。");
    } finally {
      setSaving(false);
    }
  }

  return (
    <AppFrame wide>
      <section className="py-5">
        <div className="flex items-start gap-3">
          <span className="grid size-11 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"><ShieldCheck className="size-5" aria-hidden="true" /></span>
          <div><h1 className="text-2xl font-bold">系统设置</h1><p className="mt-1 text-sm text-muted-foreground">账号注册策略</p></div>
        </div>
        {loading ? <div className="flex min-h-48 items-center gap-2 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" aria-hidden="true" />正在加载设置…</div> : (
          <div className="mt-7 space-y-5">
            {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
            {notice ? <p role="status" className="text-sm text-primary">{notice}</p> : null}
            <section aria-labelledby="registration-heading" className="border-y py-5">
              <h2 id="registration-heading" className="text-base font-semibold">注册策略</h2>
              <div className="mt-4 grid gap-2 sm:max-w-md sm:grid-cols-2">
                {([ ["INVITE_ONLY", "仅邀请"], ["OPEN", "开放注册"] ] as const).map(([value, label]) => (
                  <label key={value} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-input px-3 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary/5">
                    <input type="radio" name="registration-policy" value={value} checked={policy === value} onChange={() => setPolicy(value)} />{label}
                  </label>
                ))}
              </div>
              <Button className="mt-4" onClick={() => void savePolicy()} disabled={saving}>{saving ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : null}保存注册策略</Button>
            </section>
          </div>
        )}
      </section>
    </AppFrame>
  );
}
