const roleLabels = { OWNER: "Owner", ADMIN: "管理员", MEMBER: "成员" } as const;

/** 成员列表将角色、身份类型与退出状态全部文本化，不能只依赖颜色表达权限或历史状态。 */
export function MemberList({
  members,
}: {
  readonly members: readonly {
    readonly id: string;
    readonly displayName: string;
    readonly role: "OWNER" | "ADMIN" | "MEMBER";
    readonly status: "ACTIVE" | "LEFT";
    readonly memberType: "USER" | "GUEST";
    readonly permissions: { readonly canManage: boolean };
  }[];
}) {
  return (
    <section aria-label="成员">
      <h1 className="py-5 text-2xl font-bold">成员</h1>
      <div>
        {members.map((member) => (
          <div
            key={member.id}
            className="flex min-h-16 items-center justify-between gap-4 border-b py-3"
          >
            <div>
              <strong>{member.displayName}</strong>
              <p className="mt-1 text-sm text-muted-foreground">
                {roleLabels[member.role]} ·{" "}
                <span>
                  {member.memberType === "USER" ? "正式账号" : "临时成员"}
                </span>
              </p>
            </div>
            <span className="text-sm">
              {member.status === "LEFT" ? "已退出" : "活动中"}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
