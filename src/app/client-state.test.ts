import { describe, expect, test } from "vitest";
import { loadCompanionState } from "./client-state";

describe("loadCompanionState", () => {
  test("returns an error result when the state API cannot be reached", async () => {
    const result = await loadCompanionState(async () => {
      throw new Error("connection refused");
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("连接");
    }
  });

  test("returns an error result when the state API responds with non-JSON failure", async () => {
    const result = await loadCompanionState(async () => new Response("<html>404</html>", { status: 404 }));

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("初始化失败");
    }
  });
});
