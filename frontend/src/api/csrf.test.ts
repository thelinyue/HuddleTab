import { afterEach, describe, expect, it, vi } from "vitest";
import { apiClient } from "./client";
import { clearCsrfToken, csrfToken } from "./csrf";

function jsonResponse(token: string): Response {
  return new Response(JSON.stringify({ data: { token } }), {
    headers: { "Content-Type": "application/json" },
  });
}

function csrfResponse(token: string) {
  return {
    data: { data: { token } },
    response: jsonResponse(token),
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

afterEach(() => {
  clearCsrfToken();
  vi.restoreAllMocks();
});

describe("CSRF token Session 边界", () => {
  it("清理后忽略旧请求的迟到回写并获取新 token", async () => {
    const oldRequest = deferred<ReturnType<typeof csrfResponse>>();
    const get = vi.spyOn(apiClient, "GET")
      .mockImplementationOnce(() => oldRequest.promise as never)
      .mockResolvedValueOnce(csrfResponse("csrf-new"));

    const oldToken = csrfToken();
    clearCsrfToken();
    oldRequest.resolve(csrfResponse("csrf-old"));
    expect(await oldToken).toBe("csrf-old");

    expect(await csrfToken()).toBe("csrf-new");
    expect(get).toHaveBeenCalledTimes(2);
  });
});
