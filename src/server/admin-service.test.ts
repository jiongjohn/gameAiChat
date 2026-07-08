import { describe, expect, test } from "vitest";
import { buildPrompt } from "@/domain/agent";
import { createInitialState, getStateCharacter, handleChatTurn } from "./companion-service";
import {
  REDACTED_API_KEY,
  normalizeState,
  redactStateForClient,
  updateCharacterConfig,
  updateModelSettings,
  validateAdminSettingsPatch
} from "./admin-service";

describe("admin service", () => {
  test("normalizes legacy state with model settings and editable character fields", () => {
    const legacy = createInitialState("2026-07-06T08:00:00.000Z");
    const normalized = normalizeState({ ...legacy, settings: undefined } as unknown as ReturnType<typeof createInitialState>);

    expect(normalized.settings.models.chat.provider).toBe("dev");
    expect(normalized.settings.models.image.model).toBe("dev-image");
    expect(normalized.settings.models.tts.model).toBe("dev-tts");
    expect(normalized.settings.model).toEqual(normalized.settings.models.chat);
    expect(normalized.characters[0].personalityType).toBe("克制守护");
    expect(normalized.characters[0].modelId).toBe("default");
  });

  test("backfills legacy characters with seed prompt fields used by chat", () => {
    const legacy = createInitialState("2026-07-06T08:00:00.000Z");
    const normalized = normalizeState({
      ...legacy,
      characters: [
        {
          id: "shen-jibai",
          name: "沈既白"
        }
      ]
    } as unknown as ReturnType<typeof createInitialState>);
    const character = getStateCharacter(normalized, "shen-jibai");

    expect(character.description).toContain("犯罪心理研究所");
    expect(character.personality).toContain("克制");
    expect(buildPrompt({
      character,
      affinityLevel: "初识",
      facts: [],
      summary: "",
      history: [],
      userMessage: "下雨了"
    })).toContain("沈既白记得用户喜欢雨天散步");
  });

  test("updates character image, personality type and model binding", async () => {
    const state = normalizeState(createInitialState("2026-07-06T08:00:00.000Z"));
    const next = updateCharacterConfig(state, {
      characterId: "shen-jibai",
      imageUrl: "https://example.com/shen.png",
      personalityType: "温柔年上",
      modelId: "deepseek-v4-flash",
      personality: "稳定、温柔、带一点掌控感。"
    });
    const character = getStateCharacter(next, "shen-jibai");

    expect(character.imageUrl).toBe("https://example.com/shen.png");
    expect(character.personalityType).toBe("温柔年上");
    expect(character.modelId).toBe("deepseek-v4-flash");
    expect(buildPrompt({
      character,
      affinityLevel: "初识",
      facts: [],
      summary: "",
      history: [],
      userMessage: "你是谁"
    })).toContain("稳定、温柔");

    const result = await handleChatTurn(next, {
      conversationId: next.conversations[0].id,
      content: "你是谁",
      now: "2026-07-06T09:00:00.000Z"
    });
    expect(result.prompt).toContain("稳定、温柔");
  });

  test("persists and merges character visualIdentity", () => {
    const state = normalizeState(createInitialState("2026-07-06T08:00:00.000Z"));
    const withPrompt = updateCharacterConfig(state, {
      characterId: "shen-jibai",
      visualIdentity: { appearancePrompt: "短黑发，冷峻，写实" }
    });
    expect(getStateCharacter(withPrompt, "shen-jibai").visualIdentity?.appearancePrompt).toBe("短黑发，冷峻，写实");

    const withImage = updateCharacterConfig(withPrompt, {
      characterId: "shen-jibai",
      visualIdentity: { referenceImageKey: "abc123.png" }
    });
    const visual = getStateCharacter(withImage, "shen-jibai").visualIdentity;
    expect(visual?.referenceImageKey).toBe("abc123.png");
    expect(visual?.appearancePrompt).toBe("短黑发，冷峻，写实");
  });

  test("validates character.visualIdentity fields", () => {
    expect(
      validateAdminSettingsPatch({
        character: { characterId: "shen-jibai", visualIdentity: { appearancePrompt: "写实立绘", styleTags: ["cinematic"] } }
      }).character
    ).toMatchObject({ visualIdentity: { appearancePrompt: "写实立绘", styleTags: ["cinematic"] } });

    expect(() =>
      validateAdminSettingsPatch({
        character: { characterId: "shen-jibai", visualIdentity: { styleTags: "cinematic" } }
      })
    ).toThrow("character.visualIdentity.styleTags must be an array of strings.");
  });

  test("updates model settings without storing blank api key", () => {
    const state = normalizeState(createInitialState("2026-07-06T08:00:00.000Z"));
    const next = updateModelSettings(state, {
      provider: "deepseek",
      model: "deepseek-v4-flash",
      baseUrl: "https://api.deepseek.com",
      apiKey: "",
      temperature: 0.72
    });

    expect(next.settings.models.chat.provider).toBe("deepseek");
    expect(next.settings.models.chat.model).toBe("deepseek-v4-flash");
    expect(next.settings.models.chat.apiKey).toBeUndefined();
    expect(next.settings.models.chat.temperature).toBe(0.72);
    expect(next.settings.model).toEqual(next.settings.models.chat);
  });

  test("backfills DeepSeek V4 max model context to 1M during normalization", () => {
    const state = normalizeState({
      ...createInitialState("2026-07-06T08:00:00.000Z"),
      settings: {
        model: {
          provider: "deepseek",
          model: "deepseek-v4-flash",
          temperature: 0.72,
          maxContextTokens: 32000
        }
      }
    } as unknown as ReturnType<typeof createInitialState>);

    expect(state.settings.models.chat.maxContextTokens).toBe(32000);
    expect(state.settings.models.chat.maxModelContextTokens).toBe(1_000_000);
  });

  test("preserves existing api key when model form submits blank key", () => {
    const state = updateModelSettings(normalizeState(createInitialState("2026-07-06T08:00:00.000Z")), {
      provider: "deepseek",
      model: "deepseek-v4-flash",
      apiKey: "secret-key"
    });
    const next = updateModelSettings(state, {
      temperature: 0.8,
      apiKey: "   "
    });

    expect(next.settings.models.chat.apiKey).toBe("secret-key");
    expect(next.settings.models.chat.temperature).toBe(0.8);
  });

  test("updates image and tts models independently from chat model", () => {
    const state = normalizeState(createInitialState("2026-07-06T08:00:00.000Z"));
    const withImage = updateModelSettings(state, {
      provider: "custom",
      model: "wanx-image",
      baseUrl: "https://image.example.com",
      maxContextTokens: 8000
    }, "image");
    const withTts = updateModelSettings(withImage, {
      provider: "custom",
      model: "minimax-tts",
      baseUrl: "https://tts.example.com",
      maxContextTokens: 3000
    }, "tts");

    expect(withTts.settings.models.chat.model).toBe("dev-companion");
    expect(withTts.settings.models.image.model).toBe("wanx-image");
    expect(withTts.settings.models.tts.model).toBe("minimax-tts");
  });

  test("redacts non-empty api keys across all model slots for client payloads", () => {
    const state = updateModelSettings(normalizeState(createInitialState("2026-07-06T08:00:00.000Z")), {
      provider: "deepseek",
      model: "deepseek-v4-flash",
      baseUrl: "https://token.sensenova.cn/v1",
      apiKey: "sk-secret-live-key"
    });

    const redacted = redactStateForClient(state);

    expect(redacted.settings.models.chat.apiKey).toBe(REDACTED_API_KEY);
    expect(redacted.settings.model.apiKey).toBe(REDACTED_API_KEY);
    expect(redacted.settings.models.image.apiKey).toBeUndefined();
    expect(redacted.settings.models.chat.baseUrl).toBe("https://token.sensenova.cn/v1");
    expect(state.settings.models.chat.apiKey).toBe("sk-secret-live-key");
    expect(JSON.stringify(redacted)).not.toContain("sk-secret-live-key");
  });

  test("preserves stored api key when admin resubmits the redacted sentinel", () => {
    const state = updateModelSettings(normalizeState(createInitialState("2026-07-06T08:00:00.000Z")), {
      provider: "deepseek",
      model: "deepseek-v4-flash",
      apiKey: "sk-real-key"
    });
    const next = updateModelSettings(state, {
      temperature: 0.9,
      apiKey: REDACTED_API_KEY
    });

    expect(next.settings.models.chat.apiKey).toBe("sk-real-key");
    expect(next.settings.models.chat.temperature).toBe(0.9);
  });

  test("validates admin settings patch requests", () => {
    expect(() =>
      validateAdminSettingsPatch({
        model: {
          target: "chat",
          provider: "unknown",
          model: "deepseek-v4-flash"
        }
      })
    ).toThrow("model.provider is invalid");

    expect(() =>
      validateAdminSettingsPatch({
        character: {
          characterId: "shen-jibai",
          imageUrl: 42
        }
      })
    ).toThrow("character.imageUrl must be a string");

    const imagePatch = validateAdminSettingsPatch({
      model: {
        target: "image",
        provider: "openai",
        model: "gpt-image-1",
        i2iModel: "gpt-image-1",
        baseUrl: "https://api.openai.com/v1",
        apiKey: "sk-test",
        size: "1024x1024"
      }
    });
    expect(imagePatch.modelTarget).toBe("image");
    expect(imagePatch.model).toMatchObject({
      provider: "openai",
      model: "gpt-image-1",
      i2iModel: "gpt-image-1",
      size: "1024x1024"
    });

    expect(() =>
      validateAdminSettingsPatch({
        model: { target: "image", provider: "deepseek", model: "x" }
      })
    ).toThrow("model.provider is invalid.");

    expect(validateAdminSettingsPatch({
      model: {
        target: "tts",
        provider: "custom",
        model: "minimax-tts"
      }
    }).modelTarget).toBe("tts");
  });
});
