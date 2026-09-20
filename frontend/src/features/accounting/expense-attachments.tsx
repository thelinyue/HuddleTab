import { Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { ExpenseAggregate } from "./api";

/** 账单图片展示与本地预览；上传、草稿和删除确认仍由编辑器管理。 */
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
  variant?: "thumbnail",
) {
  const path = `/api/activities/${encodeURIComponent(activityId)}/expenses/${encodeURIComponent(expenseId)}/attachments/${encodeURIComponent(attachmentId)}`;
  return variant ? `${path}?variant=${variant}` : path;
}

export function validateAttachments(files: readonly File[]) {
  if (files.length > 3) return "每笔账单最多添加三张图片。";
  if (files.some((file) => !attachmentMimeTypes.has(file.type))) {
    return "仅支持 JPEG、PNG 或 WebP 图片。";
  }
  if (files.some((file) => file.size > maxAttachmentBytes)) {
    return "单张图片不能超过 10 MiB。";
  }
}

/**
 * 图片卡片只请求缩略图；点击后在当前页面渐进加载完整图片，避免打开新标签
 * 时再次把完整图片作为首屏资源下载。完整 URL 仍保留在链接上，便于打开原图。
 */
export function ExpenseAttachments({
  activityId,
  expenseId,
  attachments,
  deletingAttachmentId,
  onDelete,
  compact = false,
}: {
  activityId: string;
  expenseId: string;
  attachments: ExpenseAggregate["attachments"];
  deletingAttachmentId?: string;
  onDelete?: (attachmentId: string) => void;
  compact?: boolean;
}) {
  const [activeIndex, setActiveIndex] = useState<number>();
  const [fullImageLoaded, setFullImageLoaded] = useState(false);
  const activeAttachment = activeIndex === undefined ? undefined : attachments[activeIndex];

  useEffect(() => {
    setFullImageLoaded(false);
  }, [activeAttachment?.id]);

  if (attachments.length === 0) return null;
  return (
    <>
      <section className={`expense-attachments${compact ? " expense-attachments--compact" : ""}`} aria-labelledby="expense-attachments-heading">
        <h2 id="expense-attachments-heading">图片</h2>
        <div className="expense-attachments__grid">
          {attachments.map((attachment, index) => {
            const href = attachmentUrl(activityId, expenseId, attachment.id);
            const thumbnailHref = attachmentUrl(activityId, expenseId, attachment.id, "thumbnail");
            return (
              <div className="expense-attachments__item" key={attachment.id}>
                <a
                  href={href}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={`查看图片 ${index + 1}`}
                  onClick={(event) => {
                    event.preventDefault();
                    setActiveIndex(index);
                  }}
                >
                  <img
                    src={thumbnailHref}
                    alt={`图片 ${index + 1}`}
                    loading="lazy"
                    width={Math.min(attachment.width, 320)}
                    height={Math.min(attachment.height, 320)}
                  />
                </a>
                {onDelete ? <button
                  type="button"
                  className="expense-attachments__delete"
                  aria-label={`删除图片 ${index + 1}`}
                  title={`删除图片 ${index + 1}`}
                  disabled={deletingAttachmentId === attachment.id}
                  onClick={() => onDelete(attachment.id)}
                ><Trash2 aria-hidden="true" size={16} /></button> : null}
              </div>
            );
          })}
        </div>
      </section>
      {activeAttachment && activeIndex !== undefined ? (
        <div className="attachment-lightbox" role="presentation" onKeyDown={(event) => {
          if (event.key === "Escape") setActiveIndex(undefined);
        }}>
          <button
            type="button"
            className="attachment-lightbox__scrim"
            aria-label="关闭图片预览背景"
            onClick={() => setActiveIndex(undefined)}
          />
          <section
            className="attachment-lightbox__dialog"
            role="dialog"
            aria-modal="true"
            aria-label={`图片大图预览 ${activeIndex + 1}`}
          >
            <div className="attachment-lightbox__stage">
              {!fullImageLoaded ? <img
                className="attachment-lightbox__placeholder"
                src={attachmentUrl(activityId, expenseId, activeAttachment.id, "thumbnail")}
                alt=""
                aria-hidden="true"
              /> : null}
              <img
                className={`attachment-lightbox__full${fullImageLoaded ? " attachment-lightbox__full--loaded" : ""}`}
                src={attachmentUrl(activityId, expenseId, activeAttachment.id)}
                alt={`图片 ${activeIndex + 1}`}
                onLoad={() => setFullImageLoaded(true)}
              />
              {!fullImageLoaded ? <span className="attachment-lightbox__loading" role="status">正在加载原图…</span> : null}
            </div>
            <a
              className="attachment-lightbox__original"
              href={attachmentUrl(activityId, expenseId, activeAttachment.id)}
              target="_blank"
              rel="noreferrer"
            >打开原图</a>
            <button
              type="button"
              className="attachment-lightbox__close"
              aria-label="关闭图片预览"
              autoFocus
              onClick={() => setActiveIndex(undefined)}
            >
              <X aria-hidden="true" size={20} />
            </button>
          </section>
        </div>
      ) : null}
    </>
  );
}

export function SelectedAttachmentPreviews({
  files,
  onRemove,
  disabled = false,
}: {
  files: readonly File[];
  onRemove: (index: number) => void;
  disabled?: boolean;
}) {
  const [previews, setPreviews] = useState<Array<{ file: File; url: string }>>([]);
  const [previewedFile, setPreviewedFile] = useState<File>();

  useEffect(() => {
    const next = files.map((file) => ({ file, url: URL.createObjectURL(file) }));
    setPreviews(next);
    // 本地原图只在当前表单存活，图片变化或离开页面时必须释放浏览器资源。
    return () => next.forEach(({ url }) => URL.revokeObjectURL(url));
  }, [files]);

  const activePreview = previews.find(({ file }) => file === previewedFile);
  if (previews.length === 0) return null;
  return (
    <>
      <div className="selected-attachments" aria-label="已选择的图片">
        {previews.map(({ file, url }, index) => (
          <div className="selected-attachments__item" key={`${file.name}-${file.size}-${file.lastModified}-${index}`}>
            <button
              type="button"
              className="selected-attachments__preview"
              aria-label={`预览图片 ${file.name}`}
              onClick={() => setPreviewedFile(file)}
            >
              <img src={url} alt={`${file.name} 图片缩略图`} />
            </button>
            <button
              type="button"
              className="selected-attachments__remove"
              aria-label={`移除图片 ${file.name}`}
              title={`移除图片 ${file.name}`}
              disabled={disabled}
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
            aria-label="关闭图片预览背景"
            onClick={() => setPreviewedFile(undefined)}
          />
          <section
            className="attachment-lightbox__dialog"
            role="dialog"
            aria-modal="true"
            aria-label={`图片大图预览 ${activePreview.file.name}`}
          >
            <div className="attachment-lightbox__stage">
              <img src={activePreview.url} alt={activePreview.file.name} />
            </div>
            <button
              type="button"
              className="attachment-lightbox__close"
              aria-label="关闭图片预览"
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
