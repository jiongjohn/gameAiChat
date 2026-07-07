import { createDevReply } from "@/domain/agent";
import type { AffinityLevel, CharacterCard, Fact, Message, ModelSettings } from "@/domain/types";

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
const defaultTimeoutMs = 20_000;
const defaultMaxAttempts = 2;

export interface ChatProviderInput {
  settings: ModelSettings;
  character: CharacterCard;
  userMessage: string;
  prompt: string;
  history: Message[];
  facts: Fact[];
  affinityLevel: AffinityLevel;
  fetcher?: Fetcher;
  timeoutMs?: number;
  maxAttempts?: number;
}

export interface ChatProviderResult {
  reply: string;
  provider: ModelSettings["provider"];
  usedFallback: boolean;
  attempts: number;
  error?: string;
}

interface OpenAICompatibleResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
  error?: {
    message?: string;
  };
}

interface OpenAICompatibleStreamChunk {
  choices?: Array<{
    delta?: {
      content?: string;
    };
    message?: {
      content?: string;
    };
    finish_reason?: string | null;
  }>;
  error?: {
    message?: string;
  };
}

export function resolveChatCompletionsUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  if (/\/chat\/completions$/i.test(trimmed)) {
    return trimmed;
  }
  return `${trimmed}/chat/completions`;
}

function fallbackReply(input: ChatProviderInput, error?: string, attempts = 0): ChatProviderResult {
  return {
    reply: createDevReply({
      character: input.character,
      userMessage: input.userMessage,
      facts: input.facts,
      affinityLevel: input.affinityLevel
    }),
    provider: input.settings.provider,
    usedFallback: true,
    attempts,
    error
  };
}

function cleanError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return "Unknown model provider error";
}

async function fetchWithTimeout(fetcher: Fetcher, url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetcher(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function buildRequestBody(input: ChatProviderInput, stream: boolean): string {
  return JSON.stringify({
    model: input.settings.model,
    messages: [
      { role: "system", content: input.prompt },
      { role: "user", content: input.userMessage }
    ],
    temperature: input.settings.temperature,
    max_tokens: 1200,
    stream
  });
}

function requestHeaders(settings: ModelSettings): Record<string, string> {
  return {
    "Authorization": `Bearer ${settings.apiKey}`,
    "Content-Type": "application/json"
  };
}

export interface RawCompletionInput {
  settings: ModelSettings;
  systemPrompt: string;
  userPrompt: string;
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
  fetcher?: Fetcher;
}

export async function createRawCompletion(input: RawCompletionInput): Promise<{ content: string; error?: string }> {
  const { settings } = input;
  if (settings.provider === "dev" || !settings.baseUrl || !settings.apiKey) {
    return { content: "", error: "raw completion unavailable" };
  }

  const fetcher = input.fetcher ?? fetch;
  try {
    const response = await fetchWithTimeout(
      fetcher,
      resolveChatCompletionsUrl(settings.baseUrl),
      {
        method: "POST",
        headers: requestHeaders(settings),
        body: JSON.stringify({
          model: settings.model,
          messages: [
            { role: "system", content: input.systemPrompt },
            { role: "user", content: input.userPrompt }
          ],
          temperature: input.temperature ?? 0.2,
          max_tokens: input.maxTokens ?? 400,
          stream: false
        })
      },
      input.timeoutMs ?? 8_000
    );
    const payload = (await response.json().catch(() => ({}))) as OpenAICompatibleResponse;
    if (!response.ok) {
      return { content: "", error: payload.error?.message ?? `Model HTTP ${response.status}` };
    }
    return { content: payload.choices?.[0]?.message?.content?.trim() ?? "" };
  } catch (error) {
    return { content: "", error: cleanError(error) };
  }
}

async function callOpenAICompatibleChat(input: ChatProviderInput, attempt: number): Promise<ChatProviderResult> {
  const { settings } = input;
  if (!settings.baseUrl || !settings.apiKey) {
    return fallbackReply(input, "Model baseUrl or apiKey is missing.", attempt);
  }

  const fetcher = input.fetcher ?? fetch;
  const response = await fetchWithTimeout(fetcher, resolveChatCompletionsUrl(settings.baseUrl), {
    method: "POST",
    headers: requestHeaders(settings),
    body: buildRequestBody(input, false)
  }, input.timeoutMs ?? defaultTimeoutMs);

  const payload = (await response.json().catch(() => ({}))) as OpenAICompatibleResponse;
  if (!response.ok) {
    return {
      reply: "",
      provider: settings.provider,
      usedFallback: false,
      attempts: attempt,
      error: payload.error?.message ?? `Model HTTP ${response.status}`
    };
  }

  const reply = payload.choices?.[0]?.message?.content?.trim();
  if (!reply) {
    return {
      reply: "",
      provider: settings.provider,
      usedFallback: false,
      attempts: attempt,
      error: "Model response did not include assistant content."
    };
  }

  return {
    reply,
    provider: settings.provider,
    usedFallback: false,
    attempts: attempt
  };
}

export async function createChatReply(input: ChatProviderInput): Promise<ChatProviderResult> {
  if (input.settings.provider === "dev") {
    return fallbackReply(input);
  }

  const maxAttempts = Math.max(1, input.maxAttempts ?? defaultMaxAttempts);
  let lastError = "";
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const result = await callOpenAICompatibleChat(input, attempt);
      if (!result.error) {
        return result;
      }
      lastError = result.error;
    } catch (error) {
      lastError = cleanError(error);
    }
  }

  return fallbackReply(input, lastError, maxAttempts);
}

