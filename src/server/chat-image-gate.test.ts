import { describe, expect, test } from "vitest";
import { affinityLevelRank, isAffinityAtLeast } from "@/domain/affinity";
import type { CharacterCard, CompanionState } from "@/domain/types";
import { createInitialState, isImageSentinelEnabled } from "./companion-service";

function stateWithImageProvider(provider: "dev" | "stepfun"): CompanionState {
  const base = createInitialState("2026-07-06T08:00:00.000Z");
  return { ...base, settings: { ...base.settings, models: { ...base.settings.models, image: { provider, model: "m" } } } };
}

function characterWith(visual: CharacterCard["visualIdentity"]): CharacterCard {
  const base = createInitialState("2026-07-06T08:00:00.000Z").characters[0];
  return { ...base, visualIdentity: visual };
}

describe("affinity ordering", () => {
  test("ranks levels in order", () => {
    expect(affinityLevelRank("初识")).toBe(0);
    expect(affinityLevelRank("热恋")).toBe(4);
  });

  test("isAffinityAtLeast compares by rank", () => {
    expect(isAffinityAtLeast("心动", "熟悉")).toBe(true);
    expect(isAffinityAtLeast("熟悉", "熟悉")).toBe(true);
    expect(isAffinityAtLeast("初识", "心动")).toBe(false);
  });
});

describe("chat image sentinel gating", () => {
  const enabledVisual = { referenceImageKey: "ref.png", chatImageEnabled: true, chatImageMinAffinity: "心动" as const };

  test("disabled when chatImageEnabled is false", () => {
    const state = stateWithImageProvider("stepfun");
    const character = characterWith({ referenceImageKey: "ref.png", chatImageEnabled: false });
    expect(isImageSentinelEnabled(state, character, "热恋")).toBe(false);
  });

  test("disabled when image provider is dev", () => {
    const state = stateWithImageProvider("dev");
    const character = characterWith(enabledVisual);
    expect(isImageSentinelEnabled(state, character, "热恋")).toBe(false);
  });

  test("disabled without a reference image", () => {
    const state = stateWithImageProvider("stepfun");
    const character = characterWith({ chatImageEnabled: true, chatImageMinAffinity: "初识" });
    expect(isImageSentinelEnabled(state, character, "热恋")).toBe(false);
  });

  test("disabled below the affinity threshold", () => {
    const state = stateWithImageProvider("stepfun");
    const character = characterWith(enabledVisual);
    expect(isImageSentinelEnabled(state, character, "熟悉")).toBe(false);
  });

  test("enabled at or above the affinity threshold", () => {
    const state = stateWithImageProvider("stepfun");
    const character = characterWith(enabledVisual);
    expect(isImageSentinelEnabled(state, character, "心动")).toBe(true);
    expect(isImageSentinelEnabled(state, character, "热恋")).toBe(true);
  });

  test("defaults threshold to 初识 when unset", () => {
    const state = stateWithImageProvider("stepfun");
    const character = characterWith({ referenceImageKey: "ref.png", chatImageEnabled: true });
    expect(isImageSentinelEnabled(state, character, "初识")).toBe(true);
  });
});
