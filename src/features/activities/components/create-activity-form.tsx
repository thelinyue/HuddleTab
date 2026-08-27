"use client";

import { type FormEvent, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** 活动创建表单只收集现有 API 契约字段，成功后整页进入新活动的流水页。 */
export function CreateActivityForm() {
  const [error, setError] = useState<string | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(null);
    const form = new FormData(event.currentTarget);
    const startDate = String(form.get("startDate"));
    const endDate = String(form.get("endDate") ?? "");
    if (endDate && endDate < startDate) { setError("结束日期不能早于开始日期。"); return; }
    const response = await fetch("/api/activities", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: String(form.get("name")), location: String(form.get("location") ?? "") || undefined, baseCurrency: String(form.get("baseCurrency")).toUpperCase(), startDate, endDate: endDate || undefined }) });
    const body = await response.json().catch(() => undefined) as { data?: { id?: string }; error?: { message?: string } } | undefined;
    if (!response.ok || !body?.data?.id) { setError(body?.error?.message ?? "创建活动失败，请稍后重试。"); return; }
    window.location.assign(new URL(`/activities/${body.data.id}`, window.location.origin).toString());
  }
  return <form className="grid gap-4" onSubmit={(event) => void submit(event)}><Field id="name" label="活动名称" /><Field id="location" label="地点" required={false} /><Field id="baseCurrency" label="主币种" defaultValue="CNY" /><Field id="startDate" label="开始日期" type="date" defaultValue={new Date().toISOString().slice(0, 10)} /><Field id="endDate" label="结束日期" type="date" required={false} />{error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}<Button type="submit" size="lg">创建活动</Button></form>;
}

function Field({ id, label, type = "text", required = true, defaultValue }: { readonly id: string; readonly label: string; readonly type?: "text" | "date"; readonly required?: boolean; readonly defaultValue?: string }) { return <div className="grid gap-2"><Label htmlFor={`activity-${id}`}>{label}</Label><Input id={`activity-${id}`} name={id} type={type} required={required} defaultValue={defaultValue} /></div>; }
