import { hashPassword } from "@/domain/auth";
import { characters as seedCharacters } from "@/domain/characters";
import type { AffinityLevel, AppSettings, CharacterCard, CharacterVisibility, CompanionState, ImageModelSettings, ModelSettings, UserProfile } from "@/domain/types";

const modelProviders: ModelSettings["provider"][] = ["dev", "deepseek", "doubao", "glm", "custom"];
const characterStringFields = [
  "id",
  "characterId",
  "name",
  "tagline",
  "imageUrl",
  "personalityType",
  "modelId",
  "description",
  "personality",
  "scenario",
  "firstMessage",
  "messageExample",
  "postHistoryInstructions",
  "voiceId",
  "avatarGradient",
  "momentsPersona"
] as const;

type JsonRecord = Record<string, unknown>;

const defaultModelSettings: ModelSettings = {
  provider: "dev",
  model: "dev-companion",
  temperature: 0.7,
  maxContextTokens: 16000,
  maxModelContextTokens: 16000
};
const imageProviders: ImageModelSettings["provider"][] = ["dev", "openai", "stepfun", "volcano"];
const defaultImageModelSettings: ImageModelSettings = {
  provider: "dev",
  model: "dev-image",
  size: "1024x1024"
};
const defaultTtsModelSettings: ModelSettings = {
  provider: "dev",
  model: "dev-tts",
  temperature: 0.7,
  maxContextTokens: 2000,
  maxModelContextTokens: 2000
};

const defaultAffinityPrompts: Record<AffinityLevel, string> = {
  "初识": "保持礼貌距离，语气克制，更多观察与确认。",
  "熟悉": "可以自然关心用户，记住称呼和偏好。",
  "心动": "偶尔流露在意，但不直白索取回应。",
  "暧昧": "语气更贴近，允许轻微暧昧和专属称呼。",
  "热恋": "稳定、亲密、专一，主动表达陪伴感。"
};

function normalizeCharacter(character: Partial<CharacterCard> & { id: string }): CharacterCard {
  const seed = seedCharacters.find((item) => item.id === character.id);
  const fallback: CharacterCard = seed ?? {
    id: character.id,
    name: "",
    tagline: "",
    imageUrl: "",
    personalityType: "克制守护",
    modelId: "default",
    description: "",
    personality: "",
    scenario: "",
    firstMessage: "",
    messageExample: "",
    postHistoryInstructions: "",
    voiceId: "",
    avatarGradient: "",
    momentsPersona: "",
    affinityPrompts: defaultAffinityPrompts,
    characterBook: [],
    visibility: "hidden"
  };

  return {
    id: character.id,
    name: character.name ?? fallback.name,
    tagline: character.tagline ?? fallback.tagline,
    imageUrl: character.imageUrl ?? fallback.imageUrl ?? "",
    personalityType: character.personalityType ?? fallback.personalityType ?? "克制守护",
    modelId: character.modelId ?? fallback.modelId ?? "default",
    description: character.description ?? fallback.description,
    personality: character.personality ?? fallback.personality,
    scenario: character.scenario ?? fallback.scenario,
    firstMessage: character.firstMessage ?? fallback.firstMessage,
    messageExample: character.messageExample ?? fallback.messageExample,
    postHistoryInstructions: character.postHistoryInstructions ?? fallback.postHistoryInstructions,
    voiceId: character.voiceId ?? fallback.voiceId,
    avatarGradient: character.avatarGradient ?? fallback.avatarGradient,
    momentsPersona: character.momentsPersona ?? fallback.momentsPersona,
    affinityPrompts: {
      ...defaultAffinityPrompts,
      ...fallback.affinityPrompts,
      ...character.affinityPrompts
    },
    characterBook: Array.isArray(character.characterBook) ? character.characterBook : fallback.characterBook,
    visibility: character.visibility ?? fallback.visibility ?? "public",
    allowedUserIds: character.allowedUserIds ?? fallback.allowedUserIds,
    visualIdentity: character.visualIdentity ?? fallback.visualIdentity
  };
}

