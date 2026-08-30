// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";

import { ExpenseCategoryIllustration } from "@/features/expenses/components/expense-category-illustration";

test("分类插画复用已提交 WebP，并作为装饰图片隐藏于辅助技术", () => {
  render(<ExpenseCategoryIllustration category="FOOD" />);

  const image = screen.getByRole("presentation", { hidden: true });
  expect(image).toHaveAttribute("data-category-illustration", "FOOD");
  expect(image.getAttribute("src")).toContain("expense-categories%2Ffood.webp");
  expect(image).toHaveAttribute("alt", "");
  expect(image).toHaveAttribute("aria-hidden", "true");
});
