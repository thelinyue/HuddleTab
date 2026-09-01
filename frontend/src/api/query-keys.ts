export const queryKeys = {
  session: ["session"] as const,
  activitiesCurrent: (userId: string) =>
    ["users", userId, "activities", "current"] as const,
  activitiesDeleted: (userId: string) =>
    ["users", userId, "activities", "deleted"] as const,
  activityDetail: (userId: string, activityId: string) =>
    ["users", userId, "activities", "detail", activityId] as const,
  members: (userId: string, activityId: string) =>
    ["users", userId, "activities", activityId, "members"] as const,
  invitations: (userId: string, activityId: string) =>
    ["users", userId, "activities", activityId, "invitations"] as const,
  expenses: (userId: string, activityId: string) =>
    ["users", userId, "activities", activityId, "expenses"] as const,
  expense: (userId: string, activityId: string, expenseId: string) =>
    ["users", userId, "activities", activityId, "expenses", expenseId] as const,
  ledger: (userId: string, activityId: string) =>
    ["users", userId, "activities", activityId, "ledger"] as const,
  recommendations: (userId: string, activityId: string) =>
    ["users", userId, "activities", activityId, "recommendations"] as const,
  settlements: (userId: string, activityId: string) =>
    ["users", userId, "activities", activityId, "settlements"] as const,
  activitySummary: (userId: string, activityId: string) =>
    ["users", userId, "activities", activityId, "summary"] as const,
  invitationPreview: (token: string) => ["invitations", token] as const,
};
