/**
 * 将稳定资源 ID 映射到有限视觉资源。不能使用随机值，否则服务端预渲染与客户端 hydration
 * 会产生不同的回退头像或封面；此处的简单哈希在两端均可复现。
 */
export function stableVisualIndex(identifier: string, total: number): number {
  let hash = 0;

  for (const character of identifier) {
    hash = (hash * 31 + character.codePointAt(0)!) >>> 0;
  }

  return hash % total;
}
