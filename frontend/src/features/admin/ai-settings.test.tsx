import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiRequestError } from "../../api/error";
import { PwaUpdateSafetyProvider, usePwaUpdateBlocked } from "../../app/pwa-update-safety";
import type { AiSettings, AiSettingsInput } from "./api";

const state = vi.hoisted(() => ({ data: undefined as AiSettings | undefined, refetch: vi.fn(), save: vi.fn() }));
vi.mock("./api", () => ({
  useAiSettingsQuery: () => ({ data: state.data, error: null, refetch: state.refetch }),
  useUpdateAiSettingsMutation: () => ({ mutateAsync: state.save, isPending: false }),
}));
import { AiSettingsEditor } from "./ai-settings";

function fixture(): AiSettings {
  return { enabled: true, baseUrl: "https://api.example.com/v1", apiKeyStatus: "CONFIGURED", models: [{ name: "vision", supportsImage: true }, { name: "text", supportsImage: false }], defaultModel: "vision", imageEnabled: true, maxImageBytes: 10485760, timeoutSeconds: 30, jsonMode: true, version: 4 };
}
function UpdateLock() { return <output aria-label="更新保护">{usePwaUpdateBlocked() ? "已锁定" : "可更新"}</output>; }
function page(online = true) { return <PwaUpdateSafetyProvider><AiSettingsEditor userId="admin" online={online} /><UpdateLock /></PwaUpdateSafetyProvider>; }
function click(name: string) { fireEvent.click(screen.getByRole("button", { name })); }
function fill(label: string, value: string) { fireEvent.change(screen.getByLabelText(label, { exact: true }), { target: { value } }); }
function toggle(label: string) { fireEvent.click(screen.getByRole("switch", { name: label })); }
function checked(label: string, value: boolean) { expect(screen.getByRole("switch", { name: label })).toHaveAttribute("aria-checked", String(value)); }

beforeEach(() => {
  state.data = fixture();
  state.refetch.mockReset().mockImplementation(async () => ({ data: state.data }));
  state.save.mockReset().mockImplementation(async (input: AiSettingsInput) => {
    const { apiKey, clearApiKey, ...fields } = input;
    return { ...state.data, ...fields, apiKeyStatus: clearApiKey ? "NOT_SET" : apiKey ? "CONFIGURED" : state.data!.apiKeyStatus, version: input.version + 1 };
  });
});
afterEach(cleanup);

