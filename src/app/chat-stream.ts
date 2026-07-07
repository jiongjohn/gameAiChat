import type { CompanionState, Message } from "@/domain/types";

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface ChatStreamHandlers {
  onUser?: (message: Message) => void;
  onAssistantStart?: (messageId: string) => void;
  onToken?: (delta: string) => void;
  onAssistantComplete?: (reply: string) => void;
  onBlocked?: (reply: string) => void;
  onState?: (state: CompanionState) => void;
  onError?: (message: string) => void;
}

type ChatStreamEvent =
  | { type: "user"; message: Message }
  | { type: "assistant-start"; messageId: string }
  | { type: "token"; delta: string }
  | { type: "assistant-complete"; reply: string }
  | { type: "blocked"; reply: string }
  | { type: "state"; state: CompanionState }
  | { type: "error"; message: string }
  | { type: "done" };

function dispatch(event: ChatStreamEvent, handlers: ChatStreamHandlers) {
  switch (event.type) {
    case "user":
      handlers.onUser?.(event.message);
      break;
    case "assistant-start":
      handlers.onAssistantStart?.(event.messageId);
      break;
    case "token":
      handlers.onToken?.(event.delta);
      break;
    case "assistant-complete":
      handlers.onAssistantComplete?.(event.reply);
      break;
    case "blocked":
      handlers.onBlocked?.(event.reply);
      break;
    case "state":
      handlers.onState?.(event.state);
      break;
    case "error":
      handlers.onError?.(event.message);
      break;
    case "done":
      break;
  }
}

export async function streamChatMessage(
  input: { conversationId: string; content: string },
  handlers: ChatStreamHandlers,
  fetcher: Fetcher = fetch
): Promise<void> {
  let response: Response;
  try {
    response = await fetcher("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify({ conversationId: input.conversationId, content: input.content })
    });
  } catch {
    handlers.onError?.("连接角色频道失败，请确认网络后重试。");
    return;
  }

  if (!response.ok || !response.body) {
    handlers.onError?.(`角色频道异常：HTTP ${response.status}`);
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";
    for (const frame of frames) {
      const line = frame.split("\n").find((entry) => entry.startsWith("data:"));
      if (!line) {
        continue;
      }
      const raw = line.slice(5).trim();
      if (!raw) {
        continue;
      }
      try {
        dispatch(JSON.parse(raw) as ChatStreamEvent, handlers);
      } catch {
        handlers.onError?.("收到无法解析的角色频道数据。");
      }
    }
  }
}