function normalizeModelSettings(settings: Partial<ModelSettings> | undefined, fallback: ModelSettings): ModelSettings {
  const presetMaxContext = settings?.model === "deepseek-v4-flash" || settings?.model === "deepseek-v4-pro"
    ? 1_000_000
    : fallback.maxModelContextTokens;
  const providerCandidate = settings?.provider;
  const provider: ModelSettings["provider"] = providerCandidate && modelProviders.includes(providerCandidate)
    ? providerCandidate
    : fallback.provider;
  const model = settings?.model?.trim() || fallback.model;
  const temperatureCandidate = settings?.temperature;
  const temperature = typeof temperatureCandidate === "number" && Number.isFinite(temperatureCandidate)
    ? temperatureCandidate
    : fallback.temperature;
  const maxContextTokensCandidate = settings?.maxContextTokens;
  const maxContextTokens = typeof maxContextTokensCandidate === "number" && Number.isFinite(maxContextTokensCandidate)
    ? Math.max(1, Math.floor(maxContextTokensCandidate))
    : fallback.maxContextTokens;
  const maxModelContextTokensCandidate = settings?.maxModelContextTokens;
  const maxModelContextTokens = typeof maxModelContextTokensCandidate === "number" && Number.isFinite(maxModelContextTokensCandidate)
    ? Math.max(presetMaxContext ?? 1, Math.floor(maxModelContextTokensCandidate))
    : presetMaxContext;

  return {
    ...fallback,
    ...settings,
    provider,
    model,
    baseUrl: settings?.baseUrl?.trim() || undefined,
    apiKey: settings?.apiKey?.trim() || undefined,
    temperature,
    maxContextTokens,
    maxModelContextTokens
  };
}

function normalizeImageSettings(settings?: Partial<ImageModelSettings>): ImageModelSettings {
  const fallback = defaultImageModelSettings;
  const providerCandidate = settings?.provider;
  const provider = providerCandidate && imageProviders.includes(providerCandidate) ? providerCandidate : fallback.provider;
  const cfgScale = typeof settings?.cfgScale === "number" && Number.isFinite(settings.cfgScale) ? settings.cfgScale : undefined;
  const steps = typeof settings?.steps === "number" && Number.isFinite(settings.steps) ? Math.floor(settings.steps) : undefined;
  return {
    provider,
    model: settings?.model?.trim() || fallback.model,
    i2iModel: settings?.i2iModel?.trim() || undefined,
    baseUrl: settings?.baseUrl?.trim() || undefined,
    apiKey: settings?.apiKey?.trim() || undefined,
    accessKeyId: settings?.accessKeyId?.trim() || undefined,
    secretAccessKey: settings?.secretAccessKey?.trim() || undefined,
    region: settings?.region?.trim() || undefined,
    size: settings?.size?.trim() || fallback.size,
    cfgScale,
    steps,
    textMode: typeof settings?.textMode === "boolean" ? settings.textMode : undefined
  };
}

function normalizeSettings(settings?: Partial<AppSettings>): AppSettings {
  const legacyModel = settings?.model;
  const chat = normalizeModelSettings(settings?.models?.chat ?? legacyModel, defaultModelSettings);
  const image = normalizeImageSettings(settings?.models?.image);
  const tts = normalizeModelSettings(settings?.models?.tts, defaultTtsModelSettings);

  return {
    models: { chat, image, tts },
    model: chat
  };
}

function normalizeUser(user: UserProfile): UserProfile {
  if (user.username && user.passwordHash && user.passwordSalt) {
    return user;
  }
  const username = user.username || (user.id === "u_demo" ? "demo" : user.id);
  const legacy = hashPassword("companion123");
  return {
    ...user,
    username,
    passwordHash: user.passwordHash || legacy.hash,
    passwordSalt: user.passwordSalt || legacy.salt
  };
}

export function normalizeState(state: CompanionState): CompanionState {
  return {
    ...state,
    users: (state.users ?? []).map(normalizeUser),
    characters: (state.characters ?? []).map(normalizeCharacter),
    settings: normalizeSettings(state.settings),
    conversations: (state.conversations ?? []).map((conversation) => ({
      ...conversation,
      turnCount: conversation.turnCount ?? 0
    })),
    facts: (state.facts ?? []).map((fact) => ({ ...fact, source: fact.source ?? "rule" })),
    momentComments: state.momentComments ?? [],
    momentLikes: state.momentLikes ?? [],
    inviteCodes: state.inviteCodes ?? []
  };
}

