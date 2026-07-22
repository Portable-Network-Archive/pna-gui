import { beforeEach, expect, it, vi } from "vitest";

const bridge = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({ invoke: bridge.invoke }));

import { comparisonApi } from "../../src/features/comparison/api";

beforeEach(() => bridge.invoke.mockReset().mockResolvedValue({ items: [] }));

it("[UI-COMPARE-PAGE-IPC-SHAPE] sends the backend paging contract without field-name translation", async () => {
  const request = {
    jobId: "job-42",
    kinds: ["content_changed" as const],
    query: "docs/",
    cursor: 200,
    limit: 200,
  };

  await comparisonApi.page(request);

  expect(bridge.invoke).toHaveBeenCalledWith("comparison_page", { request });
});
