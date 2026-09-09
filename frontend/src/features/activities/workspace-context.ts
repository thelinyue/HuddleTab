import { createContext, useContext } from "react";
import type { Activity, ActivityMember } from "./api";
import type { Session } from "../auth/api";
import type { useActivitySnapshotQuery } from "./offline-workspace";

/** 工作区和各业务页面共用唯一 Context；此模块不依赖页面实现，避免消费者反向加载整页。 */
type WorkspaceValue = {
  session: Session;
  activity: Activity;
  members: ActivityMember[];
  offline: boolean;
  snapshot?: ReturnType<typeof useActivitySnapshotQuery>["data"];
};
export const WorkspaceContext = createContext<WorkspaceValue | null>(null);

export function useWorkspace(): WorkspaceValue {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error("活动页面必须在 ActivityWorkspace 中使用。");
  return value;
}
