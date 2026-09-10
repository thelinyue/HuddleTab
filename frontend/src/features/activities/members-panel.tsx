import { Link as LinkIcon, Trash2, UserPlus, UserRoundCheck } from "lucide-react";
import { useState } from "react";
import { Button, ConfirmDialog, ErrorNotice, Field, Input, LoadingState } from "../../components/ui";
import { MemberAvatar } from "../../components/member-avatar";
import { Overlay } from "../../components/overlay";
import {
  type CreatedInvitation,
  type Invitation,
  type InvitationIntent,
  useCreateGuestMutation,
  useCreateGuestBindingInvitationMutation,
  useCreateInvitationMutation,
  useInvitationsQuery,
  useJoinRequestsQuery,
  useMembersQuery,
  useDecideJoinRequestMutation,
  useRemoveGuestMutation,
  useRevokeInvitationMutation,
} from "./api";
import { useWorkspace } from "./workspace-context";

/** 成员列表与邀请子视图共用面板入口，保留原有切换时的挂载与草稿重置语义。 */
export function MembersOverlay({ onClose }: { onClose: () => void }) {
  const [view, setView] = useState<"list" | "invite">("list");
  return (
    <Overlay
      open
      title={view === "list" ? "成员" : "邀请成员"}
      onBack={view === "invite" ? { label: "返回成员", onClick: () => setView("list") } : undefined}
      onClose={onClose}
    >
      <MembersPage key={view} view={view} onInvite={() => setView("invite")} />
    </Overlay>
  );
}

