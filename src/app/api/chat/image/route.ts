import { redactStateForClient } from "@/server/admin-service";
import { patchMessageImage, runImageGenerationForMessage, scopeStateForUser } from "@/server/companion-service";
import { getSessionUserId } from "@/server/session";
import { companionStore } from "@/server/store";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const userId = getSessionUserId(request);
  if (!userId) {
    return Response.json({ error: "未登录。" }, { status: 401 });
  }
  const body = (await request.json().catch(() => ({}))) as { conversationId?: string; messageId?: string };
  if (!body.conversationId || !body.messageId) {
    return Response.json({ error: "conversationId and messageId are required" }, { status: 400 });
  }

  const conversationId = body.conversationId;
  const messageId = body.messageId;

  const snapshot = await companionStore.read();
  const conversation = snapshot.conversations.find((item) => item.id === conversationId);
  if (!conversation || conversation.userId !== userId) {
    return Response.json({ error: "无权访问该会话。" }, { status: 403 });
  }

  const outcome = await runImageGenerationForMessage(snapshot, { conversationId, messageId, userId });

  const persisted = await companionStore.update((fresh) => patchMessageImage(fresh, messageId, outcome));

  return Response.json({
    messageId,
    imageStatus: outcome.imageStatus,
    imageUrl: outcome.imageUrl,
    state: redactStateForClient(scopeStateForUser(persisted, userId))
  });
}
