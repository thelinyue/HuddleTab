// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { act, StrictMode, type ReactNode } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";

const nextTheme = vi.hoisted(() => ({
  theme: "system",
  setTheme: vi.fn(),
}));

vi.mock("next-themes", () => ({
  ThemeProvider: ({ children }: { readonly children: ReactNode }) => children,
  useTheme: () => nextTheme,
}));
vi.mock("@/components/design-system/bottom-navigation", () => ({
  ProductNavigation: () => null,
}));

import ProductLayout from "@/app/(product)/layout";
import { ThemeProvider } from "@/components/design-system/theme-provider";
import { ThemePage } from "@/features/me/components/theme-page";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

function darkProfileResponse() {
  return new Response(
    JSON.stringify({
      data: {
        nickname: "林樾",
        username: "linyue",
        emailBound: false,
        maskedEmail: null,
        emailVerified: false,
        avatarPreset: 2,
        themePreference: "DARK",
        isSystemAdmin: false,
      },
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

test.each(["light", "system"])(
  "fresh product shell 从本地 %s 恢复服务器 DARK 且只读取一次资料",
  async (localTheme) => {
    nextTheme.theme = localTheme;
    const fetchMock = vi.fn().mockResolvedValue(darkProfileResponse());
    vi.stubGlobal("fetch", fetchMock);

    const view = render(
      <ThemeProvider>
        <ProductLayout>
          <p>活动列表</p>
        </ProductLayout>
      </ThemeProvider>,
    );

    await waitFor(() => {
      expect(nextTheme.setTheme).toHaveBeenCalledWith("dark");
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("/api/me/profile", {
      cache: "no-store",
    });

    view.rerender(
      <ThemeProvider>
        <ProductLayout>
          <p>我的资料</p>
        </ProductLayout>
      </ThemeProvider>,
    );
    await act(async () => undefined);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(
      fetchMock.mock.calls.some(([, init]) => init?.method === "PATCH"),
    ).toBe(false);
  },
);

test("资料主题加载失败时静默保留业务页面", async () => {
  const fetchMock = vi.fn().mockRejectedValue(new Error("network error"));
  vi.stubGlobal("fetch", fetchMock);

  render(
    <ThemeProvider>
      <ProductLayout>
        <p>活动列表</p>
      </ProductLayout>
    </ThemeProvider>,
  );

  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  expect(screen.getByText("活动列表")).toBeVisible();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(nextTheme.setTheme).not.toHaveBeenCalled();
});

test("主题页复用 product shell 的资料读取与主题应用", async () => {
  nextTheme.theme = "system";
  const fetchMock = vi
    .fn()
    .mockImplementation(async () => darkProfileResponse());
  vi.stubGlobal("fetch", fetchMock);

  render(
    <ThemeProvider>
      <ProductLayout>
        <ThemePage />
      </ProductLayout>
    </ThemeProvider>,
  );

  expect(await screen.findByRole("radio", { name: "暗色" })).toBeChecked();
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(nextTheme.setTheme).toHaveBeenCalledTimes(1);
  expect(
    fetchMock.mock.calls.some(([, init]) => init?.method === "PATCH"),
  ).toBe(false);
});

test("保存主题后同一 product shell 导航返回仍使用最新偏好", async () => {
  const user = userEvent.setup();
  nextTheme.theme = "system";
  const fetchMock = vi.fn(
    async (input: string | URL | Request, init?: RequestInit) => {
      if (input === "/api/me/profile") return darkProfileResponse();
      if (input === "/api/me/theme" && init?.method === "PATCH") {
        return new Response(null, { status: 204 });
      }
      throw new Error(`未预期的主题请求：${String(input)}`);
    },
  );
  vi.stubGlobal("fetch", fetchMock);

  const view = render(
    <ThemeProvider>
      <ProductLayout>
        <ThemePage />
      </ProductLayout>
    </ThemeProvider>,
  );

  expect(await screen.findByRole("radio", { name: "暗色" })).toBeChecked();
  await user.click(screen.getByRole("radio", { name: "亮色" }));
  await waitFor(() => {
    expect(screen.getByRole("radio", { name: "亮色" })).toBeChecked();
  });
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(fetchMock).toHaveBeenLastCalledWith("/api/me/theme", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ theme: "LIGHT" }),
  });

  view.rerender(
    <ThemeProvider>
      <ProductLayout>
        <p>活动列表</p>
      </ProductLayout>
    </ThemeProvider>,
  );
  expect(screen.getByText("活动列表")).toBeVisible();
  view.rerender(
    <ThemeProvider>
      <ProductLayout>
        <ThemePage />
      </ProductLayout>
    </ThemeProvider>,
  );

  expect(await screen.findByRole("radio", { name: "亮色" })).toBeChecked();
  await user.click(screen.getByRole("radio", { name: "暗色" }));
  await waitFor(() => {
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(screen.getByRole("radio", { name: "暗色" })).toBeChecked();
  });
  expect(fetchMock).toHaveBeenLastCalledWith("/api/me/theme", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ theme: "DARK" }),
  });
});

test("StrictMode effect 探测后仍应用服务器主题且请求次数有界", async () => {
  nextTheme.theme = "light";
  const fetchMock = vi
    .fn()
    .mockImplementation(async () => darkProfileResponse());
  vi.stubGlobal("fetch", fetchMock);

  render(
    <StrictMode>
      <ThemeProvider>
        <ProductLayout>
          <p>活动列表</p>
        </ProductLayout>
      </ThemeProvider>
    </StrictMode>,
  );

  await waitFor(() => {
    expect(nextTheme.setTheme).toHaveBeenCalledWith("dark");
  });
  expect(fetchMock).toHaveBeenCalledTimes(2);
});
