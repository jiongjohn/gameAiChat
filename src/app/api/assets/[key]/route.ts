import { readAsset } from "@/server/asset-store";
import { getSessionUserId } from "@/server/session";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ key: string }> }) {
  const userId = getSessionUserId(request);
  if (!userId) {
    return new Response("Unauthorized", { status: 401 });
  }
  const { key } = await params;
  const asset = await readAsset(key);
  if (!asset) {
    return new Response("Not found", { status: 404 });
  }
  return new Response(new Uint8Array(asset.bytes), {
    headers: {
      "Content-Type": asset.mime,
      "Cache-Control": "private, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff"
    }
  });
}
