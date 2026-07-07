import type { ModelSettings } from "@/domain/types";

type ModelPreset = Partial<ModelSettings> & {
  label: string;
  guidance: string;
};

const presets: Record<string, ModelPreset> = {
  "deepseek-v4-flash": {
    label: "DeepSeek V4 Flash",
    guidance: "官方上下文上限 1M。MVP 建议请求预算先用 32K，保留长期记忆检索和摘要，不要每轮塞满上下文。",
    provider: "deepseek",
    model: "deepseek-v4-flash",
    baseUrl: "https://api.deepseek.com",
    temperature: 0.7,
    maxContextTokens: 32_000,
    maxModelContextTokens: 1_000_000
  },
  "deepseek-v4-pro": {
    label: "DeepSeek V4 Pro",
    guidance: "官方上下文上限 1M。用于高质量任务时仍建议控制请求预算，避免成本和延迟失控。",
    provider: "deepseek",
    model: "deepseek-v4-pro",
    baseUrl: "https://api.deepseek.com",
    temperature: 0.7,
    maxContextTokens: 32_000,
    maxModelContextTokens: 1_000_000
  },
  "dev-companion": {
    label: "Dev Chat",
    guidance: "本地确定性回复，用于无 API Key 调试。",
    provider: "dev",
    model: "dev-companion",
    temperature: 0.7,
    maxContextTokens: 16_000,
    maxModelContextTokens: 16_000
  },
  "dev-image": {
    label: "Dev Image",
    guidance: "图片模型占位配置。",
    provider: "dev",
    model: "dev-image",
    temperature: 0.7,
    maxContextTokens: 4_000,
    maxModelContextTokens: 4_000
  },
  "dev-tts": {
    label: "Dev TTS",
    guidance: "TTS 模型占位配置。",
    provider: "dev",
    model: "dev-tts",
    temperature: 0.7,
    maxContextTokens: 2_000,
    maxModelContextTokens: 2_000
  }
};

export function getModelPreset(model: string): ModelPreset | undefined {
  return presets[model.trim().toLowerCase()];
}

export function applyModelPreset(current: ModelSettings, model: string): ModelSettings {
  const preset = getModelPreset(model);
  if (!preset) {
    return { ...current, model };
  }

  return {
    ...current,
    ...preset,
    apiKey: current.apiKey,
    label: undefined,
    guidance: undefined
  } as ModelSettings;
}
