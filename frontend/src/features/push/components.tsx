import { BellRing, Check } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Overlay } from "../../components/overlay";
import { Button, ErrorNotice, LoadingState } from "../../components/ui";
import {
  canUsePush,
  currentPushSubscription,
  disablePush,
  enablePush,
  isPushRegisteredForUser,
  type PushPreferences,
  usePushSettingsQuery,
  useUpdatePushPreferencesMutation,
} from "./api";

const promptStoragePrefix = "huddletab:push-prompt-dismissed:";

const preferenceItems: Array<{ key: keyof PushPreferences; title: string; description: string }> = [
  { key: "membership", title: "成员与审批", description: "加入申请、成员变更和活动权限" },
  { key: "expense", title: "账单变化", description: "新增、修改和删除账单" },
  { key: "settlement", title: "结算到账", description: "结算状态和到账提醒" },
  { key: "activity", title: "活动与权限", description: "活动状态、所有权和权限变化" },
];

function pushStatus(settings: ReturnType<typeof usePushSettingsQuery>, subscription: PushSubscription | null): string {
  if (settings.isPending) return "正在读取…";
  if (settings.error) return "暂不可用";
  if (!settings.data?.available) return "服务器未启用";
  return subscription ? "已开启" : "未开启";
}

/** 我的页面中的推送入口；设备授权与账号同步的分类偏好在同一处管理。 */
export function PushSettingsControl({ userId }: { userId: string }) {
  const settings = usePushSettingsQuery(userId);
  const updatePreferences = useUpdatePushPreferencesMutation(userId);
  const [open, setOpen] = useState(false);
  const [subscription, setSubscription] = useState<PushSubscription | null>(null);
  const [actionError, setActionError] = useState<unknown>(null);
  const [deviceBusy, setDeviceBusy] = useState(false);

  useEffect(() => {
    if (!canUsePush()) return;
    let active = true;
    void currentPushSubscription()
      .then((value) => { if (active) setSubscription(value && isPushRegisteredForUser(userId) ? value : null); })
      .catch((error) => { if (active) setActionError(error); });
    return () => { active = false; };
  }, [open, userId]);

  async function toggleDevice() {
    if (deviceBusy) return;
    setActionError(null);
    setDeviceBusy(true);
    try {
      if (subscription) {
        await disablePush(userId);
        setSubscription(null);
      } else if (settings.data?.applicationServerKey) {
        setSubscription(await enablePush(settings.data.applicationServerKey, userId));
      }
    } catch (error) {
      setActionError(error);
    } finally {
      setDeviceBusy(false);
    }
  }

  async function togglePreference(key: keyof PushPreferences) {
    if (!settings.data || updatePreferences.isPending) return;
    setActionError(null);
    try {
      await updatePreferences.mutateAsync({ ...settings.data.preferences, [key]: !settings.data.preferences[key] });
    } catch (error) {
      setActionError(error);
    }
  }

  const data = settings.data;
  const browserUnavailable = !canUsePush();
  const permissionDenied = typeof Notification !== "undefined" && Notification.permission === "denied";
  return (
    <>
      <button className="settings-link" type="button" aria-label={`系统推送：${pushStatus(settings, subscription)}`} onClick={() => { setActionError(null); setOpen(true); }}>
        <BellRing aria-hidden="true" size={18} />
        <span><strong>系统推送</strong><small>在浏览器关闭时也能收到重要通知</small></span>
        <span className="settings-link__value">{pushStatus(settings, subscription)}</span>
      </button>
      <Overlay open={open} title="系统推送" onClose={() => setOpen(false)} focusKey={open ? "push-settings" : "closed"}>
        <div className="push-settings-panel">
          {settings.isPending ? <LoadingState label="正在读取推送设置…" /> : null}
          {settings.error ? <ErrorNotice error={settings.error} /> : null}
          {!settings.isPending && !settings.error && !data?.available ? <div className="notice"><BellRing aria-hidden="true" size={18} /><span>服务器尚未配置推送服务，请联系管理员。</span></div> : null}
          {!settings.isPending && !settings.error && data?.available && browserUnavailable ? <div className="notice"><BellRing aria-hidden="true" size={18} /><span>当前环境不支持系统推送。请使用 HTTPS；iPhone 或 iPad 需要先将伙记添加到主屏幕。</span></div> : null}
          {!settings.isPending && !settings.error && data?.available && !browserUnavailable && permissionDenied ? <div className="notice"><BellRing aria-hidden="true" size={18} /><span>通知权限已拒绝，请在浏览器或系统设置中允许伙记发送通知。</span></div> : null}
          {!settings.isPending && !settings.error && data?.available ? (
            <>
              {!browserUnavailable && !permissionDenied ? <div className="push-device-actions">
                <div><strong>{subscription ? "此设备已开启推送" : "开启此设备的推送"}</strong><small>系统通知会在后台送达；退出登录时只解除当前账号关联。</small></div>
                <Button data-overlay-initial-focus variant={subscription ? "secondary" : "primary"} busy={deviceBusy} onClick={() => void toggleDevice()}>{subscription ? "关闭" : "开启"}</Button>
              </div> : null}
              <div className="push-settings-note">可单独关闭某类通知，偏好会同步到当前账号的所有设备。</div>
              <div className="push-preference-list" aria-label="通知分类">
                {preferenceItems.map((item) => {
                  const checked = data.preferences[item.key];
                  return (
                    <button key={item.key} className="push-preference-row" type="button" role="switch" aria-checked={checked} disabled={updatePreferences.isPending} onClick={() => void togglePreference(item.key)}>
                      <span><strong>{item.title}</strong><small>{item.description}</small></span>
                      <span className="push-switch" aria-hidden="true">{checked ? <Check size={14} /> : null}</span>
                    </button>
                  );
                })}
              </div>
            </>
          ) : null}
          {actionError ? <ErrorNotice error={actionError} /> : null}
          {updatePreferences.error && !actionError ? <ErrorNotice error={updatePreferences.error} /> : null}
        </div>
      </Overlay>
    </>
  );
}