describe("AI 配置页面草稿与模型面板", () => {
  it("关闭面板丢弃输入，完成首个模型自动设为默认，后续添加保留默认", async () => {
    state.data = { ...fixture(), models: [], defaultModel: null, enabled: false, imageEnabled: false };
    render(page());
    click("添加"); fill("模型 ID", "cancelled"); click("关闭添加模型");
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText("更新保护")).toHaveTextContent("可更新"));
    click("添加"); fill("模型 ID", "  first  "); click("完成");
    expect(screen.getByRole("radio", { name: "使用 first 作为默认模型" })).toBeChecked();
    click("添加"); fill("模型 ID", "second"); click("完成");
    expect(screen.getByRole("radio", { name: "使用 first 作为默认模型" })).toBeChecked();
    expect(state.save).not.toHaveBeenCalled();
    click("保存设置");
    await waitFor(() => expect(state.save).toHaveBeenCalledWith(expect.objectContaining({ defaultModel: "first", models: [{ name: "first", supportsImage: false }, { name: "second", supportsImage: false }] })));
  });

  it("默认模型重命名后保持选中，提交使用新 ID 且不泄露前端标识", async () => {
    render(page());
    expect(screen.getByRole("button", { name: "保存设置" })).toBeDisabled();
    expect(screen.queryByLabelText("新的 API 密钥")).not.toBeInTheDocument();
    click("编辑模型 vision"); fill("模型 ID", "renamed"); click("完成");
    expect(screen.getByRole("radio", { name: "使用 renamed 作为默认模型" })).toBeChecked();
    click("保存设置");
    await waitFor(() => expect(screen.getByText("设置已保存")).toBeInTheDocument());
    expect(state.save).toHaveBeenCalledWith(expect.objectContaining({ defaultModel: "renamed", models: [{ name: "renamed", supportsImage: true }, { name: "text", supportsImage: false }], version: 4, clearApiKey: false }));
    expect(state.save.mock.calls[0][0]).not.toHaveProperty("apiKey");
    expect(screen.getByRole("button", { name: "保存设置" })).toBeDisabled();
    await waitFor(() => expect(screen.getByLabelText("更新保护")).toHaveTextContent("可更新"));
  });

  it("面板拒绝空白、重复和超长 ID，按 Unicode 字符计数", () => {
    render(page()); click("添加");
    fill("模型 ID", "  "); click("完成");
    expect(screen.getByText("模型 ID 需为 1–128 个字符。")).toBeInTheDocument();
    fill("模型 ID", " vision "); click("完成");
    expect(screen.getByText("该模型 ID 已存在。")).toBeInTheDocument();
    fill("模型 ID", "界".repeat(129)); click("完成");
    expect(screen.getByText("模型 ID 需为 1–128 个字符。")).toBeInTheDocument();
    fill("模型 ID", "🙂".repeat(128)); click("完成");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getAllByRole("radio")).toHaveLength(3);
  });

  it("32 个模型时禁止继续添加，仍可编辑", () => {
    state.data = { ...fixture(), models: Array.from({ length: 32 }, (_, i) => ({ name: `m${i}`, supportsImage: false })), defaultModel: "m0", imageEnabled: false };
    render(page());
    expect(screen.getByRole("button", { name: "添加" })).toBeDisabled();
    click("编辑模型 m31"); fill("模型 ID", "new-name"); click("完成");
    expect(screen.getAllByRole("radio")).toHaveLength(32);
  });

  it("删除默认模型必须指定替代项，取消保留原列表", () => {
    render(page()); click("编辑模型 vision"); click("删除模型");
    expect(screen.getByRole("button", { name: "删除并替换默认模型" })).toBeDisabled();
    click("取消"); click("关闭编辑模型");
    expect(screen.getAllByRole("radio")).toHaveLength(2);
    click("编辑模型 vision"); click("删除模型");
    fireEvent.change(screen.getByLabelText("新的默认模型", { exact: true }), { target: { value: "saved-1" } });
    click("删除并替换默认模型");
    expect(screen.getByRole("radio", { name: "使用 text 作为默认模型" })).toBeChecked();
    checked("启用图片识别", false);
    expect(screen.getByText(/默认模型不支持图片识别，图片识别已关闭/)).toBeInTheDocument();
    expect(state.save).not.toHaveBeenCalled();
  });

  it("删除普通模型仅改草稿，删除最后一个模型明确关闭 AI 与图片", async () => {
    render(page()); click("编辑模型 text"); click("删除模型");
    expect(screen.getAllByRole("radio")).toHaveLength(1);
    expect(state.save).not.toHaveBeenCalled();
    click("编辑模型 vision"); click("删除模型"); click("删除并关闭 AI");
    checked("启用 AI 智能录入", false); checked("启用图片识别", false);
    click("保存设置");
    await waitFor(() => expect(state.save).toHaveBeenCalledWith(expect.objectContaining({ models: [], defaultModel: null, enabled: false, imageEnabled: false })));
  });

  it("默认切换、能力修改或关闭 AI 均关闭图片，条件恢复后需手动开启", () => {
    render(page());
    fireEvent.click(screen.getByRole("radio", { name: "使用 text 作为默认模型" })); checked("启用图片识别", false);
    fireEvent.click(screen.getByRole("radio", { name: "使用 vision 作为默认模型" })); checked("启用图片识别", false);
    toggle("启用图片识别"); checked("启用图片识别", true);
    click("编辑模型 vision"); toggle("支持图片识别"); click("完成"); checked("启用图片识别", false);
    click("编辑模型 vision"); toggle("支持图片识别"); click("完成"); checked("启用图片识别", false);
    toggle("启用图片识别"); toggle("启用 AI 智能录入"); checked("启用图片识别", false);
    toggle("启用 AI 智能录入"); checked("启用图片识别", false);
  });

  it("密钥更换与清除互斥、清除可撤销，成功后清空新密钥", async () => {
    render(page()); click("更换"); fill("新的 API 密钥", "private-new-key"); click("清除");
    expect(screen.queryByLabelText("新的 API 密钥")).not.toBeInTheDocument();
    checked("启用 AI 智能录入", false); checked("启用图片识别", false);
    click("撤销清除"); checked("启用 AI 智能录入", true);
    click("更换"); expect(screen.getByLabelText("新的 API 密钥")).toHaveValue("");
    fill("新的 API 密钥", "  replacement  "); click("保存设置");
    await waitFor(() => expect(screen.getByText("设置已保存")).toBeInTheDocument());
    expect(state.save).toHaveBeenCalledWith(expect.objectContaining({ apiKey: "replacement", clearApiKey: false }));
    expect(screen.queryByLabelText("新的 API 密钥")).not.toBeInTheDocument();
    click("清除"); click("保存设置");
    await waitFor(() => expect(screen.getByLabelText("新的 API 密钥")).toHaveValue(""));
    expect(state.save.mock.lastCall![0]).toEqual(expect.objectContaining({ clearApiKey: true, enabled: false, imageEnabled: false, version: 5 }));
    expect(state.save.mock.lastCall![0]).not.toHaveProperty("apiKey");
  });

  it("未配置或无法解密时直接显示密钥输入，启用时校验密钥", () => {
    state.data = { ...fixture(), apiKeyStatus: "RECONFIGURATION_REQUIRED" };
    render(page());
    expect(screen.getByRole("alert")).toHaveTextContent("无法解密");
    fill("请求超时", "60"); click("保存设置");
    expect(screen.getByLabelText("新的 API 密钥")).toHaveFocus();
    expect(state.save).not.toHaveBeenCalled();
  });

  it("校验地址和数字范围，按字段顺序聚焦首个错误", () => {
    render(page()); fill("接口地址", "https://api.example.com/v1/chat/completions"); fill("请求超时", "121"); fill("图片大小上限", "0"); click("保存设置");
    expect(screen.getByLabelText("接口地址")).toHaveFocus();
    fill("接口地址", "https://api.example.com/v1"); click("保存设置");
    expect(screen.getByLabelText("图片大小上限")).toHaveFocus();
    fill("图片大小上限", "10"); click("保存设置");
    expect(screen.getByLabelText("请求超时")).toHaveFocus();
    expect(state.save).not.toHaveBeenCalled();
  });

  it("保存期间锁定编辑并阻止重复请求，失败保留草稿且可重试", async () => {
    let reject!: (reason: unknown) => void;
    state.save.mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; }));
    render(page()); click("更换"); fill("新的 API 密钥", "retry-secret"); fill("请求超时", "60"); click("保存设置"); click("保存设置");
    expect(state.save).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("接口地址")).toBeDisabled();
    expect(screen.getByRole("button", { name: "编辑模型 vision" })).toBeDisabled();
    await act(async () => reject(new Error("网络失败")));
    expect(screen.getByRole("alert")).toHaveTextContent("网络失败");
    expect(screen.getByLabelText("新的 API 密钥")).toHaveValue("retry-secret");
    expect(screen.getByLabelText("请求超时")).toHaveValue(60);
    click("保存设置"); await waitFor(() => expect(screen.getByText("设置已保存")).toBeInTheDocument());
  });

  it("刷新与离线均保留页面和面板草稿，并持有 PWA 更新保护", () => {
    const view = render(page()); click("更换"); fill("新的 API 密钥", "local-secret"); fill("请求超时", "60");
    state.data = { ...fixture(), timeoutSeconds: 90, version: 5 };
    view.rerender(page(false));
    expect(screen.getByLabelText("请求超时")).toHaveValue(60);
    expect(screen.getByLabelText("新的 API 密钥")).toHaveValue("local-secret");
    expect(screen.getByRole("button", { name: "保存设置" })).toBeDisabled();
    expect(screen.getByLabelText("更新保护")).toHaveTextContent("已锁定");
    view.rerender(page()); click("恢复已保存");
    expect(screen.getByLabelText("请求超时")).toHaveValue(30);
    expect(screen.queryByLabelText("新的 API 密钥")).not.toBeInTheDocument();
    click("编辑模型 vision"); fill("模型 ID", "panel-draft");
    state.data = { ...fixture(), models: [{ name: "remote", supportsImage: false }], version: 6 };
    view.rerender(page(false)); expect(screen.getByLabelText("模型 ID")).toHaveValue("panel-draft");
    view.rerender(page()); click("完成");
    expect(screen.getByRole("radio", { name: "使用 panel-draft 作为默认模型" })).toBeChecked();
  });

  it("保存成功后旧查询结果不能在关闭面板时回退已保存值和版本", async () => {
    render(page()); fill("请求超时", "60"); click("保存设置");
    await waitFor(() => expect(screen.getByText("设置已保存")).toBeInTheDocument());
    // 模拟 PUT 已返回新版本，但后台 GET 失败，查询缓存仍是旧版本。
    click("编辑模型 vision"); click("关闭编辑模型");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByLabelText("请求超时")).toHaveValue(60);
    fill("请求超时", "90"); click("保存设置");
    await waitFor(() => expect(state.save.mock.lastCall![0]).toEqual(expect.objectContaining({ version: 5, timeoutSeconds: 90 })));
  });

  it("409 保留输入与旧版本，明确放弃后才载入最新版本", async () => {
    state.save.mockRejectedValueOnce(new ApiRequestError(409));
    const view = render(page()); fill("请求超时", "60"); click("保存设置");
    expect(await screen.findByRole("alert")).toHaveTextContent("其他管理员修改");
    state.data = { ...fixture(), timeoutSeconds: 90, version: 5 }; view.rerender(page());
    expect(screen.getByLabelText("请求超时")).toHaveValue(60);
    expect(screen.getByText("重新加载将放弃当前未保存的修改。")).toBeInTheDocument();
    click("放弃修改并重新加载");
    await waitFor(() => expect(screen.getByLabelText("请求超时")).toHaveValue(90));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    fill("请求超时", "100"); click("保存设置");
    await waitFor(() => expect(state.save.mock.lastCall![0]).toEqual(expect.objectContaining({ version: 5 })));
  });
});
