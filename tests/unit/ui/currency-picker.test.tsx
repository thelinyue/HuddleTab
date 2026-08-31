// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import {
  CurrencyPickerOptions,
  CurrencyPickerTrigger,
} from "@/features/currency/components/currency-picker";

beforeEach(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn(),
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test("币种触发器展示 ISO code 和中文名称", () => {
  render(
    <CurrencyPickerTrigger value="CNY" onClick={vi.fn()} label="主币种" />,
  );

  expect(screen.getByRole("button", { name: "主币种" })).toHaveTextContent(
    "CNY · 人民币",
  );
});

test("币种选择器分开常用和全部币种且不会重复展示", () => {
  render(<CurrencyPickerOptions value="CNY" onSelect={vi.fn()} />);

  expect(screen.getByText("常用")).toBeVisible();
  expect(screen.getByText("全部币种")).toBeVisible();
  expect(screen.getAllByText("CNY")).toHaveLength(1);
  expect(screen.getByText("AUD").parentElement).toHaveTextContent("澳元");
  expect(screen.queryByText("BTC")).not.toBeInTheDocument();
});

test("搜索中文名称后只选择对应 ISO code", async () => {
  const user = userEvent.setup();
  const onSelect = vi.fn();
  render(<CurrencyPickerOptions value="CNY" onSelect={onSelect} />);

  await user.type(screen.getByRole("combobox", { name: "搜索币种" }), "日元");
  expect(screen.getByText("JPY")).toBeVisible();
  expect(screen.queryByText("CNY")).not.toBeInTheDocument();

  await user.click(screen.getByText("JPY"));
  expect(onSelect).toHaveBeenCalledWith("JPY");
});