export function MemberInvitationPanel({
  onCreate,
}: {
  onCreate: (intent: InvitationIntent) => Promise<CreatedInvitation>;
}) {
  const [mode, setMode] = useState<"link" | "direct">("link");
  const [targetDisplayName, setTargetDisplayName] = useState("");
  const [createdToken, setCreatedToken] = useState<string>();
  const [copyMessage, setCopyMessage] = useState("");
  const inviteUrl = createdToken ? `${window.location.origin}/join/${encodeURIComponent(createdToken)}` : undefined;
  const [error, setError] = useState<unknown>();
  const [submitting, setSubmitting] = useState(false);

  const selectMode = (nextMode: "link" | "direct") => {
    setMode(nextMode);
    setCreatedToken(undefined);
    setCopyMessage("");
    setError(undefined);
  };

  const create = async (intent: InvitationIntent) => {
    setSubmitting(true);
    setCopyMessage("");
    setCreatedToken(undefined);
    setError(undefined);
    try {
      const invitation = await onCreate(intent);
      setCreatedToken(invitation.token);
    } catch (reason) {
      setError(reason);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="member-invite-panel">
      <div className="segmented" role="group" aria-label="邀请方式">
        <button type="button" aria-pressed={mode === "link"} disabled={submitting} onClick={() => selectMode("link")}>链接邀请</button>
        <button type="button" aria-pressed={mode === "direct"} disabled={submitting} onClick={() => selectMode("direct")}>定向邀请</button>
      </div>

      {mode === "link" ? (
        <section className="invite-mode-panel" aria-label="链接邀请">
          <p>生成可分享的邀请链接，对方登录或注册后即可加入活动。</p>
          <Button busy={submitting} onClick={() => void create({ mode: "link" })}><LinkIcon aria-hidden="true" size={18} />生成链接邀请</Button>
        </section>
      ) : (
        <form className="invite-mode-panel" onSubmit={(event) => { event.preventDefault(); void create({ mode: "direct", targetDisplayName }); }}>
          <Field label="目标昵称" hint="对方可使用此邀请注册账号并自行设置用户名。">
            <Input
              value={targetDisplayName}
              onChange={(event) => setTargetDisplayName(event.target.value)}
              autoComplete="name"
              maxLength={64}
              required
              autoFocus
            />
          </Field>
          <Button type="submit" busy={submitting}><UserPlus aria-hidden="true" size={18} />创建定向邀请</Button>
        </form>
      )}

      {createdToken ? (
        <div className="issued-invite" role="status" aria-live="polite">
          <strong>邀请链接已创建</strong>
          <a href={inviteUrl} aria-label="邀请链接，可左右滑动查看完整地址">{inviteUrl}</a>
          <Button variant="secondary" type="button" onClick={async () => {
            try {
              if (!navigator.clipboard) throw new Error("剪贴板不可用");
              await navigator.clipboard.writeText(inviteUrl ?? "");
              setCopyMessage("邀请链接已复制");
            } catch {
              setCopyMessage("复制失败，请长按或选择上方链接手动复制。");
            }
          }}>复制邀请链接</Button>
          {copyMessage ? <small>{copyMessage}</small> : null}
          <small>邀请链接只在本次创建后显示，请及时发送给对方。</small>
        </div>
      ) : null}
      {error ? <ErrorNotice error={error} /> : null}
    </div>
  );
}

function MemberInvitationView({ userId, activityId }: { userId: string; activityId: string }) {
  const createInvitation = useCreateInvitationMutation(userId, activityId);
  return <MemberInvitationPanel onCreate={createInvitation.mutateAsync} />;
}

function activeInvitations(invitations: readonly Invitation[], now: number): Invitation[] {
  return invitations.filter((invitation) =>
    !invitation.revokedAt &&
    Date.parse(invitation.expiresAt) > now &&
    (invitation.maxUses == null || invitation.useCount < invitation.maxUses),
  );
}

export function MembersPage({ view = "list", onInvite }: { view?: "list" | "invite"; onInvite?: () => void }) {
  const { session, activity, members: cachedMembers, offline } = useWorkspace();
  const members = useMembersQuery(session.userId, activity.activityId, !offline);
  const memberData = members.data ?? cachedMembers;
  const isOwner = activity.currentMemberRole === "OWNER";
  const canManage = activity.status === "ACTIVE" && isOwner && !offline;
  const invitations = useInvitationsQuery(session.userId, activity.activityId, canManage);
  const joinRequests = useJoinRequestsQuery(session.userId, activity.activityId, isOwner && !offline);
  const decideJoinRequest = useDecideJoinRequestMutation(session.userId, activity.activityId);
  const createGuest = useCreateGuestMutation(session.userId, activity.activityId);
  const createGuestBinding = useCreateGuestBindingInvitationMutation(
    session.userId,
    activity.activityId,
  );
  const removeGuest = useRemoveGuestMutation(session.userId, activity.activityId);
  const revokeInvitation = useRevokeInvitationMutation(session.userId, activity.activityId);
  const [guestName, setGuestName] = useState("");
  const [bindingMemberId, setBindingMemberId] = useState<string>();
  const [bindingUsername, setBindingUsername] = useState("");
  const [bindingToken, setBindingToken] = useState<string>();
  const [bindingError, setBindingError] = useState<unknown>();
  const [decisionError, setDecisionError] = useState<unknown>();
  const [removalMemberId, setRemovalMemberId] = useState<string>();
  const [removalError, setRemovalError] = useState<unknown>();
  const [removalSubmitting, setRemovalSubmitting] = useState(false);

  async function createBindingInvitation(memberId: string) {
    setBindingError(undefined);
    setBindingToken(undefined);
    try {
      const invitation = await createGuestBinding.mutateAsync({
        memberId,
        targetDisplayName: bindingUsername,
      });
      setBindingToken(invitation.token);
    } catch (reason) {
      setBindingError(reason);
    }
  }

  async function decide(requestId: string, decision: "APPROVE" | "REJECT") {
    setDecisionError(undefined);
    try {
      await decideJoinRequest.mutateAsync({ requestId, decision });
    } catch (reason) {
      setDecisionError(reason);
    }
  }

  const removalMember = memberData?.find((member) => member.memberId === removalMemberId);

  async function confirmGuestRemoval() {
    if (!removalMember || removeGuest.isPending || removalSubmitting) return;
    setRemovalError(undefined);
    setRemovalSubmitting(true);
    try {
      await removeGuest.mutateAsync(removalMember.memberId);
      setRemovalMemberId(undefined);
    } catch (reason) {
      setRemovalError(reason);
    } finally {
      setRemovalSubmitting(false);
    }
  }

  function openGuestRemoval(memberId: string) {
    setRemovalError(undefined);
    setRemovalMemberId(memberId);
  }

  function cancelGuestRemoval() {
    if (removeGuest.isPending || removalSubmitting) return;
    setRemovalError(undefined);
    setRemovalMemberId(undefined);
  }

  if (members.isPending && !memberData) return <LoadingState label="正在读取成员…" />;
  if (members.error && !memberData) return <ErrorNotice error={members.error} />;
  if (view === "invite" && canManage) {
    return <MemberInvitationView userId={session.userId} activityId={activity.activityId} />;
  }
  const visibleInvitations = canManage
    ? activeInvitations(invitations.data ?? [], Date.now())
    : [];
  return (
    <div className="member-center">
      {offline ? <div className="notice" role="status">当前离线，成员列表使用最近一次同步的缓存；邀请、绑定和审批需要联网。</div> : null}
      {canManage ? <div className="member-actions">
        <Button onClick={onInvite}><UserPlus aria-hidden="true" size={18} /> 邀请成员</Button>
        <form onSubmit={(event) => { event.preventDefault(); void createGuest.mutateAsync(guestName).then(() => setGuestName("")); }}><Input aria-label="临时成员名称" value={guestName} onChange={(event) => setGuestName(event.target.value)} placeholder="临时成员名称" required /><Button variant="secondary" type="submit" busy={createGuest.isPending}>添加</Button></form>
      </div> : null}
      {createGuest.error ? <ErrorNotice error={createGuest.error} /> : null}
      {isOwner && joinRequests.isPending ? <LoadingState label="正在读取待审批申请…" /> : null}
      {isOwner && joinRequests.error ? <ErrorNotice error={joinRequests.error} /> : null}
      {isOwner && joinRequests.data?.length ? (
        <section className="member-section" aria-labelledby="join-requests-heading">
          <h2 id="join-requests-heading">待审批 · {joinRequests.data.length}人</h2>
          <div className="join-request-list">
            {joinRequests.data.map((request) => (
              <div className="join-request-row" key={request.requestId}>
                <span>
                  <strong>{request.applicantDisplayName}</strong>
                  <small>申请加入活动</small>
                </span>
                <div className="join-request-actions">
                  <Button
                    variant="secondary"
                    busy={decideJoinRequest.isPending}
                    aria-label={`拒绝${request.applicantDisplayName}`}
                    onClick={() => void decide(request.requestId, "REJECT")}
                  >拒绝</Button>
                  <Button
                    busy={decideJoinRequest.isPending}
                    disabled={activity.status !== "ACTIVE"}
                    aria-label={`批准${request.applicantDisplayName}`}
                    onClick={() => void decide(request.requestId, "APPROVE")}
                  >批准</Button>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}
      {decisionError ? <ErrorNotice error={decisionError} /> : null}
      <section className="member-section">
        {(() => {
          const activeMemberCount = memberData?.filter((member) => member.status === "ACTIVE").length ?? 0;
          const removedMemberCount = memberData?.filter((member) => member.status === "LEFT").length ?? 0;
          return <h2>活动成员 · {activeMemberCount}人{removedMemberCount ? ` · 已移除 ${removedMemberCount}人` : ""}</h2>;
        })()}
        <div className="member-list">
          {memberData?.map((member) => {
            const canBind = canManage && member.status === "ACTIVE" && member.userId == null;
            const canRemove = canManage
              && member.status === "ACTIVE"
              && member.role === "MEMBER"
              && member.userId == null;
            const editorOpen = bindingMemberId === member.memberId;
            const removed = member.status === "LEFT";
            return (
              <div className="member-entry" key={member.memberId}>
                <div className="member-row">
                  <MemberAvatar memberId={member.memberId} displayName={member.displayName} avatarPreset={member.avatarPreset} />
                  <span>
                    <strong>{member.displayName}{member.memberId === activity.currentMemberId ? "（我）" : ""}</strong>
                    <small>{member.userId ? "正式成员" : removed ? "临时成员 · 已移除" : "临时成员"}</small>
                  </span>
                  <div className="member-row__actions">
                    <span className="tag">{member.role === "OWNER" ? "所有者" : member.role === "ADMIN" ? "管理员" : "成员"}</span>
                    {removed ? <span className="tag tag--muted">已移除</span> : null}
                    {canBind ? (
                      <Button
                        variant="ghost"
                        aria-expanded={editorOpen}
                        onClick={() => {
                          setBindingMemberId(editorOpen ? undefined : member.memberId);
                          setBindingUsername("");
                          setBindingToken(undefined);
                          setBindingError(undefined);
                        }}
                      >
                        <UserRoundCheck aria-hidden="true" size={17} />绑定账号
                      </Button>
                    ) : null}
                    {canRemove ? (
                      <button
                        className="icon-button member-row__remove"
                        type="button"
                        aria-label={`删除临时成员 ${member.displayName}`}
                        title={`删除临时成员 ${member.displayName}`}
                        onClick={() => openGuestRemoval(member.memberId)}
                        disabled={removeGuest.isPending || removalSubmitting}
                      >
                        <Trash2 aria-hidden="true" size={18} />
                      </button>
                    ) : null}
                  </div>
                </div>
                {editorOpen ? (
                  <form
                    className="guest-binding-form"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void createBindingInvitation(member.memberId);
                    }}
                  >
                    <Field label="目标用户名" hint="该用户确认后，将继承此临时成员的账务身份。">
                      <Input
                        value={bindingUsername}
                        onChange={(event) => setBindingUsername(event.target.value)}
                        autoComplete="username"
                        autoCapitalize="none"
                        minLength={3}
                        maxLength={32}
                        required
                        autoFocus
                      />
                    </Field>
                    <Button type="submit" busy={createGuestBinding.isPending}>创建绑定邀请</Button>
                    {bindingToken ? <div className="issued-invite" role="status" aria-live="polite"><strong>绑定口令已创建</strong><code>{bindingToken}</code><small>口令只在本次创建后显示，请及时发送给对方。</small></div> : null}
                    {bindingError ? <ErrorNotice error={bindingError} /> : null}
                  </form>
                ) : null}
              </div>
            );
          })}
        </div>
      </section>
      {visibleInvitations.length ? <section className="member-section"><h2>有效邀请</h2><div className="compact-list">{visibleInvitations.map((invite) => {
        const guestName = memberData?.find((member) => member.memberId === invite.guestMemberId)?.displayName ?? "临时成员";
        const label = invite.purpose === "GUEST_BINDING"
          ? `绑定「${guestName}」给 ${invite.targetDisplayName ?? "目标用户"}`
          : invite.kind === "DIRECT" ? invite.targetDisplayName ?? "定向邀请" : "链接加入";
        return <div key={invite.invitationId}><span><strong>{label}</strong><small>已使用 {invite.useCount}{invite.maxUses ? ` / ${invite.maxUses}` : ""}</small></span><Button variant="ghost" busy={revokeInvitation.isPending} onClick={() => revokeInvitation.mutate(invite.invitationId)}>撤销</Button></div>;
      })}</div></section> : null}
      <ConfirmDialog
        open={Boolean(removalMember)}
        title={removalMember ? `确认删除临时成员「${removalMember.displayName}」` : "确认删除临时成员"}
        message="成员将不能再参与新账单或结算，已有账务会保留；无历史记录时会彻底删除。"
        error={removalError ? <ErrorNotice error={removalError} /> : undefined}
        confirmLabel="删除成员"
        busy={removeGuest.isPending || removalSubmitting}
        onConfirm={() => void confirmGuestRemoval()}
        onCancel={cancelGuestRemoval}
      />
    </div>
  );
}
