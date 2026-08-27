import { redirect } from "next/navigation";

/** 首次部署由 Proxy 先转入 Setup；完成后根路径统一进入登录页。 */
export default function HomePage() {
  redirect("/login");
}
