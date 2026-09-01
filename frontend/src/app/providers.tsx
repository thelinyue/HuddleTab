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
    const clearAuthenticatedState = async () => {
      clearCsrfToken();
      // 先取消精确的 Session 查询，避免旧请求在匿名状态发布后把已失效用户写回缓存。
      await queryClient.cancelQueries({ queryKey: queryKeys.session, exact: true });
      queryClient.setQueryData(queryKeys.session, null);
      const sessionQuery = queryClient.getQueryCache().find({
        queryKey: queryKeys.session,
        exact: true,
      });
      queryClient.removeQueries({ predicate: (query) => query !== sessionQuery });
    };
    const handleAuthenticatedStateExpired = () => {
      void clearAuthenticatedState();
    };
    window.addEventListener(AUTH_EXPIRED_EVENT, handleAuthenticatedStateExpired);
    return () => window.removeEventListener(
      AUTH_EXPIRED_EVENT,
      handleAuthenticatedStateExpired,
    );
  }, [queryClient]);

  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}
