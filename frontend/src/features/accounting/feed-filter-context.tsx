import { createContext, useContext, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { emptyFeedFilters, type FeedFilters } from "./feed-filters";

type FeedFilterState = { query: string; searchOpen: boolean; filters: FeedFilters };
const FeedFilterContext = createContext<{ state: FeedFilterState; setState: Dispatch<SetStateAction<FeedFilterState>> } | null>(null);

/** 由活动工作区按账号及活动 key 挂载；嵌套路由往返保留，退出工作区或刷新即丢弃。 */
export function FeedFilterProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<FeedFilterState>(() => ({ query: "", searchOpen: false, filters: emptyFeedFilters() }));
  return <FeedFilterContext.Provider value={{ state, setState }}>{children}</FeedFilterContext.Provider>;
}

export function useFeedFilters() {
  const value = useContext(FeedFilterContext);
  if (!value) throw new Error("流水筛选必须在活动工作区中使用。");
  return value;
}
