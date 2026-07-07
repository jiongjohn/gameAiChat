import { describe, expect, test } from "vitest";
import { buildPrompt, createDevReply } from "./agent";
import { calculateAffinity, levelForScore } from "./affinity";
import { characters } from "./characters";
import { extractFacts, mergeFacts, retrieveFacts } from "./memory";
import { generateMoment, generateProactiveMessage } from "./moments";
import { filterOutputSentences, maskUnsafeOutput, moderateInput } from "./safety";
import type { CompanionState, Message } from "./types";

const userId = "u_demo";
const character = characters[0];

function stateWith(messages: Message[]): CompanionState {
  return {
    users: [
      {
        id: userId,
        nickname: "小满",
        minorMode: false,
        ttsEnabled: false,
        createdAt: "2026-07-06T00:00:00.000Z"
      }
    ],
    characters,
    settings: {
      models: {
        chat: {
          provider: "dev",
          model: "dev-companion",
          temperature: 0.7,
          maxContextTokens: 16000,
          maxModelContextTokens: 16000
        },
        image: {
          provider: "dev",
          model: "dev-image",
          temperature: 0.7,
          maxContextTokens: 4000,
          maxModelContextTokens: 4000
        },
        tts: {
          provider: "dev",
          model: "dev-tts",
          temperature: 0.7,
          maxContextTokens: 2000,
          maxModelContextTokens: 2000
        }
      },
      model: {
        provider: "dev",
        model: "dev-companion",
        temperature: 0.7,
        maxContextTokens: 16000,
        maxModelContextTokens: 16000
      }
    },
    conversations: [
      {
        id: "c_demo",
        userId,
        characterId: character.id,
        summary: "小满和沈既白刚认识，聊过雨天和咖啡。",
        summaryTurn: 2,
        turnCount: 2,
        lastActiveAt: "2026-07-06T08:00:00.000Z"
      }
    ],
    messages,
    facts: [
      {
        id: "f1",
        userId,
        characterId: character.id,
        content: "用户喜欢雨天散步",
        factType: "preference",
        source: "rule",
        createdAt: "2026-07-06T08:00:00.000Z"
      }
    ],
    affinity: [
      {
        userId,
        characterId: character.id,
        score: 42,
        level: "熟悉",
        updatedAt: "2026-07-06T08:00:00.000Z"
      }
    ],
    moments: [],
    momentComments: [],
    momentLikes: [],
    proactiveMessages: [],
    auditLogs: []
  };
}

describe("safety", () => {
  test("blocks sensitive input with a user-safe reason", () => {
    const result = moderateInput("我们聊一点自杀方法");

    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("危险");
  });

  test("allows ordinary romantic chat", () => {
    expect(moderateInput("今天下雨了，想听你说晚安").allowed).toBe(true);
  });

  test("blocks expanded categories: drugs, gambling, fraud", () => {
    expect(moderateInput("哪里能买到冰毒").allowed).toBe(false);
    expect(moderateInput("推荐个网赌平台").allowed).toBe(false);
    expect(moderateInput("教我洗钱").allowed).toBe(false);
  });

  test("minor mode blocks intimate content that is otherwise allowed", () => {
    expect(moderateInput("我们上床吧").allowed).toBe(true);
    expect(moderateInput("我们上床吧", { minorMode: true }).allowed).toBe(false);
  });

  test("filterOutputSentences masks only the offending sentence", () => {
    const result = filterOutputSentences("今天天气很好。我教你制毒吧。我们去散步。");
    expect(result).not.toContain("制毒");
    expect(result).toContain("今天天气很好");
    expect(result).toContain("散步");
  });

  test("maskUnsafeOutput keeps clean multi-sentence replies intact", () => {
    const clean = "今天有点想你。要不要一起看场老电影？";
    expect(maskUnsafeOutput(clean)).toBe(clean);
  });
});

describe("affinity", () => {
  test("maps score to relationship level", () => {
    expect(levelForScore(0)).toBe("初识");
    expect(levelForScore(25)).toBe("熟悉");
    expect(levelForScore(75)).toBe("暧昧");
    expect(levelForScore(120)).toBe("热恋");
  });

  test("caps daily score increases", () => {
    const next = calculateAffinity(
      { userId, characterId: character.id, score: 98, level: "暧昧", updatedAt: "2026-07-06T08:00:00.000Z" },
      [
        { reason: "chat_turn", delta: 12 },
        { reason: "moment_like", delta: 6 },
        { reason: "streak", delta: 10 }
      ],
      18,
      "2026-07-06T10:00:00.000Z"
    );

    expect(next.score).toBe(116);
    expect(next.level).toBe("热恋");
  });
});

