import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type PropsWithChildren, useEffect, useState } from "react";
import { AUTH_EXPIRED_EVENT } from "../api/client";
import { clearCsrfToken } from "../api/csrf";
import { ApiRequestError } from "../api/error";
import { queryKeys } from "../api/query-keys";

export function AppProviders({ children }: PropsWithChildren) {
  // 每个已挂载应用只持有一个 QueryClient，避免 React 重渲染清空服务器状态。
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: (failureCount, error) =>
              !(error instanceof ApiRequestError && error.status < 500) &&
              failureCount < 1,
            staleTime: 30_000,
          },
          mutations: { retry: false },
        },
      }),
  );

  useEffect(() => {
    const clearAuthenticatedState = () => {
      clearCsrfToken();
      // 活跃 observer 不会因 clear 自动丢弃旧 data，必须先发布匿名 Session，再删除其他用户缓存。
      queryClient.setQueryData(queryKeys.session, null);
      const sessionQuery = queryClient.getQueryCache().find({
        queryKey: queryKeys.session,
        exact: true,
      });
      queryClient.removeQueries({ predicate: (query) => query !== sessionQuery });
    };
    window.addEventListener(AUTH_EXPIRED_EVENT, clearAuthenticatedState);
    return () =>
      window.removeEventListener(AUTH_EXPIRED_EVENT, clearAuthenticatedState);
  }, [queryClient]);

  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}
