import { buildPrompt } from "@/domain/agent";
import { calculateAffinity } from "@/domain/affinity";
import { generateInviteCode, hashPassword, isValidPassword, isValidUsername, verifyPassword } from "@/domain/auth";
import { characters, isCharacterVisibleTo } from "@/domain/characters";
import { mergeFacts, retrieveFacts } from "@/domain/memory";
import { generateMoment, generateProactiveMessage } from "@/domain/moments";
import { maskUnsafeOutput, moderateInput } from "@/domain/safety";
import { readAsset, saveAsset } from "./asset-store";
import { resolveImageProvider, type GenerateImageRequest } from "./image-provider";
import type {
  AffinityLevel,
  AffinityRecord,
  CharacterCard,
  CompanionState,
  Conversation,
  Fact,
  InviteCode,
  Message,
  Moment,
  MomentComment,
  ModelSettings,
  ProactiveMessage,
  UserProfile
} from "@/domain/types";
import { extractFactsLLM, generateSummaryLLM } from "./memory-provider";
import { createChatReply } from "./model-provider";
import { generateProactiveContent } from "./proactive-provider";

const affinityDailyCap = 20;
const likeAffinityDelta = 2;
const commentAffinityDelta = 3;
const maxCommentLength = 500;

const demoPassword = hashPassword("companion123");
const demoUser = {
  id: "u_demo",
  username: "demo",
  passwordHash: demoPassword.hash,
  passwordSalt: demoPassword.salt,
  nickname: "小满",
  minorMode: false,
  ttsEnabled: false
};

