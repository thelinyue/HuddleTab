import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../api/client";
import { mutationHeaders } from "../../api/csrf";
import { unwrap } from "../../api/error";
import type { components } from "../../api/generated/openapi";
import { queryKeys } from "../../api/query-keys";

export type PushSettings = components["schemas"]["PushSettingsData"];
export type PushPreferences = components["schemas"]["PushPreferencesData"];

const pushCapabilityMessage = "当前浏览器或运行环境不支持系统推送。";
const pushOwnerStorageKey = "huddletab:push-owner";

function isStandaloneDisplay(): boolean {
  const legacyStandalone = (navigator as Navigator & { standalone?: boolean }).standalone;
  return legacyStandalone === true
    || (typeof window.matchMedia === "function" && window.matchMedia("(display-mode: standalone)").matches);
}

function isAppleMobileBrowserWithoutPwa(): boolean {
  const platform = navigator.platform ?? "";
  const userAgent = navigator.userAgent ?? "";
  const appleMobile = /iPhone|iPad|iPod/.test(userAgent)
    || (platform === "MacIntel" && navigator.maxTouchPoints > 1);
  return appleMobile && !isStandaloneDisplay();
}

export function canUsePush(): boolean {
  return typeof window !== "undefined"
    && window.isSecureContext
    && "serviceWorker" in navigator
    && "PushManager" in window
    && "Notification" in window
    && !isAppleMobileBrowserWithoutPwa();
}

async function loadPushSettings(): Promise<PushSettings> {
  return unwrap(await apiClient.GET("/api/me/push-settings")).data;
}

async function updatePushPreferences(preferences: PushPreferences): Promise<PushSettings> {
  const headers = await mutationHeaders();
  return unwrap(
    await apiClient.PUT("/api/me/push-settings", {
      params: { header: { "x-csrf-token": headers["X-CSRF-Token"] } },
      body: preferences,
    }),
  ).data;
}

function setPushOwner(userId: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (userId) window.localStorage.setItem(pushOwnerStorageKey, userId);
    else window.localStorage.removeItem(pushOwnerStorageKey);
  } catch {
    // 隐私模式可能禁用 localStorage；服务端登记仍然有效，页面状态只退化为未确认。
  }
}

function pushOwner(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(pushOwnerStorageKey);
  } catch {
    return null;
  }
}

export function isPushRegisteredForUser(userId: string): boolean {
  return userId.length > 0 && pushOwner() === userId;
}

function assertPushCapability(): void {
  if (!canUsePush()) {
    throw new Error(pushCapabilityMessage);
  }
}

export async function currentPushSubscription(): Promise<PushSubscription | null> {
  if (!canUsePush()) return null;
  const registration = await navigator.serviceWorker.ready;
  return registration.pushManager.getSubscription();
}

function base64ToBytes(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = window.atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function subscriptionBody(subscription: PushSubscription): components["schemas"]["PushSubscriptionRequest"] {
  const json = subscription.toJSON();
  const p256dh = json.keys?.p256dh;
  const auth = json.keys?.auth;
  if (!p256dh || !auth) throw new Error("浏览器返回的推送密钥不完整，请重试。");
  return {
    endpoint: subscription.endpoint,
    expirationTime: subscription.expirationTime,
    keys: { p256dh, auth },
  };
}

async function registerSubscription(subscription: PushSubscription): Promise<void> {
  const headers = await mutationHeaders();
  unwrap(await apiClient.POST("/api/me/push-subscriptions", {
    params: { header: { "x-csrf-token": headers["X-CSRF-Token"] } },
    body: subscriptionBody(subscription),
  }));
}

export async function enablePush(applicationServerKey: string, userId: string): Promise<PushSubscription> {
  assertPushCapability();
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error(permission === "denied" ? "通知权限已拒绝，请在浏览器或系统设置中允许伙记发送通知。" : "通知权限尚未授予。");
  }
  const registration = await navigator.serviceWorker.ready;
  const current = await registration.pushManager.getSubscription();
  const subscription = current ?? await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: base64ToBytes(applicationServerKey).buffer as ArrayBuffer,
  });
  await registerSubscription(subscription);
  setPushOwner(userId);
  return subscription;
}

export async function disablePush(userId: string): Promise<void> {
  assertPushCapability();
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    if (pushOwner() === userId) setPushOwner(null);
    return;
  }
  const headers = await mutationHeaders();
  unwrap(await apiClient.DELETE("/api/me/push-subscriptions", {
    params: { header: { "x-csrf-token": headers["X-CSRF-Token"] } },
    body: { endpoint: subscription.endpoint },
  }));
  if (pushOwner() === userId) setPushOwner(null);
  await subscription.unsubscribe();
}

/** 同一账号重新登录时复用已获系统授权的浏览器订阅；不同账号不会静默开启推送。 */
export async function attachPushForLogin(userId: string): Promise<void> {
  if (!isPushRegisteredForUser(userId) || !canUsePush()) return;
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  try {
    const subscription = await currentPushSubscription();
    if (subscription) await registerSubscription(subscription);
    else setPushOwner(null);
  } catch {
    // 登录不应被推送服务短暂不可用阻塞；用户仍可在“我的”中手动重试。
    if (pushOwner() === userId) setPushOwner(null);
  }
}

/** 退出登录前解除服务端设备关联，但保留浏览器权限，避免下次同账号登录再次弹系统授权。 */
export async function detachPushForLogout(): Promise<void> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (!subscription) return;
    const headers = await mutationHeaders();
    unwrap(await apiClient.DELETE("/api/me/push-subscriptions", {
      params: { header: { "x-csrf-token": headers["X-CSRF-Token"] } },
      body: { endpoint: subscription.endpoint },
    }));
  } catch {
    // 退出登录仍需继续；服务端 Session 失效后该设备无法再领取推送任务。
  }
}

export function usePushSettingsQuery(userId: string) {
  return useQuery({
    queryKey: queryKeys.pushSettings(userId),
    queryFn: loadPushSettings,
    enabled: userId.length > 0,
  });
}

export function useUpdatePushPreferencesMutation(userId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updatePushPreferences,
    onSuccess: (settings) => queryClient.setQueryData(queryKeys.pushSettings(userId), settings),
  });
}
