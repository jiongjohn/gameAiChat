import { redactStateForClient } from "@/server/admin-service";
import { createMomentForUser, resolveActiveUserId } from "@/server/companion-service";
import { companionStore } from "@/server/store";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { characterId?: string };
  if (!body.characterId) {
    return Response.json({ error: "characterId is required" }, { status: 400 });
  }

  const state = await companionStore.update((current) =>
    createMomentForUser(current, {
      userId: resolveActiveUserId(current),
      characterId: body.characterId!,
      now: new Date().toISOString()
    })
  );

  return Response.json(redactStateForClient(state));
}
