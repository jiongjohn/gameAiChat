import { buildPrompt } from "@/domain/agent";
import type { AppSettings, ModelSettings } from "@/domain/types";
import { updateModelSettings, validateAdminSettingsPatch } from "@/server/admin-service";
import { createChatReply, resolveChatCompletionsUrl } from "@/server/model-provider";
import { companionStore } from "@/server/store";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const patch = validateAdminSettingsPatch(await request.json());
    if (!patch.model) {
      return Response.json({ ok: false, error: "model settings are required" }, { status: 400 });
    }

    const target: keyof AppSettings["models"] = patch.modelTarget ?? "chat";
    if (target !== "chat") {
      return Response.json({
        ok: false,
        target,
        error: "当前只支持测试聊天模型，图片和 TTS provider 会在对应功能接入时开放。"
      });
    }

    const current = await companionStore.read();
    const stateForTest = updateModelSettings(current, patch.model as Partial<ModelSettings>, target);
    const settings = stateForTest.settings.models.chat;
    const character = stateForTest.characters[0];
    const prompt = buildPrompt({
      character,
      affinityLevel: "初识",
      facts: [],
      summary: "",
      history: [],
      userMessage: "请用角色口吻回复一句简短问候。"
    });
    const result = await createChatReply({
      settings,
      character,
      userMessage: "请用角色口吻回复一句简短问候。",
      prompt,
      history: [],
      facts: [],
      affinityLevel: "初识",
      timeoutMs: 12_000,
      maxAttempts: 1
    });

    return Response.json({
      ok: !result.error,
      target,
      provider: settings.provider,
      model: settings.model,
      endpoint: settings.baseUrl ? resolveChatCompletionsUrl(settings.baseUrl) : undefined,
      attempts: result.attempts,
      usedFallback: result.usedFallback,
      reply: result.reply,
      error: result.error
    });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "Unknown model test error" }, { status: 400 });
  }
}
