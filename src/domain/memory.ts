import type { Fact } from "./types";

interface FactContext {
  userId: string;
  characterId: string;
  now: string;
}

export interface ExtractedFact {
  factType: Fact["factType"];
  content: string;
}

export const SINGLETON_FACT_TYPES = new Set<Fact["factType"]>(["birthday", "nickname"]);
const dedupSimilarityThreshold = 0.8;

function makeFact(context: FactContext, factType: Fact["factType"], content: string, source: Fact["source"]): Fact {
  return {
    id: `fact_${factType}_${Math.random().toString(36).slice(2, 10)}`,
    userId: context.userId,
    characterId: context.characterId,
    content,
    factType,
    source,
    createdAt: context.now
  };
}

export function isActiveFact(fact: Fact): boolean {
  return !fact.supersededBy;
}

export function activeFacts(facts: Fact[], userId: string, characterId: string): Fact[] {
  return facts.filter(
    (fact) => fact.userId === userId && fact.characterId === characterId && isActiveFact(fact)
  );
}

export function extractFacts(message: string, context: FactContext): Fact[] {
  return extractFactCandidates(message).map((candidate) =>
    makeFact(context, candidate.factType, candidate.content, "rule")
  );
}

export function extractFactCandidates(message: string): ExtractedFact[] {
  const candidates: ExtractedFact[] = [];
  const birthday = message.match(/生日是?([0-9一二三四五六七八九十]{1,2}月[0-9一二三四五六七八九十]{1,2}日)/);
  const nickname = message.match(/(?:叫我|喊我)([\u4e00-\u9fa5A-Za-z0-9_]{1,12})/);

  if (birthday) {
    candidates.push({ factType: "birthday", content: `用户生日是${birthday[1]}` });
  }
  if (/喜欢/.test(message)) {
    const preference = message.match(/喜欢([^。！!，,]+(?:散步|咖啡|音乐|电影|甜点|雨天)?)/);
    if (preference) {
      candidates.push({ factType: "preference", content: `用户喜欢${preference[1].trim()}` });
    }
  }
  if (nickname) {
    candidates.push({ factType: "nickname", content: `用户希望被称呼为${nickname[1]}` });
  }

  return candidates;
}

function normalizeContent(content: string): string {
  return content.toLowerCase().replace(/[\s。．.!！，,、?？~～]+/g, "");
}

function jaccardSimilarity(a: string, b: string): number {
  const setA = new Set(tokenize(a));
  const setB = new Set(tokenize(b));
  if (setA.size === 0 || setB.size === 0) {
    return normalizeContent(a) === normalizeContent(b) ? 1 : 0;
  }
  let intersection = 0;
  for (const token of setA) {
    if (setB.has(token)) {
      intersection += 1;
    }
  }
  const union = new Set([...setA, ...setB]).size;
  return intersection / union;
}

export function mergeFacts(
  existing: Fact[],
  candidates: ExtractedFact[],
  context: FactContext,
  source: Fact["source"]
): { facts: Fact[]; added: Fact[] } {
  let facts = [...existing];
  const added: Fact[] = [];

  for (const candidate of candidates) {
    const active = facts.filter(
      (fact) =>
        fact.userId === context.userId &&
        fact.characterId === context.characterId &&
        fact.factType === candidate.factType &&
        isActiveFact(fact)
    );

    if (SINGLETON_FACT_TYPES.has(candidate.factType)) {
      const identical = active.find((fact) => normalizeContent(fact.content) === normalizeContent(candidate.content));
      if (identical) {
        continue;
      }
      const newFact = makeFact(context, candidate.factType, candidate.content, source);
      facts = facts.map((fact) =>
        active.some((item) => item.id === fact.id) ? { ...fact, supersededBy: newFact.id } : fact
      );
      facts.push(newFact);
      added.push(newFact);
      continue;
    }

    const duplicate = active.find(
      (fact) => jaccardSimilarity(fact.content, candidate.content) >= dedupSimilarityThreshold
    );
    if (duplicate) {
      if (normalizeContent(duplicate.content) === normalizeContent(candidate.content)) {
        continue;
      }
      const newFact = makeFact(context, candidate.factType, candidate.content, source);
      facts = facts.map((fact) => (fact.id === duplicate.id ? { ...fact, supersededBy: newFact.id } : fact));
      facts.push(newFact);
      added.push(newFact);
      continue;
    }

    const newFact = makeFact(context, candidate.factType, candidate.content, source);
    facts.push(newFact);
    added.push(newFact);
  }

  return { facts, added };
}

function tokenize(text: string): string[] {
  const chineseTokens = Array.from(text.matchAll(/[\u4e00-\u9fa5]{2}/g)).map((match) => match[0]);
  const wordTokens = text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  return [...new Set([...chineseTokens, ...wordTokens])];
}

export function retrieveFacts(facts: Fact[], query: string, limit: number): Fact[] {
  const queryTokens = tokenize(query);
  return facts
    .filter(isActiveFact)
    .map((fact) => ({
      fact,
      score:
        tokenize(fact.content).filter((token) => queryTokens.includes(token)).length +
        (query.includes("下雨") && fact.content.includes("雨天") ? 2 : 0) +
        (query.includes("散步") && fact.content.includes("散步") ? 2 : 0)
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((item) => item.fact);
}