export const REDACTED_API_KEY = "__REDACTED__";

function redactModelSettings(model: ModelSettings): ModelSettings {
  if (!model.apiKey) {
    return model;
  }
  return { ...model, apiKey: REDACTED_API_KEY };
}

function redactImageSettings(model: ImageModelSettings): ImageModelSettings {
  return {
    ...model,
    apiKey: model.apiKey ? REDACTED_API_KEY : model.apiKey,
    secretAccessKey: model.secretAccessKey ? REDACTED_API_KEY : model.secretAccessKey
  };
}

export function redactStateForClient(state: CompanionState): CompanionState {
  const models = state.settings.models;
  return {
    ...state,
    users: state.users.map((user) => ({ ...user, passwordHash: "", passwordSalt: "" })),
    messages: state.messages.map((message) =>
      message.imagePrompt ? { ...message, imagePrompt: undefined } : message
    ),
    settings: {
      ...state.settings,
      models: {
        chat: redactModelSettings(models.chat),
        image: redactImageSettings(models.image),
        tts: redactModelSettings(models.tts)
      },
      model: redactModelSettings(state.settings.model)
    }
  };
}

export function updateCharacterConfig(
  state: CompanionState,
  input: Partial<CharacterCard> & { characterId: string }
): CompanionState {
  const next = normalizeState(state);
  const characters = next.characters.map((character) => {
    if (character.id !== input.characterId) {
      return character;
    }
    return {
      ...character,
      name: input.name ?? character.name,
      tagline: input.tagline ?? character.tagline,
      imageUrl: input.imageUrl ?? character.imageUrl,
      personalityType: input.personalityType ?? character.personalityType,
      modelId: input.modelId ?? character.modelId,
      description: input.description ?? character.description,
      personality: input.personality ?? character.personality,
      scenario: input.scenario ?? character.scenario,
      firstMessage: input.firstMessage ?? character.firstMessage,
      messageExample: input.messageExample ?? character.messageExample,
      postHistoryInstructions: input.postHistoryInstructions ?? character.postHistoryInstructions,
      voiceId: input.voiceId ?? character.voiceId,
      avatarGradient: input.avatarGradient ?? character.avatarGradient,
      momentsPersona: input.momentsPersona ?? character.momentsPersona,
      affinityPrompts: input.affinityPrompts ?? character.affinityPrompts,
      characterBook: input.characterBook ?? character.characterBook,
      visibility: input.visibility ?? character.visibility,
      allowedUserIds: input.allowedUserIds ?? character.allowedUserIds,
      visualIdentity: input.visualIdentity
        ? { ...character.visualIdentity, ...input.visualIdentity }
        : character.visualIdentity
    };
  });

  if (!characters.some((character) => character.id === input.characterId)) {
    throw new Error(`Unknown character: ${input.characterId}`);
  }

  return {
    ...next,
    characters
  };
}

function keepSecret(incoming: unknown, current?: string): string | undefined {
  const trimmed = typeof incoming === "string" ? incoming.trim() : "";
  if (!trimmed) {
    return current;
  }
  return trimmed === REDACTED_API_KEY ? current : trimmed;
}

export function updateModelSettings(
  state: CompanionState,
  input: Partial<ModelSettings> | Partial<ImageModelSettings>,
  target: keyof AppSettings["models"] = "chat"
): CompanionState {
  const next = normalizeState(state);

  if (target === "image") {
    const current = next.settings.models.image;
    const patch = input as Partial<ImageModelSettings>;
    const image = normalizeImageSettings({
      ...current,
      ...patch,
      apiKey: keepSecret(patch.apiKey, current.apiKey),
      secretAccessKey: keepSecret(patch.secretAccessKey, current.secretAccessKey)
    });
    return {
      ...next,
      settings: { ...next.settings, models: { ...next.settings.models, image } }
    };
  }

  const current = next.settings.models[target] as ModelSettings;
  const patch = input as Partial<ModelSettings>;
  const apiKey = keepSecret(patch.apiKey, current.apiKey);
  const model = normalizeModelSettings({ ...current, ...patch, apiKey }, current);
  const models = {
    ...next.settings.models,
    [target]: model
  };

  return {
    ...next,
    settings: {
      ...next.settings,
      models,
      model: models.chat
    }
  };
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateAffinityPrompts(value: unknown): boolean {
  return isRecord(value) && Object.values(value).every((prompt) => typeof prompt === "string");
}

function validateCharacterBook(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.every(
      (entry) =>
        isRecord(entry) &&
        Array.isArray(entry.keywords) &&
        entry.keywords.every((keyword) => typeof keyword === "string") &&
        typeof entry.content === "string" &&
        Number.isFinite(entry.priority)
    )
  );
}

