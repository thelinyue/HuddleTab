import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  joinRequest: undefined as undefined | { activityId: string; requestId: string; status: string },
  join: { error: null as unknown, isPending: false, mutateAsync: vi.fn() },
}));

vi.mock("./api", () => ({
  useInvitationPreviewQuery: () => ({
    data: {
      activeMemberCount: 2,
      activityId: "activity-1",
      activityName: "测试活动",
      expiresAt: "2026-09-08T00:00:00Z",
      kind: "LINK",
    },
    isPending: false,
  }),
  useJoinInvitationMutation: () => state.join,
  useJoinRequestQuery: () => ({ data: state.joinRequest, isPending: false }),
  useLoginMutation: () => ({ mutateAsync: vi.fn() }),
  useRegisterMutation: () => ({ mutateAsync: vi.fn() }),
  useSessionQuery: () => ({
    data: { displayName: "Bob", userId: "user-2", username: "bob" },
    isPending: false,
  }),
}));

import { JoinPage } from "./pages";

function renderJoin() {
  const queryClient = new QueryClient();
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return render(
    <MemoryRouter initialEntries={["/join/token-1"]}>
      <Routes>
        <Route path="/join/:token" element={<JoinPage />} />
        <Route path="/activities/:activityId" element={<p>活动工作台</p>} />
      </Routes>
    </MemoryRouter>,
    { wrapper },
  );
}

afterEach(() => {
  cleanup();
  state.join.error = null;
  state.join.isPending = false;
  state.join.mutateAsync.mockReset();
  state.joinRequest = undefined;
});

describe("JoinPage approval states", () => {
  it("Pending 留在邀请页并显示等待审批", async () => {
    state.join.mutateAsync.mockResolvedValue({
      activityId: "activity-1",
      memberId: null,
      requestId: "request-1",
      revision: "3",
      status: "PENDING_APPROVAL",
    });
    state.joinRequest = {
      activityId: "activity-1",
      requestId: "request-1",
      status: "PENDING",
    };
    renderJoin();

    fireEvent.click(screen.getByRole("button", { name: /加入活动/ }));
    expect(await screen.findByText("等待活动所有者审批")).toBeInTheDocument();
    expect(screen.queryByText("活动工作台")).not.toBeInTheDocument();
  });

  it.each([
    ["APPROVED", "申请已批准", true],
    ["REJECTED", "申请未通过", false],
  ])("%s 显示明确结果", async (status, label, hasLink) => {
    state.join.mutateAsync.mockResolvedValue({
      activityId: "activity-1",
      memberId: null,
      requestId: "request-1",
      revision: "4",
      status: "PENDING_APPROVAL",
    });
    state.joinRequest = { activityId: "activity-1", requestId: "request-1", status };
    renderJoin();

    fireEvent.click(screen.getByRole("button", { name: /加入活动/ }));
    expect(await screen.findByText(label)).toBeInTheDocument();
    await waitFor(() => {
      if (hasLink) {
        expect(screen.getByRole("link", { name: "打开活动" })).toHaveAttribute(
          "href",
          "/activities/activity-1",
        );
      } else {
        expect(screen.queryByRole("link", { name: "打开活动" })).not.toBeInTheDocument();
      }
    });
  });
});
