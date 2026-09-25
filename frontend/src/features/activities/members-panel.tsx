import { Link as LinkIcon, LogOut, Plus, Trash2, UserPlus, UserRoundCheck, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { DropdownMenu } from "radix-ui";
import { Button, ConfirmDialog, ErrorNotice, Field, Input, LoadingState } from "../../components/ui";
import { MemberAvatar } from "../../components/member-avatar";
import { Overlay } from "../../components/overlay";
import {
  type CreatedInvitation,
  type Invitation,
  type InvitationIntent,
  getInvitationLink,
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
  const menuScrimDismissedAt = useRef(0);
  return (
    <Overlay
      open
      className="members-overlay"
      title={view === "list" ? "成员" : "邀请成员"}
      focusKey={view}
      onBack={view === "invite" ? { label: "返回成员", onClick: () => setView("list") } : undefined}
      onBeforeClose={() => {
        // 菜单位于 Portal；遮罩的同一次点击只应收起菜单，不能穿透关闭 Sheet。
        if (Date.now() - menuScrimDismissedAt.current < 1000) {
          menuScrimDismissedAt.current = 0;
          return false;
        }
        return true;
      }}
      onClose={onClose}
    >
      <MembersPage key={view} view={view} onInvite={() => setView("invite")} onMenuPointerDownOutside={(target) => {
        if (target instanceof Element && target.closest(".form-overlay__scrim")) menuScrimDismissedAt.current = Date.now();
      }} />
    </Overlay>
  );
}

export function MemberInvitationPanel({
  onCreate,
  invitation,
  activityId,
  onRevoke,
  onRefresh,
}: {
  onCreate: (intent: InvitationIntent) => Promise<CreatedInvitation>;
  invitation?: Invitation;
  activityId?: string;
  onRevoke?: (invitationId: string) => Promise<unknown>;
  onRefresh?: () => Promise<unknown>;
}) {
  const [createdToken, setCreatedToken] = useState<string>();
  const [createdId, setCreatedId] = useState<string>();
  const [revokedId, setRevokedId] = useState<string>();
  const [copyMessage, setCopyMessage] = useState("");
  const inviteUrl = createdToken ? `${window.location.origin}/join/${encodeURIComponent(createdToken)}` : undefined;
  const [error, setError] = useState<unknown>();
  const [submitting, setSubmitting] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const listedId = invitation?.invitationId;
  const activeId = listedId && listedId !== revokedId ? listedId : createdId;

  useEffect(() => {
    if (!activityId || !activeId || createdId === activeId) return;
    let cancelled = false;
    setError(undefined);
    setCreatedToken(undefined);
    getInvitationLink(activityId, activeId).then((token) => {
      if (!cancelled) setCreatedToken(token);
    }).catch((reason: unknown) => {
      if (!cancelled) setError(reason);
    });
    return () => { cancelled = true; };
  }, [activityId, activeId, createdId]);

  const create = async (intent: InvitationIntent) => {
    setSubmitting(true);
    setCopyMessage("");
    setError(undefined);
    try {
      const invitation = await onCreate(intent);
      setCreatedId(invitation.invitationId);
      setCreatedToken(invitation.token);
    } catch (reason) {
      setError(reason);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="member-invite-panel">
      <section className="invite-mode-panel" aria-label="链接邀请">
        {activeId ? (
          <div className="issued-invite" role="status" aria-live="polite">
            <strong>邀请链接</strong>
            {inviteUrl ? <a href={inviteUrl} aria-label="邀请链接，可左右滑动查看完整地址">{inviteUrl}</a> : error && activityId ? <Button variant="secondary" type="button" onClick={() => {
              setError(undefined);
              void getInvitationLink(activityId, activeId).then(setCreatedToken).catch(setError);
            }}>重试读取</Button> : <span>正在读取邀请链接…</span>}
            <div className="issued-invite__actions">
              <Button data-overlay-initial-focus disabled={!inviteUrl} type="button" onClick={async () => {
                let token = createdToken;
                if (activityId) {
                  try {
                    token = await getInvitationLink(activityId, activeId);
                  } catch (reason) {
                    setCreatedId(undefined);
                    setCreatedToken(undefined);
                    setCopyMessage("");
                    setError(reason);
                    void onRefresh?.();
                    return;
                  }
                }
                try {
                  if (!navigator.clipboard || !token) throw new Error("剪贴板不可用");
                  const url = `${window.location.origin}/join/${encodeURIComponent(token)}`;
                  await navigator.clipboard.writeText(url);
                  setCopyMessage("邀请链接已复制");
                } catch {
                  setCopyMessage("复制失败，请长按或选择上方链接手动复制。");
                }
              }}>复制邀请链接</Button>
              {onRevoke ? <Button variant="secondary" type="button" onClick={() => setConfirmRevoke(true)}>撤销链接</Button> : null}
            </div>
            {copyMessage ? <small>{copyMessage}</small> : null}
          </div>
        ) : (
          <>
            <p>生成可分享的邀请链接，对方登录或注册后即可加入活动。</p>
            <Button busy={submitting} data-overlay-initial-focus onClick={() => void create({ mode: "link" })}><LinkIcon aria-hidden="true" size={18} />生成链接邀请</Button>
          </>
        )}
      </section>
      {error ? <ErrorNotice error={error} /> : null}
      <ConfirmDialog
        open={confirmRevoke}
        title="撤销邀请链接？"
        message="已分享的链接将立即失效，使用该链接提交的待审批申请也会关闭。"
        confirmLabel="撤销链接"
        busy={revoking}
        error={error ? <ErrorNotice error={error} /> : undefined}
        onConfirm={() => {
          if (!activeId || !onRevoke) return;
          setRevoking(true);
          setError(undefined);
          void onRevoke(activeId).then(() => {
            setRevokedId(activeId);
            setCreatedId(undefined);
            setCreatedToken(undefined);
            setCopyMessage("");
            setConfirmRevoke(false);
          }).catch((reason: unknown) => setError(reason)).finally(() => setRevoking(false));
        }}
        onCancel={() => setConfirmRevoke(false)}
      />
    </div>
  );
}

function MemberInvitationView({ userId, activityId }: { userId: string; activityId: string }) {
  const createInvitation = useCreateInvitationMutation(userId, activityId);
  const revokeInvitation = useRevokeInvitationMutation(userId, activityId);
  const invitations = useInvitationsQuery(userId, activityId, true);
  if (invitations.isPending) return <LoadingState label="正在读取邀请链接…" />;
  if (invitations.error) return <ErrorNotice error={invitations.error} />;
  const activeLink = activeInvitations(invitations.data ?? [], Date.now()).find((item) => item.kind === "LINK");
  return <MemberInvitationPanel activityId={activityId} invitation={activeLink} onCreate={createInvitation.mutateAsync} onRevoke={revokeInvitation.mutateAsync} onRefresh={invitations.refetch} />;
}

function activeInvitations(invitations: readonly Invitation[], now: number): Invitation[] {
  return invitations.filter((invitation) =>
    !invitation.revokedAt &&
    Date.parse(invitation.expiresAt) > now &&
    (invitation.maxUses == null || invitation.useCount < invitation.maxUses),
  );
}

export function MembersPage({ view = "list", onInvite, onMenuPointerDownOutside }: { view?: "list" | "invite"; onInvite?: () => void; onMenuPointerDownOutside?: (target: EventTarget | null) => void }) {
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
  const [guestExpanded, setGuestExpanded] = useState(false);
  const [guestError, setGuestError] = useState<unknown>();
  const guestInputRef = useRef<HTMLInputElement>(null);
  const inviteButtonRef = useRef<HTMLButtonElement>(null);
  const focusGuestOnMenuClose = useRef(false);
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

  async function submitGuest() {
    setGuestError(undefined);
    try {
      await createGuest.mutateAsync(guestName);
      setGuestName("");
      setGuestExpanded(false);
      inviteButtonRef.current?.focus({ preventScroll: true });
    } catch (reason) {
      setGuestError(reason);
    }
  }

  if (members.isPending && !memberData) return <LoadingState label="正在读取成员…" />;
  if (members.error && !memberData) return <ErrorNotice error={members.error} />;
  if (view === "invite" && canManage) {
    return <MemberInvitationView userId={session.userId} activityId={activity.activityId} />;
  }
  const visibleInvitations = canManage
    ? activeInvitations(invitations.data ?? [], Date.now()).filter((invitation) => invitation.kind !== "LINK")
    : [];
  return (
    <div className="member-center">
      {offline ? <div className="notice" role="status">当前离线，成员列表使用最近一次同步的缓存；邀请、绑定和审批需要联网。</div> : null}
      <section className="member-section">
        <div className="member-section__header">
          {(() => {
            const activeMemberCount = memberData?.filter((member) => member.status === "ACTIVE").length ?? 0;
            const removedMemberCount = memberData?.filter((member) => member.status === "LEFT").length ?? 0;
            return <h2>活动成员 · {activeMemberCount}人{removedMemberCount ? ` · 已移除 ${removedMemberCount}人` : ""}</h2>;
          })()}
          {canManage ? <DropdownMenu.Root modal={false}>
            <DropdownMenu.Trigger asChild><button ref={inviteButtonRef} className="button button--secondary" type="button"><UserPlus aria-hidden="true" size={18} />邀请</button></DropdownMenu.Trigger>
            <DropdownMenu.Portal><DropdownMenu.Content className="member-invite-menu" align="end" sideOffset={6} collisionPadding={12} onEscapeKeyDown={(event) => event.stopPropagation()} onPointerDownOutside={(event) => onMenuPointerDownOutside?.(event.target)} onCloseAutoFocus={(event) => {
              if (focusGuestOnMenuClose.current) {
                event.preventDefault();
                focusGuestOnMenuClose.current = false;
                guestInputRef.current?.focus({ preventScroll: true });
              }
            }}>
              <DropdownMenu.Item onSelect={onInvite}><UserPlus aria-hidden="true" size={17} />邀请成员</DropdownMenu.Item>
              <DropdownMenu.Item onSelect={() => { setGuestError(undefined); setGuestExpanded(true); focusGuestOnMenuClose.current = true; }}><Plus aria-hidden="true" size={17} />添加临时成员</DropdownMenu.Item>
            </DropdownMenu.Content></DropdownMenu.Portal>
          </DropdownMenu.Root> : null}
        </div>
        <div className="member-list">
          {guestExpanded && canManage ? <form className="member-entry member-entry--draft" onSubmit={(event) => { event.preventDefault(); void submitGuest(); }}>
            <div className="member-row">
              <MemberAvatar memberId="draft-guest" userId={null} displayName="临时成员" decorative />
              <Input ref={guestInputRef} aria-label="临时成员名称" value={guestName} onChange={(event) => setGuestName(event.target.value)} placeholder="临时成员名称" required maxLength={40} />
              <div className="member-row__actions"><Button type="submit" busy={createGuest.isPending}>确认</Button><button className="icon-button" type="button" aria-label="取消添加临时成员" title="取消添加临时成员" disabled={createGuest.isPending} onClick={() => { setGuestExpanded(false); setGuestName(""); setGuestError(undefined); inviteButtonRef.current?.focus({ preventScroll: true }); }}><X aria-hidden="true" size={18} /></button></div>
            </div>
            {guestError ? <ErrorNotice error={guestError} /> : null}
          </form> : null}
          {memberData?.map((member) => {
            const canBind = canManage && member.status === "ACTIVE" && member.userId == null;
            const isSelf = member.memberId === activity.currentMemberId;
            const canRemove = activity.status === "ACTIVE" && member.status === "ACTIVE" && member.role === "MEMBER" && (
              isSelf ? !offline : canManage
            );
            const editorOpen = bindingMemberId === member.memberId;
            const removed = member.status === "LEFT";
            return (
              <div className="member-entry" key={member.memberId}>
                <div className="member-row">
                  <MemberAvatar memberId={member.memberId} userId={member.userId} displayName={member.displayName} avatarPreset={member.avatarPreset} avatarImageId={member.avatarImageId} />
                  <span>
                    <strong title={member.displayName}>{member.displayName}{member.memberId === activity.currentMemberId ? "（我）" : ""}</strong>
                  </span>
                  <div className="member-row__actions">
                    <span className="tag">{member.role === "OWNER" ? "所有者" : member.role === "ADMIN" ? "管理员" : member.userId ? "成员" : "临时成员"}</span>
                    {removed ? <span className="tag tag--muted">已移除</span> : null}
                    {canBind ? (
                      <Button
                        variant="ghost"
                        aria-label="绑定账号"
                        title="绑定账号"
                        aria-expanded={editorOpen}
                        onClick={() => {
                          setBindingMemberId(editorOpen ? undefined : member.memberId);
                          setBindingUsername("");
                          setBindingToken(undefined);
                          setBindingError(undefined);
                        }}
                      >
                        <UserRoundCheck aria-hidden="true" size={17} /><span>绑定账号</span>
                      </Button>
                    ) : null}
                    {canRemove ? (
                      <button
                        className="icon-button member-row__remove"
                        type="button"
                        aria-label={`${isSelf ? "退出活动" : "移除成员"} ${member.displayName}`}
                        title={`${isSelf ? "退出活动" : "移除成员"} ${member.displayName}`}
                        onClick={() => openGuestRemoval(member.memberId)}
                        disabled={removeGuest.isPending || removalSubmitting}
                      >
                        {isSelf ? <LogOut aria-hidden="true" size={18} /> : <Trash2 aria-hidden="true" size={18} />}
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
      {isOwner && joinRequests.isPending ? <span className="member-loading-status" role="status">正在读取待审批申请…</span> : null}
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
                  <Button variant="secondary" busy={decideJoinRequest.isPending} aria-label={`拒绝${request.applicantDisplayName}`} onClick={() => void decide(request.requestId, "REJECT")}>拒绝</Button>
                  <Button busy={decideJoinRequest.isPending} disabled={activity.status !== "ACTIVE"} aria-label={`批准${request.applicantDisplayName}`} onClick={() => void decide(request.requestId, "APPROVE")}>批准</Button>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}
      {decisionError ? <ErrorNotice error={decisionError} /> : null}
      {visibleInvitations.length ? <section className="member-section"><h2>有效邀请</h2><div className="compact-list">{visibleInvitations.map((invite) => {
        const guestName = memberData?.find((member) => member.memberId === invite.guestMemberId)?.displayName ?? "临时成员";
        const label = invite.purpose === "GUEST_BINDING"
          ? `绑定「${guestName}」给 ${invite.targetDisplayName ?? "目标用户"}`
          : invite.kind === "DIRECT" ? invite.targetDisplayName ?? "定向邀请" : "链接加入";
        return <div key={invite.invitationId}><span><strong>{label}</strong><small>已使用 {invite.useCount}{invite.maxUses ? ` / ${invite.maxUses}` : ""}</small></span><Button variant="ghost" busy={revokeInvitation.isPending} onClick={() => revokeInvitation.mutate(invite.invitationId)}>撤销</Button></div>;
      })}</div></section> : null}
      <ConfirmDialog
        open={Boolean(removalMember)}
        title={removalMember ? `确认${removalMember.memberId === activity.currentMemberId ? "退出活动" : "移除成员"}「${removalMember.displayName}」` : "确认操作"}
        message="该成员将不能再参与新账单或结算，已有账务会保留；无历史记录时会彻底删除。"
        error={removalError ? <ErrorNotice error={removalError} /> : undefined}
        confirmLabel={removalMember?.memberId === activity.currentMemberId ? "退出活动" : "移除成员"}
        busy={removeGuest.isPending || removalSubmitting}
        onConfirm={() => void confirmGuestRemoval()}
        onCancel={cancelGuestRemoval}
      />
    </div>
  );
}
