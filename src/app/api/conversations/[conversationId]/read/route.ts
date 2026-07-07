import { redactStateForClient } from "@/server/admin-service";
import { markConversationRead } from "@/server/companion-service";
import { companionStore } from "@/server/store";

export const dynamic = "force-dynamic";

export async function POST(_request: Request, { params }: { params: Promise<{ conversationId: string }> }) {
  const { conversationId } = await params;
  if (!conversationId) {
    return Response.json({ error: "conversationId is required" }, { status: 400 });
  }

  const state = await companionStore.update((current) =>
    markConversationRead(current, { conversationId, now: new Date().toISOString() })
  );

  return Response.json({ state: redactStateForClient(state) });
}
