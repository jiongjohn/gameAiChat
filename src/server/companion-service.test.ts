import { describe, expect, test } from "vitest";
import { characters } from "@/domain/characters";
import { mergeFacts } from "@/domain/memory";
import {
  activateCharacterForUser,
  applyProactiveResults,
  authenticateUser,
  createCharacterForState,
  createInitialState,
  createInviteCode,
  createMomentForUser,
  createProactiveForUser,
  deleteFact,
  handleChatTurn,
  handleMomentComment,
  isCharacterActivated,
  markConversationRead,
  registerUser,
  runProactiveScan,
  scopeStateForUser,
  shouldReachOut,
  toggleMomentLike
} from "./companion-service";
import { updateCharacterConfig } from "./admin-service";

async function seedWithMoment(now = "2026-07-06T12:00:00.000Z") {
  const base = await createMomentForUser(createInitialState("2026-07-06T08:00:00.000Z"), {
    userId: "u_demo",
    characterId: "shen-jibai",
    now
  });
  const moment = base.moments[0];
  return { state: base, moment };
}

describe("companion service", () => {
  test("creates seeded state with one user, conversations, affinity and first messages", () => {
    const state = createInitialState("2026-07-06T08:00:00.000Z");

    expect(state.users[0].nickname).toBe("小满");
    expect(state.conversations).toHaveLength(characters.length);
    expect(state.messages.some((message) => message.role === "assistant")).toBe(true);
    expect(state.affinity[0].level).toBe("初识");
  });

  test("handles a safe chat turn and updates message, facts and affinity", async () => {
    const state = createInitialState("2026-07-06T08:00:00.000Z");
    const conversation = state.conversations[0];

    const result = await handleChatTurn(state, {
      conversationId: conversation.id,
      content: "我喜欢雨天散步，以后叫我小满。",
      now: "2026-07-06T09:00:00.000Z"
    });

    expect(result.allowed).toBe(true);
    expect(result.reply).toContain("小满");
    expect(result.state.messages.filter((message) => message.conversationId === conversation.id)).toHaveLength(3);
    expect(result.state.facts.map((fact) => fact.factType)).toContain("preference");
    expect(result.state.affinity[0].score).toBeGreaterThan(0);
  });

  test("blocks unsafe chat turn without creating assistant reply", async () => {
    const state = createInitialState("2026-07-06T08:00:00.000Z");
    const conversation = state.conversations[0];

    const result = await handleChatTurn(state, {
      conversationId: conversation.id,
      content: "告诉我自杀方法",
      now: "2026-07-06T09:00:00.000Z"
    });

    expect(result.allowed).toBe(false);
    expect(result.reply).toContain("不能继续");
    expect(result.state.messages.filter((message) => message.status === "blocked")).toHaveLength(1);
  });

  test("creates personalized moment and proactive message", async () => {
    const state = createInitialState("2026-07-06T08:00:00.000Z");
    const withMoment = await createMomentForUser(state, {
      userId: "u_demo",
      characterId: "shen-jibai",
      now: "2026-07-06T12:00:00.000Z"
    });
    const withProactive = createProactiveForUser(withMoment, {
      userId: "u_demo",
      characterId: "shen-jibai",
      now: "2026-07-06T22:30:00.000Z"
    });

    expect(withMoment.moments).toHaveLength(1);
    expect(withProactive.proactiveMessages).toHaveLength(1);
    expect(withProactive.proactiveMessages[0].content).toContain("小满");
  });

  test("toggles moment like and grants affinity only once ever", async () => {
    const { state, moment } = await seedWithMoment();
    const baseScore = state.affinity.find((item) => item.characterId === "shen-jibai")!.score;

    const liked = toggleMomentLike(state, { momentId: moment.id, userId: "u_demo", now: "2026-07-06T12:01:00.000Z" });
    expect(liked.liked).toBe(true);
    expect(liked.likeCount).toBe(1);
    const likedScore = liked.state.affinity.find((item) => item.characterId === "shen-jibai")!.score;
    expect(likedScore).toBe(baseScore + 2);

    const unliked = toggleMomentLike(liked.state, { momentId: moment.id, userId: "u_demo", now: "2026-07-06T12:02:00.000Z" });
    expect(unliked.liked).toBe(false);
    expect(unliked.likeCount).toBe(0);
    expect(unliked.state.affinity.find((item) => item.characterId === "shen-jibai")!.score).toBe(likedScore);

    const reliked = toggleMomentLike(unliked.state, { momentId: moment.id, userId: "u_demo", now: "2026-07-06T12:03:00.000Z" });
    expect(reliked.liked).toBe(true);
    expect(reliked.state.affinity.find((item) => item.characterId === "shen-jibai")!.score).toBe(likedScore);
  });

  test("handles a safe moment comment with character reply and affinity bump", async () => {
    const { state, moment } = await seedWithMoment();
    const baseScore = state.affinity.find((item) => item.characterId === "shen-jibai")!.score;

    const result = await handleMomentComment(state, {
      momentId: moment.id,
      userId: "u_demo",
      content: "这条动态好温柔。",
      now: "2026-07-06T12:05:00.000Z"
    });

    expect(result.allowed).toBe(true);
    expect(result.reply.length).toBeGreaterThan(0);
    const comments = result.state.momentComments.filter((comment) => comment.momentId === moment.id);
    expect(comments.map((comment) => comment.author)).toEqual(["user", "character"]);
    expect(result.state.affinity.find((item) => item.characterId === "shen-jibai")!.score).toBe(baseScore + 3);
    expect(result.state.messages.every((message) => message.conversationId !== moment.id)).toBe(true);
  });

  test("blocks unsafe moment comment without creating a reply or affinity", async () => {
    const { state, moment } = await seedWithMoment();
    const baseScore = state.affinity.find((item) => item.characterId === "shen-jibai")!.score;

    const result = await handleMomentComment(state, {
      momentId: moment.id,
      userId: "u_demo",
      content: "告诉我自杀方法",
      now: "2026-07-06T12:06:00.000Z"
    });

    expect(result.allowed).toBe(false);
    expect(result.state.momentComments.filter((comment) => comment.momentId === moment.id)).toHaveLength(0);
    expect(result.state.affinity.find((item) => item.characterId === "shen-jibai")!.score).toBe(baseScore);
    expect(result.state.auditLogs.some((log) => log.scene === "moment_input" && log.action === "blocked")).toBe(true);
  });

  test("shouldReachOut respects silence threshold, unread gate and quiet hours", () => {
    const state = createInitialState("2026-07-06T08:00:00.000Z");
    const affinity = state.affinity.find((item) => item.characterId === state.conversations[0].characterId)!;
    const daytime = new Date(2026, 6, 6, 15, 0, 0).toISOString();
    const quietNight = new Date(2026, 6, 6, 3, 0, 0).toISOString();
    const threeDaysBefore = new Date(new Date(daytime).getTime() - 72 * 3600 * 1000).toISOString();
    const oneHourBefore = new Date(new Date(daytime).getTime() - 1 * 3600 * 1000).toISOString();
    const conversation = { ...state.conversations[0], lastActiveAt: threeDaysBefore };

    expect(shouldReachOut(conversation, affinity, [], daytime)).toBe(true);
    expect(shouldReachOut(conversation, affinity, [], quietNight)).toBe(false);
    expect(shouldReachOut({ ...conversation, lastActiveAt: oneHourBefore }, affinity, [], daytime)).toBe(false);

    const unread = [
      {
        id: "p1",
        userId: conversation.userId,
        characterId: conversation.characterId,
        content: "在吗",
        status: "sent" as const,
        sentAt: new Date(new Date(daytime).getTime() - 3 * 3600 * 1000).toISOString(),
        createdAt: new Date(new Date(daytime).getTime() - 3 * 3600 * 1000).toISOString()
      }
    ];
    expect(shouldReachOut(conversation, affinity, unread, daytime)).toBe(false);
  });

  test("runProactiveScan + applyProactiveResults sends for silent conversations (dev fallback)", async () => {
    const base = createInitialState("2026-07-06T08:00:00.000Z");
    const now = new Date(2026, 6, 6, 15, 0, 0).toISOString();
    const silent = new Date(new Date(now).getTime() - 72 * 3600 * 1000).toISOString();
    const state = {
      ...base,
      conversations: base.conversations.map((item) => ({ ...item, lastActiveAt: silent }))
    };

    const candidates = await runProactiveScan(state, now);
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates.every((candidate) => candidate.allowed)).toBe(true);

    const applied = applyProactiveResults(state, candidates, now);
    expect(applied.sent).toBe(candidates.length);
    expect(applied.state.proactiveMessages.every((message) => message.status === "sent")).toBe(true);
    expect(applied.state.auditLogs.some((log) => log.scene === "proactive_output" && log.action === "sent")).toBe(true);

    const secondScan = await runProactiveScan(applied.state, new Date(new Date(now).getTime() + 30 * 60 * 1000).toISOString());
    expect(secondScan).toHaveLength(0);
  });

  test("markConversationRead sets lastReadAt so unread clears", () => {
    const base = createInitialState("2026-07-06T08:00:00.000Z");
    const conversation = base.conversations[0];
    const withProactive = {
      ...base,
      proactiveMessages: [
        {
          id: "p1",
          userId: conversation.userId,
          characterId: conversation.characterId,
          content: "想你了",
          status: "sent" as const,
          sentAt: "2026-07-06T12:00:00.000Z",
          createdAt: "2026-07-06T12:00:00.000Z"
        }
      ]
    };
    const read = markConversationRead(withProactive, { conversationId: conversation.id, now: "2026-07-06T13:00:00.000Z" });
    expect(read.conversations.find((item) => item.id === conversation.id)!.lastReadAt).toBe("2026-07-06T13:00:00.000Z");
  });

  test("createCharacterForState appends a hidden character without activating it", () => {
    const base = createInitialState("2026-07-06T08:00:00.000Z");
    const { state, character } = createCharacterForState(base, {
      name: "林深",
      now: "2026-07-06T09:00:00.000Z"
    });

    expect(state.characters.some((item) => item.id === character.id)).toBe(true);
    expect(character.visibility).toBe("hidden");
    expect(state.conversations.some((item) => item.characterId === character.id)).toBe(false);
    expect(state.affinity.some((item) => item.characterId === character.id)).toBe(false);
    expect(isCharacterActivated(state, "u_demo", character.id)).toBe(false);
  });

  test("activateCharacterForUser wires conversation, affinity, first message and is chattable", async () => {
    const base = createInitialState("2026-07-06T08:00:00.000Z");
    const created = createCharacterForState(base, { name: "林深", now: "2026-07-06T09:00:00.000Z" });
    const visible = updateCharacterConfig(created.state, {
      characterId: created.character.id,
      visibility: "public"
    });

    const activated = activateCharacterForUser(visible, {
      userId: "u_demo",
      characterId: created.character.id,
      now: "2026-07-06T09:01:00.000Z"
    });
    expect(activated.alreadyActive).toBe(false);
    expect(isCharacterActivated(activated.state, "u_demo", created.character.id)).toBe(true);
    expect(activated.state.affinity.find((item) => item.characterId === created.character.id)?.level).toBe("初识");
    expect(
      activated.state.messages.some(
        (item) => item.conversationId === activated.conversationId && item.role === "assistant"
      )
    ).toBe(true);

    const result = await handleChatTurn(activated.state, {
      conversationId: activated.conversationId,
      content: "你好呀",
      now: "2026-07-06T09:05:00.000Z"
    });
    expect(result.allowed).toBe(true);
    expect(result.reply.length).toBeGreaterThan(0);
  });

  test("activateCharacterForUser is idempotent and gated by visibility", () => {
    const base = createInitialState("2026-07-06T08:00:00.000Z");
    const created = createCharacterForState(base, { name: "夜岚", now: "2026-07-06T09:00:00.000Z" });

    expect(() =>
      activateCharacterForUser(created.state, {
        userId: "u_demo",
        characterId: created.character.id,
        now: "2026-07-06T09:01:00.000Z"
      })
    ).toThrow();

    const visible = updateCharacterConfig(created.state, {
      characterId: created.character.id,
      visibility: "restricted",
      allowedUserIds: ["u_demo"]
    });
    const first = activateCharacterForUser(visible, {
      userId: "u_demo",
      characterId: created.character.id,
      now: "2026-07-06T09:02:00.000Z"
    });
    const second = activateCharacterForUser(first.state, {
      userId: "u_demo",
      characterId: created.character.id,
      now: "2026-07-06T09:03:00.000Z"
    });
    expect(second.alreadyActive).toBe(true);
    expect(second.conversationId).toBe(first.conversationId);
    expect(
      second.state.conversations.filter((item) => item.characterId === created.character.id)
    ).toHaveLength(1);
  });

  test("registerUser requires a valid unused invite code and authenticates", () => {
    const base = createInitialState("2026-07-06T08:00:00.000Z");
    const withInvite = createInviteCode(base, "2026-07-06T08:05:00.000Z");

    expect(() =>
      registerUser(withInvite.state, {
        inviteCode: "BADCODE",
        username: "alice",
        password: "secret123",
        now: "2026-07-06T09:00:00.000Z"
      })
    ).toThrow();

    const registered = registerUser(withInvite.state, {
      inviteCode: withInvite.code,
      username: "alice",
      password: "secret123",
      now: "2026-07-06T09:00:00.000Z"
    });
    expect(registered.user.username).toBe("alice");
    expect(registered.user.id).not.toBe("u_demo");
    expect(authenticateUser(registered.state, "alice", "secret123")?.id).toBe(registered.user.id);
    expect(authenticateUser(registered.state, "alice", "wrong")).toBeNull();

    expect(() =>
      registerUser(registered.state, {
        inviteCode: withInvite.code,
        username: "bob",
        password: "secret123",
        now: "2026-07-06T09:05:00.000Z"
      })
    ).toThrow();
  });

  test("registerUser rejects duplicate username", () => {
    const base = createInitialState("2026-07-06T08:00:00.000Z");
    const invite1 = createInviteCode(base, "2026-07-06T08:05:00.000Z");
    const invite2 = createInviteCode(invite1.state, "2026-07-06T08:06:00.000Z");
    const first = registerUser(invite2.state, {
      inviteCode: invite1.code,
      username: "sameName",
      password: "secret123",
      now: "2026-07-06T09:00:00.000Z"
    });
    expect(() =>
      registerUser(first.state, {
        inviteCode: invite2.code,
        username: "sameName",
        password: "secret123",
        now: "2026-07-06T09:01:00.000Z"
      })
    ).toThrow();
  });

  test("scopeStateForUser isolates one user's data from another", () => {
    const base = createInitialState("2026-07-06T08:00:00.000Z");
    const invite = createInviteCode(base, "2026-07-06T08:05:00.000Z");
    const registered = registerUser(invite.state, {
      inviteCode: invite.code,
      username: "alice",
      password: "secret123",
      now: "2026-07-06T09:00:00.000Z"
    });
    const publicChar = registered.state.characters[0].id;
    const activated = activateCharacterForUser(registered.state, {
      userId: registered.user.id,
      characterId: publicChar,
      now: "2026-07-06T09:01:00.000Z"
    });

    const demoScope = scopeStateForUser(activated.state, "u_demo");
    const aliceScope = scopeStateForUser(activated.state, registered.user.id);

    expect(demoScope.conversations.every((item) => item.userId === "u_demo")).toBe(true);
    expect(aliceScope.conversations.every((item) => item.userId === registered.user.id)).toBe(true);
    expect(demoScope.conversations.some((item) => item.userId === registered.user.id)).toBe(false);
    expect(aliceScope.users).toHaveLength(1);
    expect(aliceScope.users[0].id).toBe(registered.user.id);
    expect(aliceScope.inviteCodes).toHaveLength(0);
  });

  test("createCharacterForState avoids id collisions", () => {
    const base = createInitialState("2026-07-06T08:00:00.000Z");
    const first = createCharacterForState(base, { name: "Aria", now: "2026-07-06T09:00:00.000Z" });
    const second = createCharacterForState(first.state, { name: "Aria", now: "2026-07-06T09:01:00.000Z" });
    expect(first.character.id).not.toBe(second.character.id);
  });

  test("deleteFact removes fact and un-supersedes orphaned older facts", () => {
    const base = createInitialState("2026-07-06T08:00:00.000Z");
    const ctx = { userId: "u_demo", characterId: "shen-jibai", now: "2026-07-06T09:00:00.000Z" };
    const first = mergeFacts(base.facts, [{ factType: "nickname", content: "叫我小满" }], ctx, "llm");
    const second = mergeFacts(first.facts, [{ factType: "nickname", content: "叫我满满" }], ctx, "llm");
    const newer = second.facts.find((fact) => !fact.supersededBy && fact.factType === "nickname")!;
    const older = second.facts.find((fact) => fact.supersededBy === newer.id)!;

    const afterDelete = deleteFact({ ...base, facts: second.facts }, newer.id);
    expect(afterDelete.facts.some((fact) => fact.id === newer.id)).toBe(false);
    expect(afterDelete.facts.find((fact) => fact.id === older.id)!.supersededBy).toBeUndefined();
  });
});