function id(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

export function resolveActiveUserId(state: CompanionState): string {
  const user = state.users[0];
  if (!user) {
    throw new Error("No provisioned user.");
  }
  return user.id;
}

export function getUserById(state: CompanionState, userId: string): UserProfile | undefined {
  return state.users.find((user) => user.id === userId);
}

export function authenticateUser(state: CompanionState, username: string, password: string): UserProfile | null {
  const user = state.users.find((item) => item.username.toLowerCase() === username.trim().toLowerCase());
  if (!user) {
    return null;
  }
  return verifyPassword(password, user.passwordHash, user.passwordSalt) ? user : null;
}

export function createInviteCode(state: CompanionState, now: string): { state: CompanionState; code: string } {
  const existing = new Set(state.inviteCodes.map((item) => item.code));
  let code = generateInviteCode();
  while (existing.has(code)) {
    code = generateInviteCode();
  }
  return {
    state: {
      ...state,
      inviteCodes: [...state.inviteCodes, { code, createdAt: now }]
    },
    code
  };
}

export function registerUser(
  state: CompanionState,
  input: { inviteCode: string; username: string; password: string; now: string }
): { state: CompanionState; user: UserProfile } {
  const username = input.username.trim();
  if (!isValidUsername(username)) {
    throw new Error("用户名需为 3-20 位字母、数字或下划线。");
  }
  if (!isValidPassword(input.password)) {
    throw new Error("密码长度需为 6-128 位。");
  }
  if (state.users.some((item) => item.username.toLowerCase() === username.toLowerCase())) {
    throw new Error("该用户名已被占用。");
  }
  const invite = state.inviteCodes.find((item) => item.code === input.inviteCode.trim().toUpperCase());
  if (!invite) {
    throw new Error("邀请码无效。");
  }
  if (invite.usedByUserId) {
    throw new Error("邀请码已被使用。");
  }

  const { hash, salt } = hashPassword(input.password);
  const user: UserProfile = {
    id: `u_${Math.random().toString(36).slice(2, 12)}`,
    username,
    passwordHash: hash,
    passwordSalt: salt,
    nickname: username,
    minorMode: false,
    ttsEnabled: false,
    createdAt: input.now
  };

  let nextState: CompanionState = {
    ...state,
    users: [...state.users, user],
    inviteCodes: state.inviteCodes.map((item) =>
      item.code === invite.code ? { ...item, usedByUserId: user.id, usedAt: input.now } : item
    )
  };

  for (const character of nextState.characters) {
    if (isCharacterVisibleTo(character, user.id)) {
      nextState = activateCharacterForUser(nextState, {
        userId: user.id,
        characterId: character.id,
        now: input.now
      }).state;
    }
  }

  return { state: nextState, user };
}

export function scopeStateForUser(state: CompanionState, userId: string): CompanionState {
  const conversationIds = new Set(
    state.conversations.filter((item) => item.userId === userId).map((item) => item.id)
  );
  const user = state.users.find((item) => item.id === userId);
  return {
    ...state,
    users: user ? [user] : [],
    conversations: state.conversations.filter((item) => item.userId === userId),
    messages: state.messages.filter((item) => conversationIds.has(item.conversationId)),
    facts: state.facts.filter((item) => item.userId === userId),
    affinity: state.affinity.filter((item) => item.userId === userId),
    moments: state.moments.filter((item) => item.userId === userId),
    momentLikes: state.momentLikes.filter((item) => item.userId === userId),
    proactiveMessages: state.proactiveMessages.filter((item) => item.userId === userId),
    inviteCodes: []
  };
}

export function getStateCharacter(state: CompanionState, characterId: string): CharacterCard {
  const character = state.characters.find((item) => item.id === characterId);
  if (!character) {
    throw new Error(`Unknown character: ${characterId}`);
  }
  return character;
}

const defaultAffinityPrompts: Record<AffinityLevel, string> = {
  "初识": "保持礼貌距离，语气克制，更多观察与确认。",
  "熟悉": "可以自然关心用户，记住称呼和偏好。",
  "心动": "偶尔流露在意，但不直白索取回应。",
  "暧昧": "语气更贴近，允许轻微暧昧和专属称呼。",
  "热恋": "稳定、亲密、专一，主动表达陪伴感。"
};

function slugifyCharacterId(name: string, taken: Set<string>): string {
  const base =
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
      .replace(/^-+|-+$/g, "") || "role";
  const encoded = /[a-z0-9-]+/.test(base) && !/[\u4e00-\u9fa5]/.test(base) ? base : `role-${id("").slice(1)}`;
  let candidate = encoded;
  let suffix = 2;
  while (taken.has(candidate)) {
    candidate = `${encoded}-${suffix}`;
    suffix += 1;
  }
  return candidate;
}

export function createCharacterForState(
  state: CompanionState,
  input: { name: string; tagline?: string; now: string }
): { state: CompanionState; character: CharacterCard } {
  const name = input.name.trim();
  if (!name) {
    throw new Error("Character name is required.");
  }
  const taken = new Set(state.characters.map((item) => item.id));
  const characterId = slugifyCharacterId(name, taken);
  const tagline = input.tagline?.trim() || "新的陪伴角色";

  const character: CharacterCard = {
    id: characterId,
    name,
    tagline,
    imageUrl: "",
    personalityType: "克制守护",
    modelId: "default",
    description: "",
    personality: "",
    scenario: "",
    firstMessage: `你好，我是${name}。很高兴认识你。`,
    messageExample: "",
    postHistoryInstructions: "不要脱离角色。回复要像真实私聊，短句为主，避免解释设定，避免自称 AI。",
    voiceId: "",
    avatarGradient: "linear-gradient(145deg, #4b3f6b, #c76b98)",
    momentsPersona: "像一个真实的人分享生活片段，动态具体、有画面。",
    affinityPrompts: { ...defaultAffinityPrompts },
    characterBook: [],
    visibility: "hidden"
  };

  return {
    state: {
      ...state,
      characters: [...state.characters, character]
    },
    character
  };
}

export function isCharacterActivated(state: CompanionState, userId: string, characterId: string): boolean {
  return state.conversations.some((item) => item.userId === userId && item.characterId === characterId);
}

export function activateCharacterForUser(
  state: CompanionState,
  input: { userId: string; characterId: string; now: string }
): { state: CompanionState; conversationId: string; alreadyActive: boolean } {
  const character = getStateCharacter(state, input.characterId);
  if (!isCharacterVisibleTo(character, input.userId)) {
    throw new Error("Character is not available to this user.");
  }
  const existing = state.conversations.find(
    (item) => item.userId === input.userId && item.characterId === input.characterId
  );
  if (existing) {
    return { state, conversationId: existing.id, alreadyActive: true };
  }

  const conversation: Conversation = {
    id: `conv_${input.characterId}_${input.userId}`,
    userId: input.userId,
    characterId: input.characterId,
    summary: "刚开始认识，还没有形成长期摘要。",
    summaryTurn: 0,
    turnCount: 0,
    lastActiveAt: input.now
  };
  const firstMessage: Message = {
    id: id("msg"),
    conversationId: conversation.id,
    role: "assistant",
    content: character.firstMessage,
    status: "completed",
    createdAt: input.now
  };
  const affinity: AffinityRecord = {
    userId: input.userId,
    characterId: input.characterId,
    score: 0,
    level: "初识",
    updatedAt: input.now
  };

  return {
    state: {
      ...state,
      conversations: [...state.conversations, conversation],
      messages: [...state.messages, firstMessage],
      affinity: [...state.affinity, affinity]
    },
    conversationId: conversation.id,
    alreadyActive: false
  };
}

export function createInitialState(now = new Date().toISOString()): CompanionState {
  const conversations: Conversation[] = characters.map((character) => ({
    id: `conv_${character.id}`,
    userId: demoUser.id,
    characterId: character.id,
    summary: "刚开始认识，还没有形成长期摘要。",
    summaryTurn: 0,
    turnCount: 0,
    lastActiveAt: now
  }));
  const firstMessages: Message[] = conversations.map((conversation) => {
    const character = characters.find((item) => item.id === conversation.characterId);
    if (!character) {
      throw new Error(`Unknown character: ${conversation.characterId}`);
    }
    return {
      id: id("msg"),
      conversationId: conversation.id,
      role: "assistant",
      content: character.firstMessage,
      status: "completed",
      createdAt: now
    };
  });
  const affinity: AffinityRecord[] = characters.map((character) => ({
    userId: demoUser.id,
    characterId: character.id,
    score: 0,
    level: "初识",
    updatedAt: now
  }));

  return {
    users: [{ ...demoUser, createdAt: now }],
    characters,
    settings: {
      models: {
        chat: {
          provider: "dev",
          model: "dev-companion",
          temperature: 0.7,
          maxContextTokens: 16000,
          maxModelContextTokens: 16000
        },
        image: {
          provider: "dev",
          model: "dev-image",
          size: "1024x1024"
        },
        tts: {
          provider: "dev",
          model: "dev-tts",
          temperature: 0.7,
          maxContextTokens: 2000,
          maxModelContextTokens: 2000
        }
      },
      model: {
        provider: "dev",
        model: "dev-companion",
        temperature: 0.7,
        maxContextTokens: 16000,
        maxModelContextTokens: 16000
      }
    },
    conversations,
    messages: firstMessages,
    facts: [],
    affinity,
    moments: [],
    momentComments: [],
    momentLikes: [],
    proactiveMessages: [],
    auditLogs: [],
    inviteCodes: []
  };
}

export interface BlockedChatTurn {
  allowed: false;
  state: CompanionState;
  reply: string;
  userMessage: Message;
}

export interface PreparedChatTurn {
  allowed: true;
  state: CompanionState;
  conversation: Conversation;
  character: CharacterCard;
  settings: ModelSettings;
  userMessage: Message;
  assistantMessageId: string;
  prompt: string;
  history: Message[];
  relevantFacts: Fact[];
  affinityLevel: AffinityLevel;
  minorMode: boolean;
}

export type ChatTurnStart = BlockedChatTurn | PreparedChatTurn;

export function beginChatTurn(
  state: CompanionState,
  input: { conversationId: string; content: string; now: string }
): ChatTurnStart {
  const conversation = state.conversations.find((item) => item.id === input.conversationId);
  if (!conversation) {
    throw new Error(`Unknown conversation: ${input.conversationId}`);
  }
  const character = getStateCharacter(state, conversation.characterId);
  const minorMode = state.users.find((item) => item.id === conversation.userId)?.minorMode ?? false;
  const moderation = moderateInput(input.content, { minorMode });
  const userMessage: Message = {
    id: id("msg"),
    conversationId: conversation.id,
    role: "user",
    content: input.content,
    status: moderation.allowed ? "completed" : "blocked",
    createdAt: input.now
  };

  if (!moderation.allowed) {
    return {
      allowed: false,
      state: {
        ...state,
        messages: [...state.messages, userMessage],
        auditLogs: [
          ...state.auditLogs,
          {
            id: id("audit"),
            scene: "chat_input",
            contentRef: userMessage.id,
            providerResult: moderation.reason ?? "blocked",
            action: "blocked",
            createdAt: input.now
          }
        ]
      },
      reply: moderation.replacement ?? "这个话题我不能继续。",
      userMessage
    };
  }

  const currentAffinity = state.affinity.find(
    (item) => item.userId === conversation.userId && item.characterId === conversation.characterId
  );
  if (!currentAffinity) {
    throw new Error("Missing affinity record");
  }
  const relevantFacts = retrieveFacts(
    state.facts.filter((fact) => fact.userId === conversation.userId && fact.characterId === conversation.characterId),
    input.content,
    5
  );
  const history = state.messages
    .filter((message) => message.conversationId === conversation.id && message.status === "completed")
    .slice(-12);
  const prompt = buildPrompt({
    character,
    affinityLevel: currentAffinity.level,
    facts: relevantFacts,
    summary: conversation.summary,
    history,
    userMessage: input.content,
    minorMode
  });

  return {
    allowed: true,
    state,
    conversation,
    character,
    settings: state.settings.models.chat,
    userMessage,
    assistantMessageId: id("msg"),
    prompt,
    history,
    relevantFacts,
    affinityLevel: currentAffinity.level,
    minorMode
  };
}

export function finalizeChatTurn(
  prepared: PreparedChatTurn,
  input: {
    modelResult: { reply: string; usedFallback: boolean; attempts: number; error?: string };
    now: string;
    baseState?: CompanionState;
  }
): { state: CompanionState; reply: string } {
  const { conversation, userMessage, assistantMessageId } = prepared;
  const state = input.baseState ?? prepared.state;
  const { modelResult } = input;
  const safeReply = maskUnsafeOutput(modelResult.reply, { minorMode: prepared.minorMode });
  const assistantMessage: Message = {
    id: assistantMessageId,
    conversationId: conversation.id,
    role: "assistant",
    content: safeReply,
    status: "completed",
    createdAt: input.now
  };

  const currentAffinity = state.affinity.find(
    (item) => item.userId === conversation.userId && item.characterId === conversation.characterId
  );
  if (!currentAffinity) {
    throw new Error("Missing affinity record");
  }
  const nextAffinity = calculateAffinity(currentAffinity, [{ reason: "chat_turn", delta: 4 }], 20, input.now);

  const auditLogs = [
    ...state.auditLogs,
    ...(modelResult.usedFallback && modelResult.error
      ? [
          {
            id: id("audit"),
            scene: "chat_model",
            contentRef: assistantMessage.id,
            providerResult: `${modelResult.error}; attempts=${modelResult.attempts}`,
            action: "fallback",
            createdAt: input.now
          }
        ]
      : []),
    ...(safeReply !== modelResult.reply
      ? [
          {
            id: id("audit"),
            scene: "chat_output",
            contentRef: assistantMessage.id,
            providerResult: "local_output_filter",
            action: "replaced",
            createdAt: input.now
          }
        ]
      : [])
  ];

  return {
    state: {
      ...state,
      conversations: state.conversations.map((item) =>
        item.id === conversation.id
          ? { ...item, lastActiveAt: input.now, lastReadAt: input.now, turnCount: (item.turnCount ?? 0) + 1 }
          : item
      ),
      messages: [...state.messages, userMessage, assistantMessage],
      affinity: state.affinity.map((item) =>
        item.userId === nextAffinity.userId && item.characterId === nextAffinity.characterId ? nextAffinity : item
      ),
      auditLogs
    },
    reply: safeReply
  };
}

export async function handleChatTurn(
  state: CompanionState,
  input: { conversationId: string; content: string; now: string }
): Promise<{ state: CompanionState; allowed: boolean; reply: string; prompt?: string }> {
  const start = beginChatTurn(state, input);
  if (!start.allowed) {
    return { state: start.state, allowed: false, reply: start.reply };
  }

  const modelResult = await createChatReply({
    settings: start.settings,
    character: start.character,
    userMessage: input.content,
    prompt: start.prompt,
    history: start.history,
    facts: start.relevantFacts,
    affinityLevel: start.affinityLevel
  });

  const finished = finalizeChatTurn(start, { modelResult, now: input.now });
  const enriched = await enrichChatTurnMemory(finished.state, {
    conversationId: input.conversationId,
    userMessage: input.content,
    assistantReply: finished.reply,
    now: input.now
  });
  return { state: enriched, allowed: true, reply: finished.reply, prompt: start.prompt };
}

const summaryTurnThreshold = 40;

export async function enrichChatTurnMemory(
  state: CompanionState,
  input: { conversationId: string; userMessage: string; assistantReply: string; now: string }
): Promise<CompanionState> {
  const conversation = state.conversations.find((item) => item.id === input.conversationId);
  if (!conversation) {
    return state;
  }
  const settings = state.settings.models.chat;

  const { candidates, source } = await extractFactsLLM({
    settings,
    userMessage: input.userMessage,
    assistantReply: input.assistantReply
  });

  let nextFacts = state.facts;
  if (candidates.length > 0) {
    const merged = mergeFacts(
      state.facts,
      candidates,
      { userId: conversation.userId, characterId: conversation.characterId, now: input.now },
      source
    );
    nextFacts = merged.facts;
  }

  let nextSummary = conversation.summary;
  let nextSummaryTurn = conversation.summaryTurn;
  if (conversation.turnCount - conversation.summaryTurn >= summaryTurnThreshold) {
    const history = state.messages
      .filter((message) => message.conversationId === conversation.id && message.status === "completed")
      .slice(-30);
    const summary = await generateSummaryLLM({ settings, priorSummary: conversation.summary, history });
    if (summary) {
      nextSummary = summary;
      nextSummaryTurn = conversation.turnCount;
    }
  }

  return {
    ...state,
    facts: nextFacts,
    conversations: state.conversations.map((item) =>
      item.id === conversation.id ? { ...item, summary: nextSummary, summaryTurn: nextSummaryTurn } : item
    )
  };
}

export function deleteFact(
  state: CompanionState,
  factId: string
): CompanionState {
  const target = state.facts.find((fact) => fact.id === factId);
  if (!target) {
    return state;
  }
  return {
    ...state,
    facts: state.facts
      .filter((fact) => fact.id !== factId)
      .map((fact) => (fact.supersededBy === factId ? { ...fact, supersededBy: undefined } : fact))
  };
}

function buildMomentImagePrompt(character: CharacterCard, momentContent: string): GenerateImageRequest {
  const visual = character.visualIdentity;
  const appearance = visual?.appearancePrompt ?? character.tagline;
  const style = visual?.styleTags?.length ? `，${visual.styleTags.join("、")}` : "";
  return {
    prompt: `${appearance}。场景：${momentContent}。竖构图生活随拍${style}`,
    negativePrompt: visual?.negativePrompt
  };
}

async function loadReferenceImage(referenceImageKey?: string): Promise<GenerateImageRequest["referenceImage"]> {
  if (!referenceImageKey) {
    return undefined;
  }
  const asset = await readAsset(referenceImageKey);
  if (!asset) {
    return undefined;
  }
  return { kind: "base64", data: asset.bytes.toString("base64"), mime: asset.mime };
}

async function generateMomentImageKey(
  state: CompanionState,
  character: CharacterCard,
  momentContent: string
): Promise<string | undefined> {
  const settings = state.settings.models.image;
  const provider = resolveImageProvider(settings);
  try {
    const request = buildMomentImagePrompt(character, momentContent);
    request.referenceImage = await loadReferenceImage(character.visualIdentity?.referenceImageKey);
    const result = await provider.generate(request);
    if (result.status !== "completed") {
      console.error(`[moment-image] generation failed for ${character.id}:`, result.error);
      return undefined;
    }
    return await saveAsset(result.image.data, result.image.mime);
  } catch (error) {
    console.error(`[moment-image] unexpected error for ${character.id}:`, error);
    return undefined;
  }
}

export async function createMomentForUser(
  state: CompanionState,
  input: { userId: string; characterId: string; now: string }
): Promise<CompanionState> {
  const character = getStateCharacter(state, input.characterId);
  const conversation = state.conversations.find(
    (item) => item.userId === input.userId && item.characterId === input.characterId
  );
  const facts = state.facts.filter((fact) => fact.userId === input.userId && fact.characterId === input.characterId);
  const moment = generateMoment({
    character,
    userId: input.userId,
    summary: conversation?.summary ?? "",
    facts,
    now: input.now
  });

  const imageUrl =
    moment.status === "published"
      ? await generateMomentImageKey(state, character, moment.content)
      : undefined;

  return {
    ...state,
    moments: [...state.moments, imageUrl ? { ...moment, imageUrl } : moment]
  };
}

function findAffinity(state: CompanionState, userId: string, characterId: string): AffinityRecord {
  const affinity = state.affinity.find((item) => item.userId === userId && item.characterId === characterId);
  if (!affinity) {
    throw new Error("Missing affinity record");
  }
  return affinity;
}

function applyAffinityBump(
  state: CompanionState,
  userId: string,
  characterId: string,
  reason: string,
  delta: number,
  now: string
): CompanionState {
  const current = findAffinity(state, userId, characterId);
  const next = calculateAffinity(current, [{ reason, delta }], affinityDailyCap, now);
  return {
    ...state,
    affinity: state.affinity.map((item) =>
      item.userId === next.userId && item.characterId === next.characterId ? next : item
    )
  };
}

export function toggleMomentLike(
  state: CompanionState,
  input: { momentId: string; userId: string; now: string }
): { state: CompanionState; liked: boolean; likeCount: number } {
  const moment = state.moments.find((item) => item.id === input.momentId);
  if (!moment || moment.status !== "published") {
    throw new Error("Moment is not available for interaction.");
  }

  const alreadyLiked = state.momentLikes.some(
    (like) => like.momentId === input.momentId && like.userId === input.userId
  );

  let nextLikes = state.momentLikes;
  if (alreadyLiked) {
    nextLikes = state.momentLikes.filter(
      (like) => !(like.momentId === input.momentId && like.userId === input.userId)
    );
  } else {
    nextLikes = [...state.momentLikes, { userId: input.userId, momentId: input.momentId, createdAt: input.now }];
  }

  let nextState: CompanionState = { ...state, momentLikes: nextLikes };

  const likeAuditRef = `${input.userId}:${input.momentId}`;
  const alreadyGranted = state.auditLogs.some(
    (log) => log.scene === "moment_like" && log.contentRef === likeAuditRef
  );
  if (!alreadyLiked && !alreadyGranted) {
    nextState = applyAffinityBump(nextState, input.userId, moment.characterId, "moment_like", likeAffinityDelta, input.now);
    nextState = {
      ...nextState,
      auditLogs: [
        ...nextState.auditLogs,
        {
          id: id("audit"),
          scene: "moment_like",
          contentRef: likeAuditRef,
          providerResult: `+${likeAffinityDelta}`,
          action: "affinity_granted",
          createdAt: input.now
        }
      ]
    };
  }

  const likeCount = nextLikes.filter((like) => like.momentId === input.momentId).length;
  return { state: nextState, liked: !alreadyLiked, likeCount };
}

interface MomentCommentContext {
  moment: Moment;
  character: CharacterCard;
  settings: ModelSettings;
  prompt: string;
  affinityLevel: AffinityLevel;
  userComment: MomentComment;
}

export type MomentCommentStart =
  | { allowed: false; state: CompanionState; reply: string }
  | { allowed: true; context: MomentCommentContext };

export function beginMomentComment(
  state: CompanionState,
  input: { momentId: string; userId: string; content: string; now: string }
): MomentCommentStart {
  const content = input.content.trim();
  if (!content) {
    throw new Error("Comment content is required.");
  }
  if (content.length > maxCommentLength) {
    throw new Error(`Comment exceeds ${maxCommentLength} characters.`);
  }

  const moment = state.moments.find((item) => item.id === input.momentId);
  if (!moment || moment.status !== "published") {
    throw new Error("Moment is not available for interaction.");
  }
  const character = getStateCharacter(state, moment.characterId);
  const minorMode = state.users.find((item) => item.id === input.userId)?.minorMode ?? false;
  const moderation = moderateInput(content, { minorMode });

  const userComment: MomentComment = {
    id: id("comment"),
    momentId: moment.id,
    author: "user",
    content,
    createdAt: input.now
  };

  if (!moderation.allowed) {
    return {
      allowed: false,
      state: {
        ...state,
        auditLogs: [
          ...state.auditLogs,
          {
            id: id("audit"),
            scene: "moment_input",
            contentRef: userComment.id,
            providerResult: moderation.reason ?? "blocked",
            action: "blocked",
            createdAt: input.now
          }
        ]
      },
      reply: moderation.replacement ?? "这条评论我不能回复。"
    };
  }

  const affinity = findAffinity(state, input.userId, moment.characterId);
  const facts = state.facts.filter(
    (fact) => fact.userId === input.userId && fact.characterId === moment.characterId
  );
  const conversation = state.conversations.find(
    (item) => item.userId === input.userId && item.characterId === moment.characterId
  );
  const userMessage = `用户在你的朋友圈动态『${moment.content}』下评论：${content}`;
  const prompt = buildPrompt({
    character,
    affinityLevel: affinity.level,
    facts,
    summary: conversation?.summary ?? "",
    history: [],
    userMessage
  });

  return {
    allowed: true,
    context: {
      moment,
      character,
      settings: state.settings.models.chat,
      prompt,
      affinityLevel: affinity.level,
      userComment
    }
  };
}

export function finalizeMomentComment(
  state: CompanionState,
  input: {
    context: MomentCommentContext;
    modelResult: { reply: string; usedFallback: boolean; attempts: number; error?: string };
    userId: string;
    now: string;
  }
): { state: CompanionState; reply: string } {
  const { context, modelResult } = input;
  const safeReply = maskUnsafeOutput(modelResult.reply);
  const characterComment: MomentComment = {
    id: id("comment"),
    momentId: context.moment.id,
    author: "character",
    content: safeReply,
    createdAt: input.now
  };

  let nextState: CompanionState = {
    ...state,
    momentComments: [...state.momentComments, context.userComment, characterComment],
    auditLogs: [
      ...state.auditLogs,
      ...(modelResult.usedFallback && modelResult.error
        ? [
            {
              id: id("audit"),
              scene: "moment_model",
              contentRef: characterComment.id,
              providerResult: `${modelResult.error}; attempts=${modelResult.attempts}`,
              action: "fallback",
              createdAt: input.now
            }
          ]
        : []),
      ...(safeReply !== modelResult.reply
        ? [
            {
              id: id("audit"),
              scene: "moment_output",
              contentRef: characterComment.id,
              providerResult: "local_output_filter",
              action: "replaced",
              createdAt: input.now
            }
          ]
        : [])
    ]
  };

  nextState = applyAffinityBump(
    nextState,
    input.userId,
    context.moment.characterId,
    "moment_comment",
    commentAffinityDelta,
    input.now
  );

  return { state: nextState, reply: safeReply };
}

export async function handleMomentComment(
  state: CompanionState,
  input: { momentId: string; userId: string; content: string; now: string }
): Promise<{ state: CompanionState; allowed: boolean; reply: string }> {
  const start = beginMomentComment(state, input);
  if (!start.allowed) {
    return { state: start.state, allowed: false, reply: start.reply };
  }

  const modelResult = await createChatReply({
    settings: start.context.settings,
    character: start.context.character,
    userMessage: start.context.userComment.content,
    prompt: start.context.prompt,
    history: [],
    facts: [],
    affinityLevel: start.context.affinityLevel
  });

  const finished = finalizeMomentComment(state, {
    context: start.context,
    modelResult,
    userId: input.userId,
    now: input.now
  });
  return { state: finished.state, allowed: true, reply: finished.reply };
}

export function createProactiveForUser(
  state: CompanionState,
  input: { userId: string; characterId: string; now: string }
): CompanionState {
  const user = state.users.find((item) => item.id === input.userId);
  const character = getStateCharacter(state, input.characterId);
  const conversation = state.conversations.find(
    (item) => item.userId === input.userId && item.characterId === input.characterId
  );
  const affinity = state.affinity.find((item) => item.userId === input.userId && item.characterId === input.characterId);
  if (!user || !conversation || !affinity) {
    throw new Error("Missing proactive message context");
  }
  const content = generateProactiveMessage({
    character,
    userNickname: user.nickname,
    summary: conversation.summary,
    affinityLevel: affinity.level,
    now: input.now
  });

  return {
    ...state,
    proactiveMessages: [
      ...state.proactiveMessages,
      {
        id: id("proactive"),
        userId: input.userId,
        characterId: input.characterId,
        content,
        status: "sent",
        sentAt: input.now,
        createdAt: input.now
      }
    ]
  };
}

const proactiveThresholdHours: Record<AffinityLevel, number | null> = {
  "初识": 48,
  "熟悉": 24,
  "心动": 12,
  "暧昧": 8,
  "热恋": 6
};
const quietHourStart = 23;
const quietHourEnd = 8;

function hoursBetween(fromIso: string, toIso: string): number {
  return (new Date(toIso).getTime() - new Date(fromIso).getTime()) / 3_600_000;
}

function isQuietHour(now: string): boolean {
  const hour = new Date(now).getHours();
  return hour >= quietHourStart || hour < quietHourEnd;
}

function proactiveForCharacter(state: CompanionState, userId: string, characterId: string): ProactiveMessage[] {
  return state.proactiveMessages.filter((item) => item.userId === userId && item.characterId === characterId);
}

function hasUnreadProactive(conversation: Conversation, proactive: ProactiveMessage[]): boolean {
  return proactive.some(
    (item) => item.status === "sent" && (!conversation.lastReadAt || (item.sentAt ?? item.createdAt) > conversation.lastReadAt)
  );
}

export function shouldReachOut(
  conversation: Conversation,
  affinity: AffinityRecord,
  proactive: ProactiveMessage[],
  now: string
): boolean {
  const threshold = proactiveThresholdHours[affinity.level];
  if (threshold === null) {
    return false;
  }
  if (isQuietHour(now)) {
    return false;
  }
  if (hasUnreadProactive(conversation, proactive)) {
    return false;
  }
  const anchor = proactive.reduce((latest, item) => (item.createdAt > latest ? item.createdAt : latest), conversation.lastActiveAt);
  return hoursBetween(anchor, now) >= threshold;
}

interface ProactiveCandidate {
  userId: string;
  characterId: string;
  content: string;
  source: "llm" | "rule";
  allowed: boolean;
  reason?: string;
}

export async function runProactiveScan(
  state: CompanionState,
  now: string
): Promise<ProactiveCandidate[]> {
  const candidates: ProactiveCandidate[] = [];
  for (const conversation of state.conversations) {
    const affinity = state.affinity.find(
      (item) => item.userId === conversation.userId && item.characterId === conversation.characterId
    );
    const user = state.users.find((item) => item.id === conversation.userId);
    if (!affinity || !user) {
      continue;
    }
    const proactive = proactiveForCharacter(state, conversation.userId, conversation.characterId);
    if (!shouldReachOut(conversation, affinity, proactive, now)) {
      continue;
    }
    const character = getStateCharacter(state, conversation.characterId);
    const threshold = proactiveThresholdHours[affinity.level] ?? 24;
    const generated = await generateProactiveContent({
      settings: state.settings.models.chat,
      character,
      userNickname: user.nickname,
      summary: conversation.summary,
      affinityLevel: affinity.level,
      silenceHours: threshold,
      now
    });
    const moderation = moderateInput(generated.content);
    candidates.push({
      userId: conversation.userId,
      characterId: conversation.characterId,
      content: generated.content,
      source: generated.source,
      allowed: moderation.allowed,
      reason: moderation.reason
    });
  }
  return candidates;
}

export function applyProactiveResults(
  state: CompanionState,
  candidates: ProactiveCandidate[],
  now: string
): { state: CompanionState; sent: number; blocked: number } {
  let nextState = state;
  let sent = 0;
  let blocked = 0;

  for (const candidate of candidates) {
    const conversation = nextState.conversations.find(
      (item) => item.userId === candidate.userId && item.characterId === candidate.characterId
    );
    const affinity = nextState.affinity.find(
      (item) => item.userId === candidate.userId && item.characterId === candidate.characterId
    );
    if (!conversation || !affinity) {
      continue;
    }
    const proactive = proactiveForCharacter(nextState, candidate.userId, candidate.characterId);
    if (!shouldReachOut(conversation, affinity, proactive, now)) {
      continue;
    }

    const proactiveId = id("proactive");
    const message: ProactiveMessage = candidate.allowed
      ? {
          id: proactiveId,
          userId: candidate.userId,
          characterId: candidate.characterId,
          content: candidate.content,
          status: "sent",
          sentAt: now,
          createdAt: now
        }
      : {
          id: proactiveId,
          userId: candidate.userId,
          characterId: candidate.characterId,
          content: candidate.content,
          status: "blocked",
          createdAt: now
        };

    if (candidate.allowed) {
      sent += 1;
    } else {
      blocked += 1;
    }

    nextState = {
      ...nextState,
      proactiveMessages: [...nextState.proactiveMessages, message],
      auditLogs: [
        ...nextState.auditLogs,
        {
          id: id("audit"),
          scene: "proactive_model",
          contentRef: proactiveId,
          providerResult: candidate.source,
          action: "generated",
          createdAt: now
        },
        {
          id: id("audit"),
          scene: "proactive_output",
          contentRef: proactiveId,
          providerResult: candidate.allowed ? "passed" : candidate.reason ?? "blocked",
          action: candidate.allowed ? "sent" : "blocked",
          createdAt: now
        }
      ]
    };
  }

  return { state: nextState, sent, blocked };
}

export async function runProactiveForUser(
  state: CompanionState,
  input: { userId: string; characterId: string; now: string }
): Promise<{ state: CompanionState; sent: number; blocked: number; skipped: boolean }> {
  const conversation = state.conversations.find(
    (item) => item.userId === input.userId && item.characterId === input.characterId
  );
  const affinity = state.affinity.find(
    (item) => item.userId === input.userId && item.characterId === input.characterId
  );
  const user = state.users.find((item) => item.id === input.userId);
  if (!conversation || !affinity || !user) {
    throw new Error("Missing proactive message context");
  }

  const proactive = proactiveForCharacter(state, input.userId, input.characterId);
  if (!shouldReachOut(conversation, affinity, proactive, input.now)) {
    return { state, sent: 0, blocked: 0, skipped: true };
  }

  const character = getStateCharacter(state, input.characterId);
  const threshold = proactiveThresholdHours[affinity.level] ?? 24;
  const generated = await generateProactiveContent({
    settings: state.settings.models.chat,
    character,
    userNickname: user.nickname,
    summary: conversation.summary,
    affinityLevel: affinity.level,
    silenceHours: threshold,
    now: input.now
  });
  const moderation = moderateInput(generated.content);

  const result = applyProactiveResults(
    state,
    [
      {
        userId: input.userId,
        characterId: input.characterId,
        content: generated.content,
        source: generated.source,
        allowed: moderation.allowed,
        reason: moderation.reason
      }
    ],
    input.now
  );

  return { state: result.state, sent: result.sent, blocked: result.blocked, skipped: false };
}

export function updateUserFlags(
  state: CompanionState,
  input: { userId: string; minorMode?: boolean; ttsEnabled?: boolean }
): CompanionState {
  return {
    ...state,
    users: state.users.map((user) =>
      user.id === input.userId
        ? {
            ...user,
            minorMode: input.minorMode ?? user.minorMode,
            ttsEnabled: input.ttsEnabled ?? user.ttsEnabled
          }
        : user
    )
  };
}

export function markConversationRead(
  state: CompanionState,
  input: { conversationId: string; now: string }
): CompanionState {
  return {
    ...state,
    conversations: state.conversations.map((item) =>
      item.id === input.conversationId ? { ...item, lastReadAt: input.now } : item
    )
  };
}
