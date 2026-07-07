import { moderateInput } from "./safety";
import type { AffinityLevel, CharacterCard, Fact, Moment } from "./types";

export function generateMoment(input: {
  character: CharacterCard;
  userId: string;
  summary: string;
  facts: Fact[];
  now: string;
}): Moment {
  const preference = input.facts.find((fact) => fact.factType === "preference")?.content.replace("用户喜欢", "");
  const content = [
    input.summary.includes("咖啡") ? "研究所楼下的咖啡今天少糖刚好。" : "今天的间隙很短，但风是安静的。",
    preference ? `忽然想起你说过喜欢${preference}。` : "有些话适合晚一点再说。",
    "先替你把这一刻存起来。"
  ].join("");

  const moderation = moderateInput(content);

  return {
    id: `moment_${Math.random().toString(36).slice(2, 10)}`,
    characterId: input.character.id,
    userId: input.userId,
    content,
    imageKey: "rain-window",
    status: moderation.allowed ? "published" : "blocked",
    publishAt: input.now,
    createdAt: input.now
  };
}

export function generateProactiveMessage(input: {
  character: CharacterCard;
  userNickname: string;
  summary: string;
  affinityLevel: AffinityLevel;
  now: string;
}): string {
  const hour = Number(input.now.slice(11, 13));
  const timeLine = hour >= 21 || hour < 6 ? "晚了，灯可以调暗一点。" : "我刚空下来，想起你。";
  const closeness = input.affinityLevel === "暧昧" || input.affinityLevel === "热恋" ? "别逞强，回我一句也好。" : "不用急着回。";

  return `${input.userNickname}，${timeLine}${input.summary ? `还记得你之前说过${input.summary.replace(/[。.]$/, "")}。` : ""}${closeness}`;
}
