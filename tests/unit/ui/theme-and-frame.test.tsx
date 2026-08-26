// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";

import { AppFrame } from "@/components/design-system/app-frame";
import { StatusBadge } from "@/components/design-system/status-badge";

test("核心容器居中加宽且状态不只依赖颜色", () => {
  render(
    <AppFrame>
      <StatusBadge tone="warning" icon="sync">
        待同步
      </StatusBadge>
    </AppFrame>,
  );

  expect(screen.getByTestId("app-frame")).toHaveClass("max-w-3xl", "mx-auto");
  expect(screen.getByText("待同步")).toBeVisible();
  expect(screen.getByRole("img", { name: "同步状态" })).toBeVisible();
});
