import { headers } from "next/headers";

import {
  InvitationJoin,
  type InvitationLandingData,
} from "@/features/invitations/components/invitation-join";
import { isInvitationToken } from "@/features/invitations/join-url";
import { auth } from "@/server/auth/auth";
import { sessionUserId } from "@/server/auth/session";
import { sql } from "@/server/db/client";
import {
  InvitationService,
  type InvitationLandingPreview,
} from "@/server/services/invitation-service";

export const dynamic = "force-dynamic";

/**
 * 邀请页在每次请求时读取可选 Session 与实时预览。活动 ID 始终留在服务端，
 * 除非当前用户已经是成员并需要直接进入活动。
 */
export default async function JoinPage({
  params,
}: {
  readonly params: Promise<{ readonly inviteToken: string }>;
}) {
  const { inviteToken } = await params;
  if (!isInvitationToken(inviteToken)) {
    return <InvitationJoin inviteToken={inviteToken} landing={null} />;
  }

  const requestHeaders = await headers();
  const session = await auth.api.getSession({ headers: requestHeaders });
  const userId = session ? sessionUserId(session) : undefined;
  const preview = await new InvitationService(sql).getLandingPreview({
    inviteProof: inviteToken,
    ...(userId ? { userId } : {}),
  });

  return (
    <InvitationJoin
      inviteToken={inviteToken}
      landing={preview ? toLandingData(preview) : null}
    />
  );
}

function toLandingData(
  preview: InvitationLandingPreview,
): InvitationLandingData {
  const publicPreview = {
    activityName: preview.activityName,
    activeMemberCount: preview.activeMemberCount,
    inviteMode: preview.inviteMode,
    inviterName: preview.inviterName,
  } as const;

  if (preview.viewerState === "MEMBER") {
    return {
      ...publicPreview,
      viewerState: "MEMBER",
      activityId: preview.activityId,
    };
  }

  return { ...publicPreview, viewerState: preview.viewerState };
}