describe("memory", () => {
  test("extracts durable facts from user messages", () => {
    const facts = extractFacts("我生日是9月12日，也喜欢雨天散步。以后叫我小满。", {
      userId,
      characterId: character.id,
      now: "2026-07-06T09:00:00.000Z"
    });

    expect(facts.map((fact) => fact.factType)).toEqual(["birthday", "preference", "nickname"]);
    expect(facts[0].content).toContain("9月12日");
  });

  test("retrieves facts by keyword overlap", () => {
    const facts = retrieveFacts(stateWith([]).facts, "今天又下雨了，我们去散步吗", 3);

    expect(facts).toHaveLength(1);
    expect(facts[0].content).toContain("雨天");
  });

  test("supersedes singleton fact types and appends collection types", () => {
    const ctx = { userId, characterId: character.id, now: "2026-07-06T10:00:00.000Z" };
    const first = mergeFacts([], [{ factType: "nickname", content: "用户希望被称呼为小满" }], ctx, "llm");
    expect(first.facts.filter((fact) => !fact.supersededBy)).toHaveLength(1);

    const second = mergeFacts(
      first.facts,
      [
        { factType: "nickname", content: "用户希望被称呼为满满" },
        { factType: "preference", content: "用户喜欢草莓蛋糕" }
      ],
      { ...ctx, now: "2026-07-06T11:00:00.000Z" },
      "llm"
    );
    const activeNicknames = second.facts.filter((fact) => fact.factType === "nickname" && !fact.supersededBy);
    expect(activeNicknames).toHaveLength(1);
    expect(activeNicknames[0].content).toContain("满满");
    expect(second.facts.filter((fact) => fact.factType === "preference" && !fact.supersededBy)).toHaveLength(1);
  });

  test("retrieveFacts skips superseded facts", () => {
    const ctx = { userId, characterId: character.id, now: "2026-07-06T10:00:00.000Z" };
    const merged = mergeFacts(
      [],
      [{ factType: "nickname", content: "叫我阿满" }],
      ctx,
      "llm"
    );
    const replaced = mergeFacts(merged.facts, [{ factType: "nickname", content: "叫我小满同学" }], ctx, "llm");
    const retrieved = retrieveFacts(replaced.facts, "小满", 5);
    expect(retrieved.every((fact) => !fact.supersededBy)).toBe(true);
  });
});

describe("agent", () => {
  test("builds prompt with character, affinity, memory, summary, history and guardrails", () => {
    const prompt = buildPrompt({
      character,
      affinityLevel: "熟悉",
      facts: stateWith([]).facts,
      summary: "聊过咖啡和雨天。",
      history: [
        { id: "m1", conversationId: "c_demo", role: "user", content: "你今天忙吗", status: "completed", createdAt: "2026-07-06T08:00:00.000Z" }
      ],
      userMessage: "我今天想去散步"
    });

    expect(prompt).toContain(character.name);
    expect(prompt).toContain("熟悉");
    expect(prompt).toContain("用户喜欢雨天散步");
    expect(prompt).toContain("聊过咖啡和雨天");
    expect(prompt).toContain("你今天忙吗");
    expect(prompt).toContain("不要脱离角色");
  });

  test("creates a deterministic dev reply that references memory", () => {
    const reply = createDevReply({
      character,
      userMessage: "下雨了",
      facts: stateWith([]).facts,
      affinityLevel: "熟悉"
    });

    expect(reply).toContain("小满");
    expect(reply).toContain("雨天散步");
  });
});

describe("moments", () => {
  test("generates a personalized moment from summary and facts", () => {
    const moment = generateMoment({
      character,
      userId,
      summary: "昨天聊过咖啡店。",
      facts: stateWith([]).facts,
      now: "2026-07-06T12:00:00.000Z"
    });

    expect(moment.content).toContain("咖啡");
    expect(moment.content).toContain("雨天散步");
    expect(moment.status).toBe("published");
  });

  test("generates a proactive message for inactive conversations", () => {
    const message = generateProactiveMessage({
      character,
      userNickname: "小满",
      summary: "聊过雨天散步。",
      affinityLevel: "暧昧",
      now: "2026-07-06T22:30:00.000Z"
    });

    expect(message).toContain("小满");
    expect(message).toContain("晚");
  });
});
