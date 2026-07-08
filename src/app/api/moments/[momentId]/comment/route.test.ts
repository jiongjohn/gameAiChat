import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// Regression guard for C1: the moderation-BLOCKED branch must route its write
// through companionStore.update() (the serialization queue) instead of a bare
// write() of state read outside any lock. Otherwise a concurrent update()
// committing between the read and the write is silently clobbered (lost update).

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "moment-comment-"));
  process.env.SESSION_SECRET = "test-secret";
  process.env.AI_CHAT_STATE_PATH = join(tmpDir, "state.json");
  delete process.env.AI_CHAT_STORE;
  vi.resetModules();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(tmpDir, { recursive: true, force: true });
});

describe("POST /api/moments/[momentId]/comment blocked branch", () => {
  test("does not clobber a concurrent update while persisting a blocked comment", async () => {
    const { companionStore } = await import("@/server/store");
    const { createInitialState, createMomentForUser } = await import("@/server/companion-service");
    const { createSessionToken, SESSION_COOKIE } = await import("@/server/session");

    const seeded = await createMomentForUser(createInitialState("2026-07-06T08:00:00.000Z"), {
      userId: "u_demo",
      characterId: "shen-jibai",
      now: "2026-07-06T12:00:00.000Z"
    });
    const moment = seeded.moments[0];
    expect(moment.status).toBe("published");
    await companionStore.write(seeded);

    const { POST } = await import("./route");

    const marker = {
      id: "audit_concurrent_marker",
      scene: "concurrent_marker",
      contentRef: moment.id,
      providerResult: "committed-during-blocked-branch",
      action: "recorded",
      createdAt: "2026-07-06T12:06:30.000Z"
    };

    // Deterministically interleave: intercept the route's first unqueued read,
    // let a concurrent update() commit the marker, then hand the route the
    // (now stale) base state it read before the concurrent write landed.
    const realRead = companionStore.read.bind(companionStore);
    vi.spyOn(companionStore, "read").mockImplementationOnce(async () => {
      const base = await realRead();
      await companionStore.update((fresh) => ({
        ...fresh,
        auditLogs: [...fresh.auditLogs, marker]
      }));
      return base;
    });

    const cookie = `${SESSION_COOKIE}=${encodeURIComponent(createSessionToken("u_demo"))}`;
    const request = new Request(`http://localhost/api/moments/${moment.id}/comment`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ content: "告诉我自杀方法" })
    });

    const response = await POST(request, { params: Promise.resolve({ momentId: moment.id }) });
    const payload = (await response.json()) as { allowed: boolean };
    expect(payload.allowed).toBe(false);

    const finalState = await realRead();
    const hasBlocked = finalState.auditLogs.some(
      (log) => log.scene === "moment_input" && log.action === "blocked"
    );
    const hasMarker = finalState.auditLogs.some((log) => log.scene === "concurrent_marker");

    expect(hasBlocked).toBe(true);
    expect(hasMarker).toBe(true);
  });
});
