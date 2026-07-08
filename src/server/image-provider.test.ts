import { describe, expect, test } from "vitest";
import type { ImageModelSettings } from "@/domain/types";
import { resolveImageProvider } from "./image-provider";

const devSettings: ImageModelSettings = { provider: "dev", model: "dev-image", size: "1024x1024" };

describe("image provider", () => {
  test("dev adapter returns deterministic placeholder bytes", async () => {
    const provider = resolveImageProvider(devSettings);
    const first = await provider.generate({ prompt: "雨夜咖啡" });
    const second = await provider.generate({ prompt: "雨夜咖啡" });

    expect(first.status).toBe("completed");
    if (first.status === "completed" && second.status === "completed") {
      expect(first.image.mime).toBe("image/svg+xml");
      expect(first.image.data.length).toBeGreaterThan(0);
      expect(first.image.data.equals(second.image.data)).toBe(true);
    }
  });

  test("dev adapter varies output by prompt", async () => {
    const provider = resolveImageProvider(devSettings);
    const a = await provider.generate({ prompt: "海边黄昏" });
    const b = await provider.generate({ prompt: "深夜排练室" });

    if (a.status === "completed" && b.status === "completed") {
      expect(a.image.data.equals(b.image.data)).toBe(false);
    }
  });

  test("openai adapter fails cleanly without credentials", async () => {
    const provider = resolveImageProvider({ provider: "openai", model: "gpt-image-1" });
    const result = await provider.generate({ prompt: "任意" });

    expect(result.status).toBe("failed");
  });

  test("unknown provider degrades to dev placeholder", async () => {
    const provider = resolveImageProvider({ provider: "volcano", model: "jimeng" });
    const result = await provider.generate({ prompt: "占位" });

    expect(result.status).toBe("completed");
  });

  const stepfunSettings: ImageModelSettings = {
    provider: "stepfun",
    model: "step-image-edit-2",
    apiKey: "sk-step-test"
  };
  const pngB64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMCAoGYUdyBAAAAAElFTkSuQmCC";
  const okResponse = () =>
    new Response(JSON.stringify({ created: 1, data: [{ b64_json: pngB64, finish_reason: "success", seed: 1 }] }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });

  test("stepfun text-to-image posts JSON with stepfun params to /images/generations", async () => {
    let capturedUrl = "";
    let capturedBody: Record<string, unknown> = {};
    const fetcher = async (url: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(url);
      capturedBody = JSON.parse(String(init?.body));
      return okResponse();
    };
    const provider = resolveImageProvider(stepfunSettings);
    const result = await provider.generate(
      { prompt: "采菊东篱下", negativePrompt: "低质量", size: "896x1184" },
      { fetcher }
    );

    expect(result.status).toBe("completed");
    expect(capturedUrl).toBe("https://api.stepfun.com/v1/images/generations");
    expect(capturedBody).toMatchObject({
      model: "step-image-edit-2",
      prompt: "采菊东篱下",
      response_format: "b64_json",
      steps: 8,
      size: "896x1184",
      negative_prompt: "低质量"
    });
    expect(Number(capturedBody.cfg_scale)).toBeGreaterThan(1);
  });

  test("stepfun image-to-image posts multipart form to /images/edits with reference", async () => {
    let capturedUrl = "";
    let capturedForm: FormData | null = null;
    const fetcher = async (url: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(url);
      capturedForm = init?.body as FormData;
      return okResponse();
    };
    const provider = resolveImageProvider(stepfunSettings);
    const result = await provider.generate(
      { prompt: "变成猫", referenceImage: { kind: "base64", data: pngB64, mime: "image/png" } },
      { fetcher }
    );

    expect(result.status).toBe("completed");
    expect(capturedUrl).toBe("https://api.stepfun.com/v1/images/edits");
    expect(capturedForm).toBeInstanceOf(FormData);
    expect(capturedForm!.get("model")).toBe("step-image-edit-2");
    expect(capturedForm!.get("prompt")).toBe("变成猫");
    expect(capturedForm!.get("response_format")).toBe("b64_json");
    expect(capturedForm!.get("image")).toBeInstanceOf(Blob);
  });

  test("stepfun fails cleanly without apiKey", async () => {
    const provider = resolveImageProvider({ provider: "stepfun", model: "step-image-edit-2" });
    const result = await provider.generate({ prompt: "x" });

    expect(result.status).toBe("failed");
  });

  test("stepfun surfaces provider error body", async () => {
    const fetcher = async () =>
      new Response(JSON.stringify({ error: { message: "quota exceeded" } }), {
        status: 429,
        headers: { "Content-Type": "application/json" }
      });
    const provider = resolveImageProvider(stepfunSettings);
    const result = await provider.generate({ prompt: "x" }, { fetcher });

    expect(result.status).toBe("failed");
    if (result.status === "failed") {
      expect(result.error).toContain("quota exceeded");
    }
  });
});
