import { redactStateForClient } from "@/server/admin-service";
import { beginMomentComment, finalizeMomentComment, resolveActiveUserId } from "@/server/companion-service";
import { createChatReply } from "@/server/model-provider";
import { companionStore } from "@/server/store";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ momentId: string }> }) {
  const { momentId } = await params;
  const body = (await request.json().catch(() => ({}))) as { content?: string };
  if (!body.content?.trim()) {
    return Response.json({ error: "content is required" }, { status: 400 });
  }

  const content = body.content.trim();
  const now = new Date().toISOString();

  try {
    const current = await companionStore.read();
    const userId = resolveActiveUserId(current);
    const start = beginMomentComment(current, { momentId, userId, content, now });

    if (!start.allowed) {
      const persisted = await companionStore.write(start.state);
      return Response.json({ state: redactStateForClient(persisted), allowed: false, reply: start.reply });
    }

    const modelResult = await createChatReply({
      settings: start.context.settings,
      character: start.context.character,
      userMessage: start.context.userComment.content,
      prompt: start.context.prompt,
      history: [],
      facts: [],
      affinityLevel: start.context.affinityLevel
    });

    let reply = "";
    const state = await companionStore.update((fresh) => {
      const finished = finalizeMomentComment(fresh, { context: start.context, modelResult, userId, now });
      reply = finished.reply;
      return finished.state;
    });

    return Response.json({ state: redactStateForClient(state), allowed: true, reply });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Unable to add comment." },
      { status: 400 }
    );
  }
}
