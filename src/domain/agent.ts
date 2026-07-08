import type { AffinityLevel, CharacterCard, Fact, Message } from "./types";

interface PromptInput {
  character: CharacterCard;
  affinityLevel: AffinityLevel;
  facts: Fact[];
  summary: string;
  history: Message[];
  userMessage: string;
  minorMode?: boolean;
  imageSentinelEnabled?: boolean;
}

const minorModeGuard =
  "未成年人保护模式：保持温和陪伴与正向引导，禁止任何亲密、性暗示或越界内容，遇到相关话题温柔地转向健康安全的方向。";

const imageSentinelGuide = [
  "【配图能力】当当前对话出现真正值得用画面呈现的时刻（自拍、展示某物、强烈的场景或表情）时，你可以在单独一行输出：[[IMG: 简短场景描述]]。规则：",
  "- 每次回复最多一次，绝大多数回复都不需要配图。",
  "- 只描述当前动作、表情、环境；不要写外貌固定特征（系统会自动补充），不要写长段落。",
  "- 连续消息不要重复配图；不确定时就不配。",
  "- 该标记必须独占一行，不要插在句子中间。"
].join("\n");

export function buildPrompt(input: PromptInput): string {
  const worldInfo = input.character.characterBook
    .filter((entry) => entry.keywords.some((keyword) => input.userMessage.includes(keyword)))
    .sort((a, b) => b.priority - a.priority)
    .map((entry) => `- ${entry.content}`)
    .join("\n");
  const memories = input.facts.map((fact) => `- ${fact.content}`).join("\n");
  const history = input.history.map((message) => `${message.role}: ${message.content}`).join("\n");

  return [
    `角色：${input.character.name}`,
    `人设：${input.character.description}`,
    `性格：${input.character.personality}`,
    `场景：${input.character.scenario}`,
    `示例：${input.character.messageExample}`,
    `世界书：\n${worldInfo || "- 无命中"}`,
    `好感度：${input.affinityLevel}。${input.character.affinityPrompts[input.affinityLevel]}`,
    `长期记忆：\n${memories || "- 暂无"}`,
    `中期摘要：${input.summary || "暂无摘要"}`,
    `最近对话：\n${history || "- 暂无"}`,
    `用户最新消息：${input.userMessage}`,
    `最高优先级：${input.character.postHistoryInstructions}`,
    ...(input.imageSentinelEnabled ? [imageSentinelGuide] : []),
    ...(input.minorMode ? [minorModeGuard] : [])
  ].join("\n\n");
}

export function createDevReply(input: {
  character: CharacterCard;
  userMessage: string;
  facts: Fact[];
  affinityLevel: AffinityLevel;
}): string {
  const nickname = input.facts.find((fact) => fact.factType === "nickname")?.content.replace("用户希望被称呼为", "") || "小满";
  const memory = input.facts.find((fact) => fact.factType === "preference")?.content.replace("用户喜欢", "");
  const prefix = input.affinityLevel === "初识" ? `${nickname}，我听见了。` : `${nickname}，我在。`;
  const rainLine = /雨|下雨/.test(input.userMessage) && memory ? `你之前说过喜欢${memory}，但今天风有点凉，外套别忘。` : "";
  const base = [prefix, rainLine || "把今天最重的那一小块先放我这里，不急着一个人扛。"].join("");
  if (input.userMessage.trim().startsWith("/img")) {
    return `${base}\n[[IMG: 我此刻的样子，窗边光线很好]]\n`;
  }
  return base;
}
