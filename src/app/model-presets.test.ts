import { describe, expect, test } from "vitest";
import { applyModelPreset, getModelPreset } from "./model-presets";

describe("model presets", () => {
  test("provides deepseek-v4-flash defaults with 1M max context and conservative request budget", () => {
    const preset = getModelPreset("deepseek-v4-flash");

    expect(preset).toMatchObject({
      provider: "deepseek",
      model: "deepseek-v4-flash",
      maxModelContextTokens: 1_000_000,
      maxContextTokens: 32_000,
      temperature: 0.7
    });
  });

  test("applies known model preset and preserves existing api key", () => {
    const next = applyModelPreset({
      provider: "dev",
      model: "dev-companion",
      apiKey: "secret",
      temperature: 0.2,
      maxContextTokens: 1000
    }, "deepseek-v4-flash");

    expect(next.provider).toBe("deepseek");
    expect(next.apiKey).toBe("secret");
    expect(next.maxModelContextTokens).toBe(1_000_000);
    expect(next.maxContextTokens).toBe(32_000);
  });
});
