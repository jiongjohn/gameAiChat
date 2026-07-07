import { createInviteCode } from "@/server/companion-service";
import { companionStore } from "@/server/store";

export const dynamic = "force-dynamic";

export async function POST() {
  const now = new Date().toISOString();
  let code = "";
  const state = await companionStore.update((current) => {
    const result = createInviteCode(current, now);
    code = result.code;
    return result.state;
  });

  return Response.json({ code, inviteCodes: state.inviteCodes });
}
