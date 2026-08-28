import { StateNotice } from "@/components/design-system/state-notice";

/** 生命周期提示只说明当前权限边界，实际可执行命令仍由各页面和服务端决定。 */
export function ActivityLifecycleNotice({
  status,
  className,
}: {
  readonly status: "ACTIVE" | "ENDED" | "ARCHIVED";
  readonly className?: string;
}) {
  if (status === "ACTIVE") return null;
  return status === "ENDED" ? (
    <StateNotice
      tone="warning"
      title="活动已结束"
      description="不可新增或修改账单，仍可查看流水并记录实际结算。"
      className={className}
    />
  ) : (
    <StateNotice
      title="活动已归档"
      description="当前活动仅供查看，解除归档后才能恢复操作。"
      className={className}
    />
  );
}
