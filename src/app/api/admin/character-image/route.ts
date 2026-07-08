import { moderateInput } from "@/domain/safety";
import { saveAsset, saveDataUrlAsset } from "@/server/asset-store";
import { resolveImageProvider } from "@/server/image-provider";
import { companionStore } from "@/server/store";

export const dynamic = "force-dynamic";

interface CharacterImageBody {
  mode?: "upload" | "generate";
  dataUrl?: string;
  characterId?: string;
  appearancePrompt?: string;
  negativePrompt?: string;
  styleTags?: string[];
}

function buildGenerationPrompt(body: CharacterImageBody): string {
  const appearance = body.appearancePrompt?.trim() ?? "";
  const style = body.styleTags?.length ? `，${body.styleTags.join("、")}` : "";
  return `角色头像立绘，${appearance}${style}，单人特写，柔和布光，写实风格`;
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as CharacterImageBody;

  if (body.mode === "upload") {
    if (!body.dataUrl) {
      return Response.json({ error: "缺少图片数据。" }, { status: 400 });
    }
    const result = await saveDataUrlAsset(body.dataUrl);
    if ("error" in result) {
      return Response.json({ error: result.error }, { status: 400 });
    }
    return Response.json({ key: result.key, imageUrl: `/api/assets/${result.key}` });
  }

  if (body.mode === "generate") {
    const appearance = body.appearancePrompt?.trim();
    if (!appearance) {
      return Response.json({ error: "请先填写形象描述，再生成图片。" }, { status: 400 });
    }
    const moderation = moderateInput(appearance);
    if (!moderation.allowed) {
      return Response.json({ error: "形象描述未通过内容审核。" }, { status: 400 });
    }

    const state = await companionStore.read();
    const provider = resolveImageProvider(state.settings.models.image);
    const generated = await provider.generate({
      prompt: buildGenerationPrompt(body),
      negativePrompt: body.negativePrompt?.trim() || undefined
    });
    if (generated.status !== "completed") {
      return Response.json({ error: generated.error || "图片生成失败。" }, { status: 502 });
    }
    const key = await saveAsset(generated.image.data, generated.image.mime);
    return Response.json({ key, imageUrl: `/api/assets/${key}` });
  }

  return Response.json({ error: "mode 必须为 upload 或 generate。" }, { status: 400 });
}
