import { ArrowLeftIcon } from "lucide-react";
import Link from "next/link";

/** 二级账户页面统一提供可预期的返回路径与页面标题，不引入额外布局抽象。 */
export function MeSubpageHeader({ title }: { readonly title: string }) {
  return (
    <header className="grid min-h-12 grid-cols-[3rem_1fr_3rem] items-center">
      <Link
        href="/me"
        aria-label="返回"
        className="flex size-12 items-center justify-center rounded-lg text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <ArrowLeftIcon aria-hidden="true" className="size-5" />
      </Link>
      <h1 className="type-page-title text-center font-semibold">{title}</h1>
    </header>
  );
}
