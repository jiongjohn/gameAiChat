import { redactStateForClient } from "@/server/admin-service";
import { markConversationRead, scopeStateForUser } from "@/server/companion-service";
import { getSessionUserId } from "@/server/session";
import { companionStore } from "@/server/store";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ conversationId: string }> }) {
  const userId = getSessionUserId(request);
  if (!userId) {
    return Response.json({ error: "未登录。" }, { status: 401 });
  }
  const { conversationId } = await params;
  if (!conversationId) {
    return Response.json({ error: "conversationId is required" }, { status: 400 });
  }

  const current = await companionStore.read();
  const conversation = current.conversations.find((item) => item.id === conversationId);
  if (!conversation || conversation.userId !== userId) {
    return Response.json({ error: "无权访问该会话。" }, { status: 403 });
  }

  const state = await companionStore.update((fresh) =>
    markConversationRead(fresh, { conversationId, now: new Date().toISOString() })
  );

  return Response.json({ state: redactStateForClient(scopeStateForUser(state, userId)) });
}
