import { SettlementPageLoader } from "@/features/settlements/components/settlement-page-loader";

/** 活动结算页仅承载客户端加载器，账务事实和权限始终由 API 服务端复验。 */
export default function SettlementsPage() {
  return <SettlementPageLoader timeZone={process.env.TZ ?? "Asia/Shanghai"} />;
}
