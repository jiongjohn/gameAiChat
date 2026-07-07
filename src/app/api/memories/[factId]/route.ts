import { redactStateForClient } from "@/server/admin-service";
import { deleteFact, scopeStateForUser } from "@/server/companion-service";
import { getSessionUserId } from "@/server/session";
import { companionStore } from "@/server/store";

export const dynamic = "force-dynamic";

export async function DELETE(request: Request, { params }: { params: Promise<{ factId: string }> }) {
  const userId = getSessionUserId(request);
  if (!userId) {
    return Response.json({ error: "未登录。" }, { status: 401 });
  }
  const { factId } = await params;
  if (!factId) {
    return Response.json({ error: "factId is required" }, { status: 400 });
  }

  const current = await companionStore.read();
  const fact = current.facts.find((item) => item.id === factId);
  if (!fact || fact.userId !== userId) {
    return Response.json({ error: "无权删除该记忆。" }, { status: 403 });
  }

  const state = await companionStore.update((fresh) => deleteFact(fresh, factId));
  return Response.json({ state: redactStateForClient(scopeStateForUser(state, userId)) });
}
