import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, test } from "vitest";
import { JsonCompanionStore } from "./store";

let tempDir: string | undefined;

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  }
});

describe("JsonCompanionStore", () => {
  test("seeds state on first read and persists updates", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "ai-chat-store-"));
    const store = new JsonCompanionStore(join(tempDir, "state.json"));

    const first = await store.read();
    const updated = await store.write({
      ...first,
      moments: [
        {
          id: "custom",
          characterId: "shen-jibai",
          userId: "u_demo",
          content: "测试动态",
          imageKey: "rain-window",
          status: "published",
          publishAt: "2026-07-06T00:00:00.000Z",
          createdAt: "2026-07-06T00:00:00.000Z"
        }
      ]
    });
    const second = await store.read();

    expect(first.users[0].id).toBe("u_demo");
    expect(updated.moments[0].id).toBe("custom");
    expect(second.moments[0].id).toBe("custom");
  });

  test("updates state atomically through a callback", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "ai-chat-store-"));
    const store = new JsonCompanionStore(join(tempDir, "state.json"));

    const next = await store.update((state) => ({
      ...state,
      auditLogs: [
        ...state.auditLogs,
        {
          id: "a1",
          scene: "test",
          contentRef: "x",
          providerResult: "ok",
          action: "recorded",
          createdAt: "2026-07-06T00:00:00.000Z"
        }
      ]
    }));

    expect(next.auditLogs).toHaveLength(1);
  });
});
