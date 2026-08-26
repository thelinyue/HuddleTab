import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

import { ApplicationError } from "@/server/errors/application-error";

/**
 * 附件字节只保存在部署数据目录的 uploads 子树中。storageKey 来自服务端生成的 UUID，
 * 本类仍在每次读写时校验路径，防止未来调用点误把文件名或客户端输入作为 key 使用。
 */
export class LocalAttachmentStore {
  private readonly root: string;

  constructor(uploadsRoot: string) {
    this.root = resolve(uploadsRoot);
  }

  async read(storageKey: string): Promise<Buffer> {
    return readFile(this.resolveKey(storageKey));
  }

  async write(storageKey: string, bytes: Buffer): Promise<void> {
    const target = this.resolveKey(storageKey);
    await mkdir(dirname(target), { recursive: true });
    const temporary = `${target}.${randomUUID()}.tmp`;
    await writeFile(temporary, bytes, { mode: 0o600 });
    await rename(temporary, target);
  }

  async remove(storageKey: string): Promise<void> {
    await rm(this.resolveKey(storageKey), { force: true });
  }

  private resolveKey(storageKey: string): string {
    const target = resolve(this.root, storageKey);
    const pathWithinRoot = relative(this.root, target);
    if (
      !storageKey ||
      isAbsolute(storageKey) ||
      pathWithinRoot === ".." ||
      pathWithinRoot.startsWith(`..${sep}`) ||
      isAbsolute(pathWithinRoot)
    ) {
      throw new ApplicationError(
        "ATTACHMENT_STORAGE_KEY_INVALID",
        "附件存储路径无效。",
        400,
      );
    }
    return target;
  }
}