/** 活动列表的首次轻提示；永久设置仍保留在“我的”，避免把授权藏在一次性卡片里。 */
export function PushPromptCard({ userId }: { userId: string }) {
  const settings = usePushSettingsQuery(userId);
  const [dismissed, setDismissed] = useState(false);
  const [subscription, setSubscription] = useState<PushSubscription | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (!userId || typeof window === "undefined") return;
    try {
      setDismissed(window.localStorage.getItem(`${promptStoragePrefix}${userId}`) === "1");
    } catch {
      setDismissed(false);
    }
  }, [userId]);

  useEffect(() => {
    if (!settings.data?.available || !canUsePush()) return;
    let active = true;
    void currentPushSubscription().then((value) => { if (active) setSubscription(value && isPushRegisteredForUser(userId) ? value : null); }).catch(() => undefined);
    return () => { active = false; };
  }, [settings.data?.available, userId]);

  if (settings.isPending || settings.error || dismissed || subscription || !settings.data?.available || !settings.data.applicationServerKey || !canUsePush()) return null;

  async function enable() {
    setError(null);
    try {
      setSubscription(await enablePush(settings.data!.applicationServerKey!, userId));
    } catch (nextError) {
      setError(nextError);
    }
  }

  function dismiss() {
    try {
      window.localStorage.setItem(`${promptStoragePrefix}${userId}`, "1");
    } catch {
      // 隐私模式禁用存储时仍立即隐藏本次提示，下一次打开可能再次出现。
    }
    setDismissed(true);
  }

  return (
    <aside className="push-prompt-card" role="status">
      <div className="push-prompt-card__icon"><BellRing aria-hidden="true" size={20} /></div>
      <div className="push-prompt-card__content"><strong>及时收到活动通知</strong><p>成员审批、账单变化和结算提醒会在系统通知中提示。</p></div>
      <div className="push-prompt-card__actions">
        <Button onClick={() => void enable()}>开启推送</Button>
        <Link className="button button--secondary" to="/me">去设置</Link>
        <button className="push-prompt-card__dismiss" type="button" onClick={dismiss}>稍后再说</button>
      </div>
      {error ? <ErrorNotice error={error} /> : null}
    </aside>
  );
}
