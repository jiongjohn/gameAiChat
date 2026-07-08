import type { ImageModelSettings } from "@/domain/types";

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const defaultImageTimeoutMs = 30_000;

export type ImageInput = { kind: "url"; url: string } | { kind: "base64"; data: string; mime: string };
export type ImageBytes = { data: Buffer; mime: string };

export interface GenerateImageRequest {
  prompt: string;
  referenceImage?: ImageInput;
  negativePrompt?: string;
  size?: string;
  seed?: number;
}

export type ImageResult =
  | { status: "completed"; image: ImageBytes; revisedPrompt?: string }
  | { status: "failed"; error: string };

export interface GenerateImageOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  fetcher?: Fetcher;
}

export interface ImageProvider {
  generate(req: GenerateImageRequest, opts?: GenerateImageOptions): Promise<ImageResult>;
}

function hashString(input: string): number {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

class DevImageProvider implements ImageProvider {
  async generate(req: GenerateImageRequest): Promise<ImageResult> {
    const seed = hashString(`${req.prompt}|${req.referenceImage?.kind ?? "none"}`);
    const hue = seed % 360;
    const alt = (seed >> 3) % 360;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="768" height="576"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue} 55% 42%)"/><stop offset="1" stop-color="hsl(${alt} 60% 58%)"/></linearGradient></defs><rect width="768" height="576" fill="url(#g)"/></svg>`;
    return { status: "completed", image: { data: Buffer.from(svg, "utf8"), mime: "image/svg+xml" }, revisedPrompt: req.prompt };
  }
}

async function withTimeout(
  fetcher: Fetcher,
  url: string,
  init: RequestInit,
  timeoutMs: number,
  signal?: AbortSignal
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort();
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    return await fetcher(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

interface OpenAIImageResponse {
  data?: Array<{ b64_json?: string; url?: string; revised_prompt?: string }>;
  error?: { message?: string };
}

function resolveOpenAIUrl(baseUrl: string, path: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  if (new RegExp(`${path.replace(/\//g, "\\/")}$`, "i").test(trimmed)) {
    return trimmed;
  }
  return `${trimmed}${path}`;
}

async function decodeOpenAIImage(payload: OpenAIImageResponse, fetcher: Fetcher): Promise<ImageResult> {
  const entry = payload.data?.[0];
  if (entry?.b64_json) {
    return {
      status: "completed",
      image: { data: Buffer.from(entry.b64_json, "base64"), mime: "image/png" },
      revisedPrompt: entry.revised_prompt
    };
  }
  if (entry?.url) {
    const response = await fetcher(entry.url, {});
    if (!response.ok) {
      return { status: "failed", error: `Fetching generated image failed: HTTP ${response.status}` };
    }
    const mime = response.headers.get("content-type") ?? "image/png";
    const bytes = Buffer.from(await response.arrayBuffer());
    return { status: "completed", image: { data: bytes, mime }, revisedPrompt: entry.revised_prompt };
  }
  return { status: "failed", error: "Image provider returned no image data." };
}

class OpenAIImageProvider implements ImageProvider {
  constructor(private readonly settings: ImageModelSettings) {}

  async generate(req: GenerateImageRequest, opts: GenerateImageOptions = {}): Promise<ImageResult> {
    const { settings } = this;
    if (!settings.baseUrl || !settings.apiKey) {
      return { status: "failed", error: "Image provider baseUrl or apiKey is missing." };
    }
    const fetcher = opts.fetcher ?? fetch;
    const timeoutMs = opts.timeoutMs ?? defaultImageTimeoutMs;
    const size = req.size ?? settings.size ?? "1024x1024";

    try {
      if (req.referenceImage) {
        return await this.edit(req, { fetcher, timeoutMs, signal: opts.signal, size });
      }
      return await this.create(req, { fetcher, timeoutMs, signal: opts.signal, size });
    } catch (error) {
      return { status: "failed", error: error instanceof Error ? error.message : "Image generation failed." };
    }
  }

  private async create(
    req: GenerateImageRequest,
    ctx: { fetcher: Fetcher; timeoutMs: number; signal?: AbortSignal; size: string }
  ): Promise<ImageResult> {
    const url = resolveOpenAIUrl(this.settings.baseUrl!, "/images/generations");
    const response = await withTimeout(
      ctx.fetcher,
      url,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${this.settings.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: this.settings.model,
          prompt: req.prompt,
          size: ctx.size,
          n: 1,
          response_format: "b64_json"
        })
      },
      ctx.timeoutMs,
      ctx.signal
    );
    const payload = (await response.json().catch(() => ({}))) as OpenAIImageResponse;
    if (!response.ok) {
      return { status: "failed", error: payload.error?.message ?? `Image HTTP ${response.status}` };
    }
    return decodeOpenAIImage(payload, ctx.fetcher);
  }

  private async edit(
    req: GenerateImageRequest,
    ctx: { fetcher: Fetcher; timeoutMs: number; signal?: AbortSignal; size: string }
  ): Promise<ImageResult> {
    const reference = await loadImageInput(req.referenceImage!, ctx.fetcher);
    if (!reference) {
      return { status: "failed", error: "Reference image could not be loaded for img2img." };
    }
    const url = resolveOpenAIUrl(this.settings.baseUrl!, "/images/edits");
    const form = new FormData();
    form.append("model", this.settings.i2iModel ?? this.settings.model);
    form.append("prompt", req.prompt);
    form.append("size", ctx.size);
    form.append("n", "1");
    form.append("image", new Blob([new Uint8Array(reference.data)], { type: reference.mime }), "reference.png");
    const response = await withTimeout(
      ctx.fetcher,
      url,
      { method: "POST", headers: { Authorization: `Bearer ${this.settings.apiKey}` }, body: form },
      ctx.timeoutMs,
      ctx.signal
    );
    const payload = (await response.json().catch(() => ({}))) as OpenAIImageResponse;
    if (!response.ok) {
      return { status: "failed", error: payload.error?.message ?? `Image HTTP ${response.status}` };
    }
    return decodeOpenAIImage(payload, ctx.fetcher);
  }
}

