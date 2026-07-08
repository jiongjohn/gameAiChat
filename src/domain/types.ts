export type MessageRole = "user" | "assistant" | "system";
export type MessageStatus = "generating" | "reviewing" | "completed" | "blocked" | "failed";
export type AffinityLevel = "初识" | "熟悉" | "心动" | "暧昧" | "热恋";
export type MomentStatus = "draft" | "approved" | "published" | "blocked";
export type CharacterVisibility = "public" | "hidden" | "restricted";

export interface UserProfile {
  id: string;
  username: string;
  passwordHash: string;
  passwordSalt: string;
  nickname: string;
  minorMode: boolean;
  ttsEnabled: boolean;
  createdAt: string;
}

export interface VisualIdentity {
  referenceImageKey?: string;
  appearancePrompt?: string;
  negativePrompt?: string;
  styleTags?: string[];
  chatImageEnabled?: boolean;
  chatImageMinAffinity?: AffinityLevel;
}

export interface CharacterCard {
  id: string;
  name: string;
  tagline: string;
  imageUrl?: string;
  personalityType?: string;
  modelId?: string;
  description: string;
  personality: string;
  scenario: string;
  firstMessage: string;
  messageExample: string;
  postHistoryInstructions: string;
  voiceId: string;
  avatarGradient: string;
  momentsPersona: string;
  affinityPrompts: Record<AffinityLevel, string>;
  characterBook: Array<{
    keywords: string[];
    content: string;
    priority: number;
  }>;
  visibility: CharacterVisibility;
  allowedUserIds?: string[];
  visualIdentity?: VisualIdentity;
}

export interface Conversation {
  id: string;
  userId: string;
  characterId: string;
  summary: string;
  summaryTurn: number;
  turnCount: number;
  lastActiveAt: string;
  lastReadAt?: string;
}

export interface Message {
  id: string;
  conversationId: string;
  role: MessageRole;
  content: string;
  status: MessageStatus;
  audioUrl?: string;
  imageUrl?: string;
  imagePrompt?: string;
  imageStatus?: "generating" | "completed" | "failed" | "blocked";
  createdAt: string;
}

export interface Fact {
  id: string;
  userId: string;
  characterId: string;
  content: string;
  factType: "birthday" | "nickname" | "preference" | "promise" | "milestone" | "note";
  source: "rule" | "llm";
  createdAt: string;
  supersededBy?: string;
}

export interface AffinityRecord {
  userId: string;
  characterId: string;
  score: number;
  level: AffinityLevel;
  updatedAt: string;
}

export interface Moment {
  id: string;
  characterId: string;
  userId: string;
  content: string;
  imageKey: string;
  imageUrl?: string;
  status: MomentStatus;
  publishAt: string;
  createdAt: string;
}

export interface MomentComment {
  id: string;
  momentId: string;
  author: "user" | "character";
  content: string;
  createdAt: string;
}

export interface MomentLike {
  userId: string;
  momentId: string;
  createdAt: string;
}

export interface ProactiveMessage {
  id: string;
  userId: string;
  characterId: string;
  content: string;
  status: "queued" | "sent" | "blocked";
  sentAt?: string;
  createdAt: string;
}

export interface AuditLog {
  id: string;
  scene: string;
  contentRef: string;
  providerResult: string;
  action: string;
  createdAt: string;
}

export interface InviteCode {
  code: string;
  createdAt: string;
  usedByUserId?: string;
  usedAt?: string;
}

export interface ModelSettings {
  provider: "dev" | "deepseek" | "doubao" | "glm" | "custom";
  model: string;
  baseUrl?: string;
  apiKey?: string;
  temperature: number;
  maxContextTokens: number;
  maxModelContextTokens?: number;
}

export interface ImageModelSettings {
  provider: "dev" | "openai" | "stepfun" | "volcano";
  model: string;
  i2iModel?: string;
  baseUrl?: string;
  apiKey?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  region?: string;
  size?: string;
  cfgScale?: number;
  steps?: number;
  textMode?: boolean;
}

export interface AppSettings {
  models: {
    chat: ModelSettings;
    image: ImageModelSettings;
    tts: ModelSettings;
  };
  /** @deprecated kept only while migrating old JSON state files */
  model: ModelSettings;
}

export interface CompanionState {
  users: UserProfile[];
  characters: CharacterCard[];
  settings: AppSettings;
  conversations: Conversation[];
  messages: Message[];
  facts: Fact[];
  affinity: AffinityRecord[];
  moments: Moment[];
  momentComments: MomentComment[];
  momentLikes: MomentLike[];
  proactiveMessages: ProactiveMessage[];
  auditLogs: AuditLog[];
  inviteCodes: InviteCode[];
}
