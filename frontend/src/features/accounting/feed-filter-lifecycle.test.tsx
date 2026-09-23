import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Link, MemoryRouter, Route, Routes, useParams } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ActivityWorkspace } from "../activities/activity-workspace";
import { useFeedFilters } from "./feed-filter-context";

const account = vi.hoisted(() => ({ userId: "user-1" }));
vi.mock("../auth/api", async importOriginal => ({
  ...await importOriginal<typeof import("../auth/api")>(),
  useSessionQuery: () => ({ data: { userId: account.userId }, isPending: false }),
}));
vi.mock("../activities/api", async importOriginal => ({
  ...await importOriginal<typeof import("../activities/api")>(),
  useActivityQuery: (_userId: string, activityId: string) => ({ data: { activityId, name: "测试活动", status: "ACTIVE", baseCurrency: "CNY" }, isPending: false }),
  useMembersQuery: () => ({ data: [], isPending: false }),
}));
vi.mock("../activities/offline-workspace", () => ({
  useOnlineStatus: () => true,
  useActivitySnapshotQuery: () => ({ data: undefined, isPending: false }),
}));

function FilterProbe() {
  const { state, setState } = useFeedFilters();
  const { activityId } = useParams();
  return <>
    <input aria-label="查账条件" value={state.query} onChange={event => setState(current => ({ ...current, query: event.target.value }))} />
    <Link to={`/activities/${activityId}/expenses/expense-1`}>打开账单</Link>
    <Link to="/activities/b">切换活动</Link>
  </>;
}
function TestRoutes() {
  return <MemoryRouter initialEntries={["/activities/a"]}><Routes>
    <Route path="/activities" element={<Link to="/activities/a">重新进入</Link>} />
    <Route path="/activities/:activityId" element={<ActivityWorkspace />}>
      <Route index element={<FilterProbe />} />
      <Route path="expenses/:expenseId" element={<Link to=".." relative="path">返回上一级</Link>} />
    </Route>
  </Routes></MemoryRouter>;
}

beforeEach(() => {
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => { cleanup(); account.userId = "user-1"; vi.unstubAllGlobals(); });

it("真实活动容器切换活动及账号立即隔离条件", () => {
  const view = render(<TestRoutes />);
  fireEvent.change(screen.getByLabelText("查账条件"), { target: { value: "甲的餐饮" } });
  fireEvent.click(screen.getByRole("link", { name: "切换活动" }));
  expect(screen.getByLabelText("查账条件")).toHaveValue("");
  fireEvent.change(screen.getByLabelText("查账条件"), { target: { value: "乙的住宿" } });
  account.userId = "user-2";
  view.rerender(<TestRoutes />);
  expect(screen.getByLabelText("查账条件")).toHaveValue("");
  account.userId = "user-1";
  view.rerender(<TestRoutes />);
  expect(screen.getByLabelText("查账条件")).toHaveValue("");
});

it("离开活动容器后重新进入不恢复旧条件", () => {
  render(<TestRoutes />);
  fireEvent.change(screen.getByLabelText("查账条件"), { target: { value: "餐饮" } });
  fireEvent.click(screen.getByRole("link", { name: "返回活动列表" }));
  fireEvent.click(screen.getByRole("link", { name: "重新进入" }));
  expect(screen.getByLabelText("查账条件")).toHaveValue("");
});
