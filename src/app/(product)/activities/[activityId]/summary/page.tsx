import { ActivitySummaryLoader } from "@/features/activities/components/activity-summary-page";

export default async function ActivitySummaryRoute({
  params,
}: {
  readonly params: Promise<{ activityId: string }>;
}) {
  return <ActivitySummaryLoader activityId={(await params).activityId} />;
}
