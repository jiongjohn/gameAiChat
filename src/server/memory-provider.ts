import { extractFactCandidates, type ExtractedFact } from "@/domain/memory";
import type { Fact, Message, ModelSettings } from "@/domain/types";
import { createRawCompletion } from "./model-provider";

const validFactTypes: Fact["factType"][] = ["birthday", "nickname", "preference", "promise", "milestone", "note"];
const factExtractionTimeoutMs = 6_000;
const summaryTimeoutMs = 8_000;

function historyToText(history: Message[]): string {
  return history
    .map((message) => `${message.role === "user" ? "用户" : "角色"}: ${message.content}`)
    .join("\n");
}

function parseExtractedFacts(raw: string): ExtractedFact[] {
  const match = raw.match(/\[[\s\S]*\]/);
  if (!match) {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) {
    return [];
  }
  const result: ExtractedFact[] = [];
  for (const item of parsed) {
    if (typeof item !== "object" || item === null) {
      continue;
    }
    const factType = (item as { factType?: unknown }).factType;
    const content = (item as { content?: unknown }).content;
    if (
      typeof factType === "string" &&
      validFactTypes.includes(factType as Fact["factType"]) &&
      typeof content === "string" &&
      content.trim().length > 0 &&
      content.trim().length <= 120
    ) {
      result.push({ factType: factType as Fact["factType"], content: content.trim() });
    }
  }
  return result;
}

export async function extractFactsLLM(input: {
  settings: ModelSettings;
  userMessage: string;
  assistantReply: string;
}): Promise<{ candidates: ExtractedFact[]; source: Fact["source"] }> {
  const systemPrompt = [
    "你是记忆抽取器。从对话中抽取关于【用户】的、值得长期记住的稳定事实。",
    "只输出 JSON 数组，每项为 {\"factType\": string, \"content\": string}。",
    "factType 只能是: birthday(生日), nickname(希望被称呼), preference(喜好), promise(承诺), milestone(重要事件), note(其他)。",
    "content 用中文简短陈述，主语是“用户”，不超过40字。没有可抽取事实时输出 []。",
    "不要抽取角色自身的信息，不要臆测。"
  ].join("\n");
  const userPrompt = `用户说：${input.userMessage}\n角色回复：${input.assistantReply}\n\n请抽取用户的稳定事实。`;

  const result = await createRawCompletion({
    settings: input.settings,
    systemPrompt,
    userPrompt,
    maxTokens: 300,
    temperature: 0.1,
    timeoutMs: factExtractionTimeoutMs
  });

  if (result.error || !result.content) {
    return { candidates: extractFactCandidates(input.userMessage), source: "rule" };
  }

  const candidates = parseExtractedFacts(result.content);
  if (candidates.length === 0) {
    return { candidates: extractFactCandidates(input.userMessage), source: "rule" };
  }
  return { candidates, source: "llm" };
}

export async function generateSummaryLLM(input: {
  settings: ModelSettings;
  priorSummary: string;
  history: Message[];
}): Promise<string | null> {
  const systemPrompt = [
    "你是对话摘要器。把角色与用户的关系进展、关键事实、情绪基调浓缩成一段中文摘要。",
    "不超过120字，只描述已发生的内容，不要编造，不要输出多余解释。"
  ].join("\n");
  const userPrompt = `已有摘要：${input.priorSummary || "无"}\n\n最近对话：\n${historyToText(input.history)}\n\n请输出更新后的摘要。`;

  const result = await createRawCompletion({
    settings: input.settings,
    systemPrompt,
    userPrompt,
    maxTokens: 260,
    temperature: 0.3,
    timeoutMs: summaryTimeoutMs
  });

  if (result.error || !result.content) {
    return null;
  }
  return result.content;
}
