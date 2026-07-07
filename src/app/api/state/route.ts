import { redactStateForClient } from "@/server/admin-service";
import { scopeStateForUser } from "@/server/companion-service";
import { getSessionUserId } from "@/server/session";
import { companionStore } from "@/server/store";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const userId = getSessionUserId(request);
  if (!userId) {
    return Response.json({ error: "未登录。" }, { status: 401 });
  }
  const state = await companionStore.read();
  if (!state.users.some((user) => user.id === userId)) {
    return Response.json({ error: "未登录。" }, { status: 401 });
  }
  return Response.json(redactStateForClient(scopeStateForUser(state, userId)));
}
