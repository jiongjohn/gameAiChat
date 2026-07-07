import { maskUnsafeOutput } from "@/domain/safety";
import { redactStateForClient } from "@/server/admin-service";
import { beginChatTurn, enrichChatTurnMemory, finalizeChatTurn, handleChatTurn, scopeStateForUser } from "@/server/companion-service";
import { streamChatReply } from "@/server/model-provider";
import { getSessionUserId } from "@/server/session";
import { companionStore } from "@/server/store";

export const dynamic = "force-dynamic";

function sse(payload: unknown): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(payload)}\n\n`);
}

const sentenceBoundary = /(?<=[。！？!?\n])/;

function splitSafeSentences(buffer: string, minorMode: boolean): { emit: string; rest: string } {
  const lastBoundary = buffer.search(/[。！？!?\n][^。！？!?\n]*$/);
  const cut = lastBoundary === -1 ? -1 : lastBoundary + 1;
  if (cut <= 0) {
    return { emit: "", rest: buffer };
  }
  const complete = buffer.slice(0, cut);
  const rest = buffer.slice(cut);
  const emit = complete
    .split(sentenceBoundary)
    .filter((part) => part.length > 0)
    .map((sentence) => maskUnsafeOutput(sentence, { minorMode }))
    .join("");
  return { emit, rest };
}

export async function POST(request: Request) {
  const userId = getSessionUserId(request);
  if (!userId) {
    return Response.json({ error: "未登录。" }, { status: 401 });
  }
  const body = (await request.json()) as { conversationId?: string; content?: string };
  if (!body.conversationId || !body.content?.trim()) {
    return Response.json({ error: "conversationId and content are required" }, { status: 400 });
  }

  const conversationId = body.conversationId;
  const content = body.content.trim();
  const wantsStream = request.headers.get("accept")?.includes("text/event-stream");

  const ownershipSnapshot = await companionStore.read();
  const ownedConversation = ownershipSnapshot.conversations.find((item) => item.id === conversationId);
  if (!ownedConversation || ownedConversation.userId !== userId) {
    return Response.json({ error: "无权访问该会话。" }, { status: 403 });
  }

  if (!wantsStream) {
    const state = await companionStore.update(async (current) => {
      const next = await handleChatTurn(current, { conversationId, content, now: new Date().toISOString() });
      return next.state;
    });
    const latest = state.messages.filter((message) => message.conversationId === conversationId).slice(-2).reverse();
    return Response.json({
      state: redactStateForClient(scopeStateForUser(state, userId)),
      reply: latest.find((message) => message.role === "assistant")?.content,
      blocked: latest.find((message) => message.status === "blocked" && message.role === "user")?.content
    });
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        const now = new Date().toISOString();
        const snapshot = await companionStore.read();
        const start = beginChatTurn(snapshot, { conversationId, content, now });

        if (!start.allowed) {
          const persisted = await companionStore.update((fresh) => {
            const blocked = beginChatTurn(fresh, { conversationId, content, now });
            return blocked.state;
          });
          controller.enqueue(sse({ type: "user", message: start.userMessage }));
          controller.enqueue(sse({ type: "blocked", reply: start.reply }));
          controller.enqueue(sse({ type: "state", state: redactStateForClient(scopeStateForUser(persisted, userId)) }));
          controller.enqueue(sse({ type: "done" }));
          controller.close();
          return;
        }

        controller.enqueue(sse({ type: "user", message: start.userMessage }));
        controller.enqueue(sse({ type: "assistant-start", messageId: start.assistantMessageId }));

        const iterator = streamChatReply({
          settings: start.settings,
          character: start.character,
          userMessage: content,
          prompt: start.prompt,
          history: start.history,
          facts: start.relevantFacts,
          affinityLevel: start.affinityLevel
        });

        let pending = "";
        let step = await iterator.next();
        while (!step.done) {
          pending += step.value;
          const { emit, rest } = splitSafeSentences(pending, start.minorMode);
          pending = rest;
          if (emit.length > 0) {
            controller.enqueue(sse({ type: "token", delta: emit }));
          }
          step = await iterator.next();
        }
        const modelResult = step.value;
        if (pending.length > 0) {
          const tail = maskUnsafeOutput(pending, { minorMode: start.minorMode });
          if (tail.length > 0) {
            controller.enqueue(sse({ type: "token", delta: tail }));
          }
        }

        let reply = "";
        const persisted = await companionStore.update(async (fresh) => {
          const finished = finalizeChatTurn(start, { modelResult, now, baseState: fresh });
          reply = finished.reply;
          return enrichChatTurnMemory(finished.state, {
            conversationId,
            userMessage: content,
            assistantReply: finished.reply,
            now
          });
        });
        controller.enqueue(sse({ type: "assistant-complete", reply }));

        controller.enqueue(sse({ type: "state", state: redactStateForClient(scopeStateForUser(persisted, userId)) }));
        controller.enqueue(sse({ type: "done" }));
        controller.close();
      } catch (error) {
        controller.enqueue(
          sse({ type: "error", message: error instanceof Error ? error.message : "聊天生成失败，请稍后再试。" })
        );
        controller.enqueue(sse({ type: "done" }));
        controller.close();
      }
    }
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store",
      "Connection": "keep-alive",
      "X-Content-Type-Options": "nosniff"
    }
  });
}
