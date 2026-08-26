import { ExpenseFeedLoader } from "@/features/expenses/components/expense-loaders";

/** 活动默认页是流水，后续离线层在此处叠加本地待同步行而不改变权威总额。 */
export default function ActivityFeedPage() {
  return <ExpenseFeedLoader />;
}
