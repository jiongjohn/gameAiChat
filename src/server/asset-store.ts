import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const mimeExtensions: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/svg+xml": "svg",
  "image/gif": "gif"
};

const extensionMimes: Record<string, string> = Object.fromEntries(
  Object.entries(mimeExtensions).map(([mime, ext]) => [ext, mime])
);

function assetsDir(): string {
  return process.env.AI_CHAT_ASSETS_PATH ?? join(process.cwd(), ".data", "assets");
}

function extensionForMime(mime: string): string {
  return mimeExtensions[mime] ?? "png";
}

export function mimeForAssetKey(key: string): string {
  const ext = key.split(".").pop()?.toLowerCase() ?? "";
  return extensionMimes[ext] ?? "application/octet-stream";
}

function isSafeAssetKey(key: string): boolean {
  return /^[a-f0-9]{16,64}\.[a-z0-9]{1,5}$/i.test(key);
}

export async function saveAsset(bytes: Buffer, mime: string): Promise<string> {
  const dir = assetsDir();
  await mkdir(dir, { recursive: true });
  const digest = createHash("sha256").update(bytes).digest("hex").slice(0, 32);
  const key = `${digest}${randomBytes(4).toString("hex")}.${extensionForMime(mime)}`;
  await writeFile(join(dir, key), bytes);
  return key;
}

const maxUploadBytes = 5 * 1024 * 1024;

export async function saveDataUrlAsset(dataUrl: string): Promise<{ key: string } | { error: string }> {
  const match = /^data:([a-z]+\/[a-z0-9.+-]+);base64,(.+)$/i.exec(dataUrl.trim());
  if (!match) {
    return { error: "仅支持 base64 data URL 格式的图片。" };
  }
  const [, mime, base64] = match;
  if (!(mime in mimeExtensions)) {
    return { error: `不支持的图片类型：${mime}` };
  }
  const bytes = Buffer.from(base64, "base64");
  if (bytes.length === 0) {
    return { error: "图片内容为空。" };
  }
  if (bytes.length > maxUploadBytes) {
    return { error: "图片超过 5MB 上限。" };
  }
  const key = await saveAsset(bytes, mime);
  return { key };
}

export async function readAsset(key: string): Promise<{ bytes: Buffer; mime: string } | null> {
  if (!isSafeAssetKey(key)) {
    return null;
  }
  try {
    const bytes = await readFile(join(assetsDir(), key));
    return { bytes, mime: mimeForAssetKey(key) };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}
