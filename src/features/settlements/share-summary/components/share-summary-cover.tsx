import Image from "next/image";

/** 插画完全与账务信息分离，只营造活动结束后的轻松结算氛围。 */
export function ShareSummaryHeaderIllustration({
  src,
}: {
  readonly src: string;
}) {
  return (
    <figure className="relative aspect-[2/1] overflow-hidden bg-[#DDF2E8]">
      <Image
        src={src}
        alt=""
        role="presentation"
        fill
        priority
        sizes="800px"
        className="object-cover"
      />
    </figure>
  );
}
