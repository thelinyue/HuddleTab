import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../api/client";
import { mutationHeaders } from "../../api/csrf";
import { unwrap } from "../../api/error";
import type { components } from "../../api/generated/openapi";
import { queryKeys } from "../../api/query-keys";

export type McpToken = components["schemas"]["McpTokenData"];
export type CreateMcpTokenInput = components["schemas"]["CreateMcpTokenRequest"];
export type CreatedMcpToken = components["schemas"]["CreatedMcpTokenData"];

async function listMcpTokens(): Promise<McpToken[]> {
  return unwrap(await apiClient.GET("/api/me/mcp-tokens")).data;
}

export function useMcpTokensQuery(userId: string) {
  return useQuery({
    queryKey: queryKeys.mcpTokens(userId),
    queryFn: listMcpTokens,
    enabled: userId.length > 0,
    retry: false,
  });
}

export function useCreateMcpTokenMutation(userId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateMcpTokenInput): Promise<CreatedMcpToken> =>
      unwrap(await apiClient.POST("/api/me/mcp-tokens", {
        body: input,
        headers: await mutationHeaders(),
      })).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.mcpTokens(userId) }),
  });
}

export function useRevokeMcpTokenMutation(userId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (tokenId: string) => {
      const result = await apiClient.DELETE("/api/me/mcp-tokens/{token_id}", {
        params: { path: { token_id: tokenId } },
        headers: await mutationHeaders(),
      });
      // 撤销接口成功时返回 204，没有 JSON data；只有其他状态才需要解包错误。
      if (result.response.status !== 204) unwrap(result);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.mcpTokens(userId) }),
  });
}
