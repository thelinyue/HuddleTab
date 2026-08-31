import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type PropsWithChildren, useEffect, useState } from "react";
import { AUTH_EXPIRED_EVENT } from "../api/client";
import { ApiRequestError } from "../api/error";

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
    const clearAuthenticatedState = () => queryClient.clear();
    window.addEventListener(AUTH_EXPIRED_EVENT, clearAuthenticatedState);
    return () =>
      window.removeEventListener(AUTH_EXPIRED_EVENT, clearAuthenticatedState);
  }, [queryClient]);

  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}
