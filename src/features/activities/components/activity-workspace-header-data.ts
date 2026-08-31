/**
 * Activity Workspace 头部只依赖这组已授权的展示事实。加载器保留各自的数据请求边界，
 * 不让工作台为了页头再发一次请求，也避免结算和流水各自维护一套页头 DOM。
 */
export type ActivityWorkspaceHeaderData = {
  readonly activityId: string;
  readonly name: string;
  readonly startDate: string | null;
  readonly endDate: string | null;
  readonly memberCount: number;
  readonly status: "ACTIVE" | "ENDED" | "ARCHIVED";
};
