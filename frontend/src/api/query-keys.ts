export const queryKeys = {
  session: ["session"] as const,
  activities: (userId: string) => ["users", userId, "activities"] as const,
  activity: (userId: string, activityId: string) =>
    ["users", userId, "activities", activityId] as const,
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
  invitationPreview: (token: string) => ["invitations", token] as const,
};
