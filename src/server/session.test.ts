import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { createSessionToken, getSessionUserId, verifySessionToken } from "./session";

const original = process.env.SESSION_SECRET;

beforeEach(() => {
  process.env.SESSION_SECRET = "test-secret";
});

afterEach(() => {
  process.env.SESSION_SECRET = original;
});

describe("session token", () => {
  test("round-trips a signed user id", () => {
    const token = createSessionToken("u_abc");
    expect(verifySessionToken(token)).toBe("u_abc");
  });

  test("rejects tampered payload", () => {
    const token = createSessionToken("u_abc");
    const [, signature] = token.split(".");
    const forged = `${Buffer.from("u_evil", "utf8").toString("base64url")}.${signature}`;
    expect(verifySessionToken(forged)).toBeNull();
  });

  test("rejects token signed with a different secret", () => {
    const token = createSessionToken("u_abc");
    process.env.SESSION_SECRET = "another-secret";
    expect(verifySessionToken(token)).toBeNull();
  });

  test("getSessionUserId reads the session cookie", () => {
    const token = createSessionToken("u_cookie");
    const request = new Request("http://localhost/api/state", {
      headers: { cookie: `ai_chat_session=${encodeURIComponent(token)}; other=1` }
    });
    expect(getSessionUserId(request)).toBe("u_cookie");
  });

  test("getSessionUserId returns null without cookie", () => {
    const request = new Request("http://localhost/api/state");
    expect(getSessionUserId(request)).toBeNull();
  });
});