export function validateAdminSettingsPatch(input: unknown): {
  character?: Parameters<typeof updateCharacterConfig>[1];
  newCharacter?: { name: string; tagline?: string };
  model?: Partial<ModelSettings>;
  modelTarget?: keyof AppSettings["models"];
} {
  if (!isRecord(input)) {
    throw new Error("Request body must be a JSON object.");
  }

  const result: {
    character?: Parameters<typeof updateCharacterConfig>[1];
    newCharacter?: { name: string; tagline?: string };
    model?: Partial<ModelSettings>;
    modelTarget?: keyof AppSettings["models"];
  } = {};

  if ("newCharacter" in input) {
    if (!isRecord(input.newCharacter)) {
      throw new Error("newCharacter must be an object.");
    }
    if (typeof input.newCharacter.name !== "string" || input.newCharacter.name.trim() === "") {
      throw new Error("newCharacter.name is required.");
    }
    if ("tagline" in input.newCharacter && typeof input.newCharacter.tagline !== "string") {
      throw new Error("newCharacter.tagline must be a string.");
    }
    result.newCharacter = {
      name: input.newCharacter.name,
      tagline: typeof input.newCharacter.tagline === "string" ? input.newCharacter.tagline : undefined
    };
  }

  if ("character" in input) {
    if (!isRecord(input.character)) {
      throw new Error("character must be an object.");
    }
    if (typeof input.character.characterId !== "string" || input.character.characterId.trim() === "") {
      throw new Error("character.characterId is required.");
    }

    const character: JsonRecord = { characterId: input.character.characterId };
    for (const field of characterStringFields) {
      if (!(field in input.character)) {
        continue;
      }
      const value = input.character[field];
      if (typeof value !== "string") {
        throw new Error(`character.${field} must be a string.`);
      }
      character[field] = value;
    }
    if ("affinityPrompts" in input.character) {
      if (!validateAffinityPrompts(input.character.affinityPrompts)) {
        throw new Error("character.affinityPrompts must be an object of strings.");
      }
      character.affinityPrompts = input.character.affinityPrompts;
    }
    if ("characterBook" in input.character) {
      if (!validateCharacterBook(input.character.characterBook)) {
        throw new Error("character.characterBook must contain keyword, content and priority entries.");
      }
      character.characterBook = input.character.characterBook;
    }
    if ("visibility" in input.character) {
      const allowed: CharacterVisibility[] = ["public", "hidden", "restricted"];
      if (!allowed.includes(input.character.visibility as CharacterVisibility)) {
        throw new Error("character.visibility is invalid.");
      }
      character.visibility = input.character.visibility;
    }
    if ("allowedUserIds" in input.character) {
      if (
        !Array.isArray(input.character.allowedUserIds) ||
        !input.character.allowedUserIds.every((entry) => typeof entry === "string")
      ) {
        throw new Error("character.allowedUserIds must be an array of strings.");
      }
      character.allowedUserIds = input.character.allowedUserIds;
    }
    if ("visualIdentity" in input.character) {
      if (!isRecord(input.character.visualIdentity)) {
        throw new Error("character.visualIdentity must be an object.");
      }
      const raw = input.character.visualIdentity;
      const visualIdentity: JsonRecord = {};
      for (const field of ["referenceImageKey", "appearancePrompt", "negativePrompt"] as const) {
        if (field in raw) {
          if (typeof raw[field] !== "string") {
            throw new Error(`character.visualIdentity.${field} must be a string.`);
          }
          visualIdentity[field] = raw[field];
        }
      }
      if ("styleTags" in raw) {
        if (!Array.isArray(raw.styleTags) || !raw.styleTags.every((tag) => typeof tag === "string")) {
          throw new Error("character.visualIdentity.styleTags must be an array of strings.");
        }
        visualIdentity.styleTags = raw.styleTags;
      }
      if ("chatImageEnabled" in raw) {
        if (typeof raw.chatImageEnabled !== "boolean") {
          throw new Error("character.visualIdentity.chatImageEnabled must be a boolean.");
        }
        visualIdentity.chatImageEnabled = raw.chatImageEnabled;
      }
      if ("chatImageMinAffinity" in raw) {
        const allowedLevels: AffinityLevel[] = ["初识", "熟悉", "心动", "暧昧", "热恋"];
        if (!allowedLevels.includes(raw.chatImageMinAffinity as AffinityLevel)) {
          throw new Error("character.visualIdentity.chatImageMinAffinity is invalid.");
        }
        visualIdentity.chatImageMinAffinity = raw.chatImageMinAffinity;
      }
      character.visualIdentity = visualIdentity;
    }
    result.character = character as Parameters<typeof updateCharacterConfig>[1];
  }

  if ("model" in input) {
    if (!isRecord(input.model)) {
      throw new Error("model must be an object.");
    }

    const model: JsonRecord = {};
    let modelTarget: keyof AppSettings["models"] = "chat";
    if ("target" in input.model) {
      if (input.model.target !== "chat" && input.model.target !== "image" && input.model.target !== "tts") {
        throw new Error("model.target is invalid.");
      }
      modelTarget = input.model.target;
    }
    const providerWhitelist = modelTarget === "image" ? imageProviders : modelProviders;
    if ("provider" in input.model) {
      if (!(providerWhitelist as string[]).includes(input.model.provider as string)) {
        throw new Error("model.provider is invalid.");
      }
      model.provider = input.model.provider;
    }

    const stringFields =
      modelTarget === "image"
        ? (["model", "i2iModel", "baseUrl", "apiKey", "accessKeyId", "secretAccessKey", "region", "size"] as const)
        : (["model", "baseUrl", "apiKey"] as const);
    for (const field of stringFields) {
      if (!(field in input.model)) {
        continue;
      }
      if (typeof input.model[field] !== "string") {
        throw new Error(`model.${field} must be a string.`);
      }
      model[field] = input.model[field];
    }

    if (modelTarget === "image") {
      for (const field of ["cfgScale", "steps"] as const) {
        if (!(field in input.model)) {
          continue;
        }
        if (!Number.isFinite(input.model[field])) {
          throw new Error(`model.${field} must be a finite number.`);
        }
        model[field] = input.model[field];
      }
      if ("textMode" in input.model) {
        if (typeof input.model.textMode !== "boolean") {
          throw new Error("model.textMode must be a boolean.");
        }
        model.textMode = input.model.textMode;
      }
    }

    if (modelTarget !== "image") {
      for (const field of ["temperature", "maxContextTokens", "maxModelContextTokens"] as const) {
        if (!(field in input.model)) {
          continue;
        }
        if (!Number.isFinite(input.model[field])) {
          throw new Error(`model.${field} must be a finite number.`);
        }
        model[field] = input.model[field];
      }
    }
    if (typeof model.model === "string" && model.model.trim() === "") {
      throw new Error("model.model cannot be blank.");
    }
    if (typeof model.temperature === "number" && (model.temperature < 0 || model.temperature > 2)) {
      throw new Error("model.temperature must be between 0 and 2.");
    }
    if (typeof model.maxContextTokens === "number" && model.maxContextTokens < 1) {
      throw new Error("model.maxContextTokens must be greater than 0.");
    }
    if (typeof model.maxModelContextTokens === "number" && model.maxModelContextTokens < 1) {
      throw new Error("model.maxModelContextTokens must be greater than 0.");
    }
    result.model = model as Partial<ModelSettings>;
    result.modelTarget = modelTarget;
  }

  if (!result.character && !result.model && !result.newCharacter) {
    throw new Error("Request body must include character or model settings.");
  }

  return result;
}
