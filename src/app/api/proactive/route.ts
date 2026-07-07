import { redactStateForClient } from "@/server/admin-service";
import { resolveActiveUserId, runProactiveForUser } from "@/server/companion-service";
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
    let sent = 0;
    let blocked = 0;
    let skipped = false;
    const state = await companionStore.update(async (current) => {
      const userId = resolveActiveUserId(current);
      const result = await runProactiveForUser(current, { userId, characterId, now });
      sent = result.sent;
      blocked = result.blocked;
      skipped = result.skipped;
      return result.state;
    });

    return Response.json({ state: redactStateForClient(state), sent, blocked, skipped });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Unable to run proactive message." },
      { status: 400 }
    );
  }
}
