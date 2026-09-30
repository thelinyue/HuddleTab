import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiRequestError } from "../../api/error";
import type { AccessAddresses } from "./api";

const state = vi.hoisted(() => ({ data: undefined as AccessAddresses | undefined, save: vi.fn(), refetch: vi.fn() }));
vi.mock("./api", () => ({
  useAccessAddressesQuery: () => ({ data: state.data, refetch: state.refetch }),
  useUpdateAccessAddressesMutation: () => ({ mutateAsync: state.save, isPending: false }),
}));
import { AccessAddressesEditor, normalizeAccessAddress } from "./access-addresses";

const current = window.location.origin;
const click = (name: string) => fireEvent.click(screen.getByRole("button", { name }));
function add(value: string) {
  fireEvent.change(screen.getByLabelText("添加地址"), { target: { value } });
  click("添加");
}
beforeEach(() => {
  state.data = { origins: [], version: 1, currentOrigin: current };
  state.save.mockReset().mockImplementation(async (input) => ({ ...input, version: input.version + 1, currentOrigin: current }));
  state.refetch.mockReset().mockImplementation(async () => ({ data: state.data }));
});
afterEach(cleanup);

describe("访问地址编辑", () => {
  it("首次保存必须包含当前入口，规范化去重且不能移除当前入口", async () => {
    render(<AccessAddressesEditor userId="admin" online />);
    expect(screen.getByText(/MCP 暂未开放/)).toBeInTheDocument();
    add("HTTPS://Example.COM:443/"); add("https://example.com");
    expect(screen.getAllByText("https://example.com")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "保存" })).toBeDisabled();
    click("添加当前地址");
    expect(screen.queryByRole("button", { name: `移除 ${current}` })).not.toBeInTheDocument();
    click("保存");
    await waitFor(() => expect(state.save).toHaveBeenCalledWith({ origins: ["https://example.com", current], version: 1 }));
    expect(await screen.findByRole("status")).toHaveTextContent("立即生效");
  });

  it("更换入口时可以移除旧地址，保存失败保留草稿", async () => {
    state.data!.origins = [current, "http://old.test:5660"];
    state.save.mockRejectedValue(new Error("保存失败"));
    render(<AccessAddressesEditor userId="admin" online />);
    click("移除 http://old.test:5660"); add("https://new.test"); click("保存");
    expect(await screen.findByRole("alert")).toHaveTextContent("保存失败");
    expect(screen.getByText("https://new.test")).toBeInTheDocument();
    expect(screen.queryByText("http://old.test:5660")).not.toBeInTheDocument();
  });

  it("版本冲突不丢输入，显式重新载入后才替换草稿", async () => {
    state.save.mockRejectedValue(new ApiRequestError(409));
    render(<AccessAddressesEditor userId="admin" online />);
    click("添加当前地址"); add("https://draft.test"); click("保存");
    await screen.findByRole("alert");
    expect(screen.getByText("https://draft.test")).toBeInTheDocument();
    state.data = { origins: [current, "https://other.test"], version: 5, currentOrigin: current };
    click("放弃当前修改，重新载入已保存地址");
    await waitFor(() => expect(screen.getByText("https://other.test")).toBeInTheDocument());
    expect(screen.queryByText("https://draft.test")).not.toBeInTheDocument();
  });

  it("离线和代理识别不一致时不允许保存", () => {
    state.data!.currentOrigin = "http://internal:5660";
    const view = render(<AccessAddressesEditor userId="admin" online />);
    click("添加当前地址");
    expect(screen.getByText(/检查反向代理配置/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "保存" })).toBeDisabled();
    view.rerender(<AccessAddressesEditor userId="admin" online={false} />);
    expect(screen.getByLabelText("添加地址")).toBeDisabled();
  });

  it.each(["https://user:pass@example.com", "http://*.example.com", "https://example.com/a/..", "https://example.com?x=1", "https://example.com#x", "https:///example.com", "https://example.com\\", "ftp://example.com"])("拒绝非 Origin 输入 %s", (value) => {
    expect(() => normalizeAccessAddress(value)).toThrow();
  });

  it("支持 IPv6 和非默认端口", () => {
    expect(normalizeAccessAddress("http://[::1]:5660/")).toBe("http://[::1]:5660");
    expect(normalizeAccessAddress("https://EXAMPLE.com:443/")).toBe("https://example.com");
  });
});
