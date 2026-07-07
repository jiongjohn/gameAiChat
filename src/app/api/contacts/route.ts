import { redactStateForClient } from "@/server/admin-service";
import { activateCharacterForUser, resolveActiveUserId } from "@/server/companion-service";
import { companionStore } from "@/server/store";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { characterId?: string };
  if (!body.characterId) {
    return Response.json({ error: "characterId is required" }, { status: 400 });
  }

  const characterId = body.characterId;
  const now = new Date().toISOString();

  try {
    let conversationId = "";
    let alreadyActive = false;
    const state = await companionStore.update((current) => {
      const result = activateCharacterForUser(current, {
        userId: resolveActiveUserId(current),
        characterId,
        now
      });
      conversationId = result.conversationId;
      alreadyActive = result.alreadyActive;
      return result.state;
    });

    return Response.json({ state: redactStateForClient(state), conversationId, alreadyActive });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Unable to add contact." },
      { status: 400 }
    );
  }
}
