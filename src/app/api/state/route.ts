import { redactStateForClient } from "@/server/admin-service";
import { companionStore } from "@/server/store";

export const dynamic = "force-dynamic";

export async function GET() {
  const state = await companionStore.read();
  return Response.json(redactStateForClient(state));
}
