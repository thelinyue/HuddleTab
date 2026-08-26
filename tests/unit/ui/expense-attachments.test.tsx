// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";

import { ExpenseAttachments } from "@/features/attachments/expense-attachments";

test("消费详情通过受控下载 URL 展示附件，不暴露内部存储路径", () => {
  render(
    <ExpenseAttachments
      activityId="activity-1"
      expenseId="expense-1"
      attachments={[
        {
          id: "attachment-1",
          filename: "receipt.webp",
          mimeType: "image/webp",
        },
      ]}
    />,
  );

  const image = screen.getByRole("img", { name: "附件：receipt.webp" });
  expect(image).toHaveAttribute(
    "src",
    "/api/activities/activity-1/expenses/expense-1/attachments/attachment-1",
  );
  expect(image.getAttribute("src")).not.toContain("storageKey");
  expect(
    screen.getByRole("link", { name: "查看附件 receipt.webp" }),
  ).toHaveAttribute(
    "href",
    "/api/activities/activity-1/expenses/expense-1/attachments/attachment-1",
  );
});
