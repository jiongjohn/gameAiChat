import { describe, expect, test } from "vitest";
import { createInitialState, createMomentForUser } from "@/server/companion-service";
import { buildChatThreads, buildMomentFeed } from "./mobile-view-model";

describe("mobile view model", () => {
  test("builds chat threads with character, conversation and latest message", () => {
    const state = createInitialState("2026-07-06T08:00:00.000Z");
    const threads = buildChatThreads(state, "u_demo");

    expect(threads).toHaveLength(2);
    expect(threads[0].character.name).toBe("沈既白");
    expect(threads[0].latestMessage?.content).toContain("到家了吗");
    expect(threads[0].conversation.id).toBe("conv_shen-jibai");
  });

  test("builds a newest-first moment feed with character metadata", () => {
    const state = createMomentForUser(createInitialState("2026-07-06T08:00:00.000Z"), {
      userId: "u_demo",
      characterId: "shen-jibai",
      now: "2026-07-06T12:00:00.000Z"
    });
    const feed = buildMomentFeed(state, "u_demo");

    expect(feed).toHaveLength(1);
    expect(feed[0].character.name).toBe("沈既白");
    expect(feed[0].moment.content).toContain("存起来");
  });
});