const stepfunDefaultBaseUrl = "https://api.stepfun.com/v1";
const stepfunDefaultSteps = 8;

class StepFunImageProvider implements ImageProvider {
  constructor(private readonly settings: ImageModelSettings) {}

  async generate(req: GenerateImageRequest, opts: GenerateImageOptions = {}): Promise<ImageResult> {
    const { settings } = this;
    if (!settings.apiKey) {
      return { status: "failed", error: "StepFun apiKey is missing." };
    }
    const fetcher = opts.fetcher ?? fetch;
    const timeoutMs = opts.timeoutMs ?? defaultImageTimeoutMs;
    try {
      if (req.referenceImage) {
        return await this.edit(req, { fetcher, timeoutMs, signal: opts.signal });
      }
      return await this.create(req, { fetcher, timeoutMs, signal: opts.signal });
    } catch (error) {
      return { status: "failed", error: error instanceof Error ? error.message : "StepFun image generation failed." };
    }
  }

  private baseUrl(): string {
    return this.settings.baseUrl?.trim() || stepfunDefaultBaseUrl;
  }

  private resolvedCfgScale(hasNegative: boolean): number {
    if (typeof this.settings.cfgScale === "number") {
      return this.settings.cfgScale;
    }
    return hasNegative ? 1.5 : 1.0;
  }

  private async create(
    req: GenerateImageRequest,
    ctx: { fetcher: Fetcher; timeoutMs: number; signal?: AbortSignal }
  ): Promise<ImageResult> {
    const negativePrompt = req.negativePrompt?.trim();
    const url = resolveOpenAIUrl(this.baseUrl(), "/images/generations");
    const body: Record<string, unknown> = {
      model: this.settings.model,
      prompt: req.prompt,
      response_format: "b64_json",
      cfg_scale: this.resolvedCfgScale(Boolean(negativePrompt)),
      steps: this.settings.steps ?? stepfunDefaultSteps,
      text_mode: this.settings.textMode ?? false
    };
    if (req.size ?? this.settings.size) {
      body.size = req.size ?? this.settings.size;
    }
    if (negativePrompt) {
      body.negative_prompt = negativePrompt;
    }
    if (typeof req.seed === "number") {
      body.seed = req.seed;
    }
    const response = await withTimeout(
      ctx.fetcher,
      url,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${this.settings.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(body)
      },
      ctx.timeoutMs,
      ctx.signal
    );
    const payload = (await response.json().catch(() => ({}))) as OpenAIImageResponse;
    if (!response.ok) {
      return { status: "failed", error: payload.error?.message ?? `StepFun HTTP ${response.status}` };
    }
    return decodeOpenAIImage(payload, ctx.fetcher);
  }

  private async edit(
    req: GenerateImageRequest,
    ctx: { fetcher: Fetcher; timeoutMs: number; signal?: AbortSignal }
  ): Promise<ImageResult> {
    const reference = await loadImageInput(req.referenceImage!, ctx.fetcher);
    if (!reference) {
      return { status: "failed", error: "Reference image could not be loaded for img2img." };
    }
    const negativePrompt = req.negativePrompt?.trim();
    const url = resolveOpenAIUrl(this.baseUrl(), "/images/edits");
    const form = new FormData();
    form.append("model", this.settings.i2iModel ?? this.settings.model);
    form.append("prompt", req.prompt);
    form.append("response_format", "b64_json");
    form.append("cfg_scale", String(this.resolvedCfgScale(Boolean(negativePrompt))));
    form.append("steps", String(this.settings.steps ?? stepfunDefaultSteps));
    form.append("text_mode", String(this.settings.textMode ?? false));
    if (negativePrompt) {
      form.append("negative_prompt", negativePrompt);
    }
    if (typeof req.seed === "number") {
      form.append("seed", String(req.seed));
    }
    form.append("image", new Blob([new Uint8Array(reference.data)], { type: reference.mime }), "reference.png");
    const response = await withTimeout(
      ctx.fetcher,
      url,
      { method: "POST", headers: { Authorization: `Bearer ${this.settings.apiKey}` }, body: form },
      ctx.timeoutMs,
      ctx.signal
    );
    const payload = (await response.json().catch(() => ({}))) as OpenAIImageResponse;
    if (!response.ok) {
      return { status: "failed", error: payload.error?.message ?? `StepFun HTTP ${response.status}` };
    }
    return decodeOpenAIImage(payload, ctx.fetcher);
  }
}

async function loadImageInput(input: ImageInput, fetcher: Fetcher): Promise<ImageBytes | null> {
  if (input.kind === "base64") {
    return { data: Buffer.from(input.data, "base64"), mime: input.mime };
  }
  const response = await fetcher(input.url, {});
  if (!response.ok) {
    return null;
  }
  const mime = response.headers.get("content-type") ?? "image/png";
  return { data: Buffer.from(await response.arrayBuffer()), mime };
}

export function resolveImageProvider(settings: ImageModelSettings): ImageProvider {
  switch (settings.provider) {
    case "openai":
      return new OpenAIImageProvider(settings);
    case "stepfun":
      return new StepFunImageProvider(settings);
    case "volcano":
    case "dev":
    default:
      return new DevImageProvider();
  }
}
