import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, test, vi } from "vitest";
import { rename, writeFile } from "node:fs/promises";
import { JsonCompanionStore } from "./store";

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    writeFile: vi.fn(actual.writeFile),
    rename: vi.fn(actual.rename)
  };
});

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

  test("write is atomic: temp file then rename, no leftover tmp, trailing newline", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "ai-chat-store-"));
    const filePath = join(tempDir, "state.json");
    const store = new JsonCompanionStore(filePath);

    const writeSpy = vi.mocked(writeFile);
    const renameSpy = vi.mocked(rename);

    {
      const initial = await store.read();
      const state = {
        ...initial,
        auditLogs: [
          {
            id: "atomic",
            scene: "test",
            contentRef: "z",
            providerResult: "ok",
            action: "recorded" as const,
            createdAt: "2026-07-06T00:00:00.000Z"
          }
        ]
      };

      writeSpy.mockClear();
      renameSpy.mockClear();

      await store.write(state);

      expect(renameSpy).toHaveBeenCalled();
      const renameArgs = renameSpy.mock.calls.at(-1)!;
      expect(String(renameArgs[0])).toContain(".tmp");
      expect(renameArgs[1]).toBe(filePath);

      const writeTargets = writeSpy.mock.calls.map((call) => String(call[0]));
      expect(writeTargets.every((target) => target.includes(".tmp"))).toBe(true);
      expect(writeTargets.every((target) => target !== filePath)).toBe(true);

      const roundTrip = await store.read();
      expect(roundTrip).toStrictEqual(state);

      const onDisk = await readFile(filePath, "utf8");
      expect(onDisk).toBe(`${JSON.stringify(state, null, 2)}\n`);

      const siblings = await readdir(tempDir);
      expect(siblings.some((name) => name.includes(".tmp"))).toBe(false);
    }
  });
});
