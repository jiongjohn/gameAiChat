import { describe, expect, test } from "vitest";
import { characters } from "@/domain/characters";
import type { Fact, Message, ModelSettings } from "@/domain/types";
import { createChatReply, resolveChatCompletionsUrl } from "./model-provider";

const baseSettings: ModelSettings = {
  provider: "deepseek",
  model: "deepseek-v4-flash",
  baseUrl: "https://token.sensenova.cn/v1",
  apiKey: "test-key",
  temperature: 0.7,
  maxContextTokens: 32000,
  maxModelContextTokens: 1000000
};

function input(fetcher?: Parameters<typeof createChatReply>[0]["fetcher"]) {
  const history: Message[] = [];
  const facts: Fact[] = [];
  return {
    settings: baseSettings,
    character: characters[0],
    userMessage: "今天有点累",
    prompt: "角色：沈既白",
    history,
    facts,
    affinityLevel: "初识" as const,
    fetcher
  };
}

describe("model provider", () => {
  test("resolves OpenAI-compatible chat completions url from service base url", () => {
    expect(resolveChatCompletionsUrl("https://token.sensenova.cn/v1")).toBe(
      "https://token.sensenova.cn/v1/chat/completions"
    );
    expect(resolveChatCompletionsUrl("https://api.deepseek.com/")).toBe("https://api.deepseek.com/chat/completions");
    expect(resolveChatCompletionsUrl("https://proxy.example.com/v1/chat/completions")).toBe(
      "https://proxy.example.com/v1/chat/completions"
    );
  });

  test("calls OpenAI-compatible chat endpoint with configured model settings", async () => {
    const calls: Array<{ url: RequestInfo | URL; init?: RequestInit }> = [];
    const fetcher = async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url, init });
      return Response.json({
        choices: [{ message: { content: "我在，慢慢说。" } }]
      });
    };

    const result = await createChatReply(input(fetcher));

    expect(result).toMatchObject({ reply: "我在，慢慢说。", usedFallback: false });
    expect(calls[0].url).toBe("https://token.sensenova.cn/v1/chat/completions");
    expect(calls[0].init?.headers).toMatchObject({
      "Authorization": "Bearer test-key",
      "Content-Type": "application/json"
    });
    expect(JSON.parse(calls[0].init?.body as string)).toMatchObject({
      model: "deepseek-v4-flash",
      temperature: 0.7,
      stream: false,
      messages: [
        { role: "system", content: "角色：沈既白" },
        { role: "user", content: "今天有点累" }
      ]
    });
  });

  test("falls back to deterministic reply when provider call fails", async () => {
    const result = await createChatReply(input(async () => new Response("bad gateway", { status: 502 })));

    expect(result.usedFallback).toBe(true);
    expect(result.error).toBe("Model HTTP 502");
    expect(result.reply).toContain("小满");
  });
});
