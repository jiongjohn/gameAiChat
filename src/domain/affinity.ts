import type { AffinityLevel, AffinityRecord } from "./types";

const levelThresholds: Array<{ level: AffinityLevel; min: number }> = [
  { level: "初识", min: 0 },
  { level: "熟悉", min: 20 },
  { level: "心动", min: 50 },
  { level: "暧昧", min: 75 },
  { level: "热恋", min: 110 }
];

export function levelForScore(score: number): AffinityLevel {
  return levelThresholds.reduce<AffinityLevel>((current, item) => (score >= item.min ? item.level : current), "初识");
}

export function calculateAffinity(
  current: AffinityRecord,
  events: Array<{ reason: string; delta: number }>,
  dailyCap: number,
  now: string
): AffinityRecord {
  const increase = Math.min(
    dailyCap,
    events.reduce((sum, event) => sum + Math.max(0, event.delta), 0)
  );
  const score = current.score + increase;

  return {
    ...current,
    score,
    level: levelForScore(score),
    updatedAt: now
  };
}
