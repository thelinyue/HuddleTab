type ExpenseAttachment = {
  readonly id: string;
  readonly filename: string;
  readonly mimeType: string;
};

/** 附件预览始终请求受控下载路由，组件只接收可公开的显示元数据。 */
export function ExpenseAttachments({
  activityId,
  expenseId,
  attachments,
}: {
  readonly activityId: string;
  readonly expenseId: string;
  readonly attachments: readonly ExpenseAttachment[];
}) {
  if (!attachments.length) return null;
  return (
    <section className="mt-6" aria-label="附件">
      <h2 className="text-lg font-semibold">附件</h2>
      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {attachments.map((attachment) => {
          const href = `/api/activities/${encodeURIComponent(activityId)}/expenses/${encodeURIComponent(expenseId)}/attachments/${encodeURIComponent(attachment.id)}`;
          return (
            <a
              key={attachment.id}
              href={href}
              target="_blank"
              rel="noreferrer"
              aria-label={`查看附件 ${attachment.filename}`}
              className="block overflow-hidden border focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              <Image
                src={href}
                alt={`附件：${attachment.filename}`}
                width={512}
                height={512}
                sizes="(max-width: 640px) 50vw, 33vw"
                unoptimized
                loading="lazy"
                className="aspect-square w-full object-cover"
              />
            </a>
          );
        })}
      </div>
    </section>
  );
}
import Image from "next/image";
