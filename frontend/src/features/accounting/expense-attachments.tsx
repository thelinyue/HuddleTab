import { Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { ExpenseAggregate } from "./api";

/** 账单附件展示与本地预览；上传、草稿和删除确认仍由编辑器管理。 */
export const attachmentAccept =
  ".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp";
const attachmentMimeTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);
const maxAttachmentBytes = 10 * 1024 * 1024;

function attachmentUrl(
  activityId: string,
  expenseId: string,
  attachmentId: string,
) {
  return `/api/activities/${encodeURIComponent(activityId)}/expenses/${encodeURIComponent(expenseId)}/attachments/${encodeURIComponent(attachmentId)}`;
}

export function validateAttachments(files: readonly File[]) {
  if (files.length > 3) return "每笔账单最多添加三张附件。";
  if (files.some((file) => !attachmentMimeTypes.has(file.type))) {
    return "仅支持 JPEG、PNG 或 WebP 图片。";
  }
  if (files.some((file) => file.size > maxAttachmentBytes)) {
    return "单张附件不能超过 10 MiB。";
  }
}

/** 缩略图始终请求受权下载路由，不接触本地 Blob URL 或服务端存储路径。 */
export function ExpenseAttachments({
  activityId,
  expenseId,
  attachments,
  deletingAttachmentId,
  onDelete,
}: {
  activityId: string;
  expenseId: string;
  attachments: ExpenseAggregate["attachments"];
  deletingAttachmentId?: string;
  onDelete?: (attachmentId: string) => void;
}) {
  if (attachments.length === 0) return null;
  return (
    <section className="expense-attachments" aria-labelledby="expense-attachments-heading">
      <h2 id="expense-attachments-heading">附件</h2>
      <div className="expense-attachments__grid">
        {attachments.map((attachment, index) => {
          const href = attachmentUrl(activityId, expenseId, attachment.id);
          return (
            <div className="expense-attachments__item" key={attachment.id}>
              <a
                href={href}
                target="_blank"
                rel="noreferrer"
                aria-label={`查看附件 ${index + 1}`}
              >
                <img
                  src={href}
                  alt={`附件 ${index + 1}`}
                  loading="lazy"
                  width={attachment.width}
                  height={attachment.height}
                />
              </a>
              {onDelete ? <button
                type="button"
                className="expense-attachments__delete"
                aria-label={`删除附件 ${index + 1}`}
                title={`删除附件 ${index + 1}`}
                disabled={deletingAttachmentId === attachment.id}
                onClick={() => onDelete(attachment.id)}
              ><Trash2 aria-hidden="true" size={16} /></button> : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function SelectedAttachmentPreviews({
  files,
  onRemove,
}: {
  files: readonly File[];
  onRemove: (index: number) => void;
}) {
  const [previews, setPreviews] = useState<Array<{ file: File; url: string }>>([]);
  const [previewedFile, setPreviewedFile] = useState<File>();

  useEffect(() => {
    const next = files.map((file) => ({ file, url: URL.createObjectURL(file) }));
    setPreviews(next);
    // 本地原图只在当前表单存活，附件变化或离开页面时必须释放浏览器资源。
    return () => next.forEach(({ url }) => URL.revokeObjectURL(url));
  }, [files]);

  const activePreview = previews.find(({ file }) => file === previewedFile);
  if (previews.length === 0) return null;
  return (
    <>
      <div className="selected-attachments" aria-label="已选择的附件">
        {previews.map(({ file, url }, index) => (
          <div className="selected-attachments__item" key={`${file.name}-${file.size}-${file.lastModified}-${index}`}>
            <button
              type="button"
              className="selected-attachments__preview"
              aria-label={`预览附件 ${file.name}`}
              onClick={() => setPreviewedFile(file)}
            >
              <img src={url} alt={`${file.name} 缩略图`} />
            </button>
            <button
              type="button"
              className="selected-attachments__remove"
              aria-label={`移除附件 ${file.name}`}
              title={`移除附件 ${file.name}`}
              onClick={() => onRemove(index)}
            >
              <X aria-hidden="true" size={16} />
            </button>
          </div>
        ))}
      </div>
      {activePreview ? (
        <div className="attachment-lightbox" role="presentation" onKeyDown={(event) => {
          if (event.key === "Escape") setPreviewedFile(undefined);
        }}>
          <button
            type="button"
            className="attachment-lightbox__scrim"
            aria-label="关闭大图预览背景"
            onClick={() => setPreviewedFile(undefined)}
          />
          <section
            className="attachment-lightbox__dialog"
            role="dialog"
            aria-modal="true"
            aria-label={`附件大图预览 ${activePreview.file.name}`}
          >
            <img src={activePreview.url} alt={activePreview.file.name} />
            <button
              type="button"
              className="attachment-lightbox__close"
              aria-label="关闭附件预览"
              autoFocus
              onClick={() => setPreviewedFile(undefined)}
            >
              <X aria-hidden="true" size={20} />
            </button>
          </section>
        </div>
      ) : null}
    </>
  );
}
