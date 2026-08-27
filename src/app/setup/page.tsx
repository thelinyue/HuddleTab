import { SetupForm } from "@/features/setup/components/setup-form";

/** 首次管理员初始化是独立入口，不继承已登录产品页面的导航和内容框架。 */
export default function SetupPage() {
  return <SetupForm />;
}
