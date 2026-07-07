import { redactStateForClient } from "@/server/admin-service";
import { resolveActiveUserId, updateUserFlags } from "@/server/companion-service";
import { companionStore } from "@/server/store";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    minorMode?: boolean;
    ttsEnabled?: boolean;
  };

  const state = await companionStore.update((current) =>
    updateUserFlags(current, {
      userId: resolveActiveUserId(current),
      minorMode: body.minorMode,
      ttsEnabled: body.ttsEnabled
    })
  );

  return Response.json({ state: redactStateForClient(state) });
}
