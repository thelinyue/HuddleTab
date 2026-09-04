import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** 合并条件类名并让 Tailwind 的后置工具类覆盖前置默认值。 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
