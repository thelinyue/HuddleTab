/** Serwist 仅缓存 App Shell 与静态资源；账务同步由可见前台应用独占。 */
export const BUSINESS_SYNC_OWNER = "FOREGROUND_APP" as const;
