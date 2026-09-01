import { withUserDatabase } from "./database";
import type { PendingExpenseMutation } from "./schema";

type MutationInput = Omit<PendingExpenseMutation, "userId">;

function byCreationOrder(
  left: PendingExpenseMutation,
  right: PendingExpenseMutation,
) {
  return left.createdAt - right.createdAt || left.id.localeCompare(right.id);
}

/** Task 25 只持久化完整记录；状态转换、退避和同步顺序由 Task 26 负责。 */
export class MutationRepository {
  constructor(private readonly userId: string) {}

  async put(input: MutationInput) {
    const record: PendingExpenseMutation = { ...input, userId: this.userId };
    await withUserDatabase(this.userId, (database) =>
      database.put("pending_mutations", record),
    );
    return record;
  }

  get(id: string) {
    return withUserDatabase(this.userId, (database) =>
      database.get("pending_mutations", id),
    );
  }

  async listByActivity(activityId: string) {
    const records = await withUserDatabase(this.userId, (database) =>
      database.getAllFromIndex(
        "pending_mutations",
        "by-activity",
        activityId,
      ),
    );
    return records.sort(byCreationOrder);
  }

  async listAll() {
    const records = await withUserDatabase(this.userId, (database) =>
      database.getAll("pending_mutations"),
    );
    return records.sort(byCreationOrder);
  }
}
