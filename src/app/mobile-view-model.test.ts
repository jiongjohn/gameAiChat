import { describe, expect, test } from "vitest";
import { updateCharacterConfig } from "@/server/admin-service";
import { activateCharacterForUser, createCharacterForState, createInitialState, createMomentForUser } from "@/server/companion-service";
import { buildAddableContacts, buildChatThreads, buildMomentFeed } from "./mobile-view-model";

describe("mobile view model", () => {
  test("builds chat threads with character, conversation and latest message", () => {
    const state = createInitialState("2026-07-06T08:00:00.000Z");
    const threads = buildChatThreads(state, "u_demo");

    expect(threads).toHaveLength(2);
    expect(threads[0].character.name).toBe("沈既白");
    expect(threads[0].latestMessage?.content).toContain("到家了吗");
    expect(threads[0].conversation.id).toBe("conv_shen-jibai");
  });

  test("buildAddableContacts lists only visible, not-yet-activated characters", () => {
    const base = createInitialState("2026-07-06T08:00:00.000Z");
    const created = createCharacterForState(base, { name: "林深", now: "2026-07-06T09:00:00.000Z" });

    expect(buildAddableContacts(created.state, "u_demo")).toHaveLength(0);

    const visible = updateCharacterConfig(created.state, {
      characterId: created.character.id,
      visibility: "public"
    });
    const addable = buildAddableContacts(visible, "u_demo");
    expect(addable.map((item) => item.id)).toEqual([created.character.id]);

    const activated = activateCharacterForUser(visible, {
      userId: "u_demo",
      characterId: created.character.id,
      now: "2026-07-06T09:01:00.000Z"
    });
    expect(buildAddableContacts(activated.state, "u_demo")).toHaveLength(0);
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
