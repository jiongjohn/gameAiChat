import {
  redactStateForClient,
  updateCharacterConfig,
  updateModelSettings,
  validateAdminSettingsPatch
} from "@/server/admin-service";
import { companionStore } from "@/server/store";

export const dynamic = "force-dynamic";

function badRequest(message: string) {
  return Response.json({ error: message }, { status: 400 });
}

export async function GET() {
  const state = await companionStore.read();
  return Response.json(redactStateForClient(state));
}

export async function PATCH(request: Request) {
  let body: ReturnType<typeof validateAdminSettingsPatch>;
  try {
    body = validateAdminSettingsPatch(await request.json());
  } catch (error) {
    return badRequest(error instanceof Error ? error.message : "Invalid request body.");
  }

  try {
    const state = await companionStore.update((current) => {
      let next = current;
      if (body.character) {
        next = updateCharacterConfig(next, body.character);
      }
    if (body.model) {
        next = updateModelSettings(next, body.model, body.modelTarget);
    }
      return next;
    });

    return Response.json(redactStateForClient(state));
  } catch (error) {
    return badRequest(error instanceof Error ? error.message : "Unable to update settings.");
  }
}
