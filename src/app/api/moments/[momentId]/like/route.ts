import { redactStateForClient } from "@/server/admin-service";
import { scopeStateForUser, toggleMomentLike } from "@/server/companion-service";
import { getSessionUserId } from "@/server/session";
import { companionStore } from "@/server/store";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ momentId: string }> }) {
  const userId = getSessionUserId(request);
  if (!userId) {
    return Response.json({ error: "未登录。" }, { status: 401 });
  }
  const { momentId } = await params;

  try {
    let liked = false;
    let likeCount = 0;
    const state = await companionStore.update((current) => {
      const result = toggleMomentLike(current, {
        momentId,
        userId,
        now: new Date().toISOString()
      });
      liked = result.liked;
      likeCount = result.likeCount;
      return result.state;
    });

    return Response.json({ state: redactStateForClient(scopeStateForUser(state, userId)), liked, likeCount });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Unable to toggle like." },
      { status: 400 }
    );
  }
}
