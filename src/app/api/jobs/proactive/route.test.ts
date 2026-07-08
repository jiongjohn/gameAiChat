import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

let tempDir: string | undefined;
const originalCronSecret = process.env.CRON_SECRET;
const originalStatePath = process.env.AI_CHAT_STATE_PATH;

async function loadRoute() {
  vi.resetModules();
  return import("./route");
}

function post(headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/jobs/proactive", {
    method: "POST",
    headers
  });
}

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "ai-chat-proactive-"));
  process.env.AI_CHAT_STATE_PATH = join(tempDir, "state.json");
});

afterEach(async () => {
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  }
  if (originalCronSecret === undefined) {
    delete process.env.CRON_SECRET;
  } else {
    process.env.CRON_SECRET = originalCronSecret;
  }
  if (originalStatePath === undefined) {
    delete process.env.AI_CHAT_STATE_PATH;
  } else {
    process.env.AI_CHAT_STATE_PATH = originalStatePath;
  }
});

describe("POST /api/jobs/proactive auth guard", () => {
  test("rejects request with no secret header when CRON_SECRET is set", async () => {
    process.env.CRON_SECRET = "s3cr3t";
    const { POST } = await loadRoute();

    const response = await POST(post());

    expect(response.status).toBe(401);
  });

  test("rejects request with wrong secret header", async () => {
    process.env.CRON_SECRET = "s3cr3t";
    const { POST } = await loadRoute();

    const response = await POST(post({ "x-cron-secret": "wrong" }));

    expect(response.status).toBe(401);
  });

  test("fails closed with 503 when CRON_SECRET is unset", async () => {
    delete process.env.CRON_SECRET;
    const { POST } = await loadRoute();

    const response = await POST(post({ "x-cron-secret": "anything" }));

    expect(response.status).toBe(503);
  });

  test("allows request with correct secret (not 401, not 503)", async () => {
    process.env.CRON_SECRET = "s3cr3t";
    const { POST } = await loadRoute();

    const response = await POST(post({ "x-cron-secret": "s3cr3t" }));

    expect(response.status).not.toBe(401);
    expect(response.status).not.toBe(503);
    expect(response.status).toBe(200);
  });
});
