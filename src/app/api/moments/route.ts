import { redactStateForClient } from "@/server/admin-service";
import { createMomentForUser, scopeStateForUser } from "@/server/companion-service";
import { getSessionUserId } from "@/server/session";
import { companionStore } from "@/server/store";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const userId = getSessionUserId(request);
  if (!userId) {
    return Response.json({ error: "未登录。" }, { status: 401 });
  }
  const body = (await request.json().catch(() => ({}))) as { characterId?: string };
  if (!body.characterId) {
    return Response.json({ error: "characterId is required" }, { status: 400 });
  }

  const state = await companionStore.update((current) =>
    createMomentForUser(current, {
      userId,
      characterId: body.characterId!,
      now: new Date().toISOString()
    })
  );

  return Response.json(redactStateForClient(scopeStateForUser(state, userId)));
}
