import { redactStateForClient } from "@/server/admin-service";
import { deleteFact } from "@/server/companion-service";
import { companionStore } from "@/server/store";

export const dynamic = "force-dynamic";

export async function DELETE(_request: Request, { params }: { params: Promise<{ factId: string }> }) {
  const { factId } = await params;
  if (!factId) {
    return Response.json({ error: "factId is required" }, { status: 400 });
  }

  const state = await companionStore.update((current) => deleteFact(current, factId));
  return Response.json({ state: redactStateForClient(state) });
}
