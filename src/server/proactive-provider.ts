import { generateProactiveMessage } from "@/domain/moments";
import type { AffinityLevel, CharacterCard, ModelSettings } from "@/domain/types";
import { createRawCompletion } from "./model-provider";

const proactiveTimeoutMs = 8_000;

const affinityTone: Record<AffinityLevel, string> = {
  "初识": "克制含蓄，礼貌保持距离",
  "熟悉": "自然关心，像熟识的朋友",
  "心动": "偶尔流露在意，但不直白索取回应",
  "暧昧": "语气贴近，带一点专属感",
  "热恋": "亲昵直接，主动表达陪伴"
};

function timeOfDay(now: string): string {
  const hour = Number(now.slice(11, 13));
  if (hour >= 5 && hour < 11) return "早上";
  if (hour >= 11 && hour < 14) return "中午";
  if (hour >= 14 && hour < 18) return "下午";
  if (hour >= 18 && hour < 23) return "晚上";
  return "深夜";
}

export async function generateProactiveContent(input: {
  settings: ModelSettings;
  character: CharacterCard;
  userNickname: string;
  summary: string;
  affinityLevel: AffinityLevel;
  silenceHours: number;
  now: string;
}): Promise<{ content: string; source: "llm" | "rule" }> {
  const systemPrompt = [
    `你在扮演角色「${input.character.name}」。人设：${input.character.description}`,
    `性格：${input.character.personality}`,
    `你正在主动发起对话，因为「${input.userNickname}」已经约 ${input.silenceHours} 小时没有理你了。`,
    `当前关系：${input.affinityLevel}。语气要求：${affinityTone[input.affinityLevel]}。`,
    "约束：1-3 句、中文口语、像真人主动找对方，不寒暄客套、不提及 AI/系统/时间戳、不复述规则。"
  ].join("\n");
  const userPrompt = [
    `关系记忆摘要：${input.summary || "暂无"}`,
    `现在是${timeOfDay(input.now)}。`,
    "请生成一条主动消息。"
  ].join("\n");

  const result = await createRawCompletion({
    settings: input.settings,
    systemPrompt,
    userPrompt,
    maxTokens: 200,
    temperature: 0.85,
    timeoutMs: proactiveTimeoutMs
  });

  if (result.error || !result.content) {
    return {
      content: generateProactiveMessage({
        character: input.character,
        userNickname: input.userNickname,
        summary: input.summary,
        affinityLevel: input.affinityLevel,
        now: input.now
      }),
      source: "rule"
    };
  }
  return { content: result.content, source: "llm" };
}
