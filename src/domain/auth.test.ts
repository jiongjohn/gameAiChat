import { describe, expect, test } from "vitest";
import { hashPassword, isValidPassword, isValidUsername, verifyPassword } from "./auth";

describe("auth", () => {
  test("hashPassword produces salted hash that verifies", () => {
    const { hash, salt } = hashPassword("companion123");
    expect(hash).not.toBe("companion123");
    expect(verifyPassword("companion123", hash, salt)).toBe(true);
    expect(verifyPassword("wrong-password", hash, salt)).toBe(false);
  });

  test("distinct salts per hash", () => {
    const a = hashPassword("samePassword");
    const b = hashPassword("samePassword");
    expect(a.salt).not.toBe(b.salt);
    expect(a.hash).not.toBe(b.hash);
    expect(verifyPassword("samePassword", a.hash, a.salt)).toBe(true);
    expect(verifyPassword("samePassword", b.hash, b.salt)).toBe(true);
  });

  test("verifyPassword rejects empty hash or salt", () => {
    expect(verifyPassword("x", "", "")).toBe(false);
  });

  test("username and password validation", () => {
    expect(isValidUsername("demo_01")).toBe(true);
    expect(isValidUsername("ab")).toBe(false);
    expect(isValidUsername("has space")).toBe(false);
    expect(isValidPassword("123456")).toBe(true);
    expect(isValidPassword("123")).toBe(false);
  });
});
