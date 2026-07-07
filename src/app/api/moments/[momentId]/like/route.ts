import { redactStateForClient } from "@/server/admin-service";
import { resolveActiveUserId, toggleMomentLike } from "@/server/companion-service";
import { companionStore } from "@/server/store";

export const dynamic = "force-dynamic";

export async function POST(_request: Request, { params }: { params: Promise<{ momentId: string }> }) {
  const { momentId } = await params;

  try {
    let liked = false;
    let likeCount = 0;
    const state = await companionStore.update((current) => {
      const result = toggleMomentLike(current, {
        momentId,
        userId: resolveActiveUserId(current),
        now: new Date().toISOString()
      });
      liked = result.liked;
      likeCount = result.likeCount;
      return result.state;
    });

    return Response.json({ state: redactStateForClient(state), liked, likeCount });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Unable to toggle like." },
      { status: 400 }
    );
  }
}