function chunkText(text: string, size = 6): string[] {
  const chunks: string[] = [];
  const segments = [...text];
  for (let index = 0; index < segments.length; index += size) {
    chunks.push(segments.slice(index, index + size).join(""));
  }
  return chunks;
}

function parseStreamData(data: string): { delta?: string; error?: string } | null {
  if (data === "[DONE]") {
    return null;
  }
  let chunk: OpenAICompatibleStreamChunk;
  try {
    chunk = JSON.parse(data) as OpenAICompatibleStreamChunk;
  } catch {
    return null;
  }
  if (chunk.error?.message) {
    return { error: chunk.error.message };
  }
  const choice = chunk.choices?.[0];
  const delta = choice?.delta?.content ?? choice?.message?.content;
  if (typeof delta === "string" && delta.length > 0) {
    return { delta };
  }
  return null;
}

async function* streamOpenAICompatibleChat(
  input: ChatProviderInput,
  attempt: number
): AsyncGenerator<string, ChatProviderResult, void> {
  const { settings } = input;
  if (!settings.baseUrl || !settings.apiKey) {
    return { reply: "", provider: settings.provider, usedFallback: false, attempts: attempt, error: "Model baseUrl or apiKey is missing." };
  }

  const fetcher = input.fetcher ?? fetch;
  const response = await fetchWithTimeout(
    fetcher,
    resolveChatCompletionsUrl(settings.baseUrl),
    { method: "POST", headers: requestHeaders(settings), body: buildRequestBody(input, true) },
    input.timeoutMs ?? defaultTimeoutMs
  );

  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as OpenAICompatibleResponse;
    return {
      reply: "",
      provider: settings.provider,
      usedFallback: false,
      attempts: attempt,
      error: payload.error?.message ?? `Model HTTP ${response.status}`
    };
  }

  if (!response.body) {
    return { reply: "", provider: settings.provider, usedFallback: false, attempts: attempt, error: "Model stream had no response body." };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";
  let streamError: string | undefined;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split("\n\n");
      buffer = events.pop() ?? "";
      for (const event of events) {
        for (const line of event.split("\n")) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) {
            continue;
          }
          const parsed = parseStreamData(trimmed.slice(5).trim());
          if (!parsed) {
            continue;
          }
          if (parsed.error) {
            streamError = parsed.error;
            continue;
          }
          if (parsed.delta) {
            full += parsed.delta;
            yield parsed.delta;
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  const reply = full.trim();
  if (streamError && !reply) {
    return { reply: "", provider: settings.provider, usedFallback: false, attempts: attempt, error: streamError };
  }
  if (!reply) {
    return { reply: "", provider: settings.provider, usedFallback: false, attempts: attempt, error: "Model stream did not include assistant content." };
  }
  return { reply, provider: settings.provider, usedFallback: false, attempts: attempt };
}

export async function* streamChatReply(
  input: ChatProviderInput
): AsyncGenerator<string, ChatProviderResult, void> {
  if (input.settings.provider !== "dev") {
    const maxAttempts = Math.max(1, input.maxAttempts ?? defaultMaxAttempts);
    let lastError = "";
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const result = yield* streamOpenAICompatibleChat(input, attempt);
        if (!result.error) {
          return result;
        }
        lastError = result.error;
      } catch (error) {
        lastError = cleanError(error);
      }
    }
    const fallback = fallbackReply(input, lastError, maxAttempts);
    for (const chunk of chunkText(fallback.reply)) {
      yield chunk;
    }
    return fallback;
  }

  const fallback = fallbackReply(input);
  for (const chunk of chunkText(fallback.reply)) {
    yield chunk;
  }
  return fallback;
}
