import { InvitationJoin } from "@/features/invitations/components/invitation-join";

/** 公共邀请页不读取活动资料；认证后由加入 API 返回最小结果。 */
export default async function JoinPage({
  params,
}: {
  readonly params: Promise<{ readonly inviteToken: string }>;
}) {
  const { inviteToken } = await params;
  return <InvitationJoin inviteToken={inviteToken} />;
}
