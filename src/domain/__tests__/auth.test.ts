import { describe, expect, it } from "vitest";
import {
  DEMO_TWO_FACTOR_CODE,
  SignInSchema,
  RecoveryEmailSchema,
  validateTwoFactorCode,
} from "../auth";

describe("sign-in validation", () => {
  it("accepts a well-formed email and password", () => {
    const result = SignInSchema.safeParse({ email: "grace@anda.local", password: "meeting-records" });
    expect(result.success).toBe(true);
  });

  it("rejects a malformed email with an actionable message", () => {
    const result = SignInSchema.safeParse({ email: "not-an-email", password: "meeting-records" });
    expect(result.success).toBe(false);
    expect(result.success ? "" : result.error.issues[0]?.message).toBe("Enter a valid email address.");
  });

  it("rejects a short password with an actionable message", () => {
    const result = SignInSchema.safeParse({ email: "grace@anda.local", password: "short" });
    expect(result.success).toBe(false);
    expect(result.success ? "" : result.error.issues[0]?.message).toBe("Password must be at least 8 characters.");
  });
});

describe("recovery email validation", () => {
  it("accepts a well-formed email", () => {
    expect(RecoveryEmailSchema.safeParse({ email: "grace@anda.local" }).success).toBe(true);
  });

  it("rejects an empty email", () => {
    const result = RecoveryEmailSchema.safeParse({ email: "" });
    expect(result.success).toBe(false);
  });
});

describe("two-factor code validation", () => {
  it("documents a deterministic six-digit demo code", () => {
    expect(DEMO_TWO_FACTOR_CODE).toMatch(/^\d{6}$/);
  });

  it("accepts the demo code", () => {
    expect(validateTwoFactorCode(DEMO_TWO_FACTOR_CODE)).toEqual({ ok: true });
  });

  it("rejects an incomplete code before comparing it", () => {
    expect(validateTwoFactorCode("12")).toEqual({ ok: false, error: "Enter all 6 digits." });
  });

  it("rejects non-digit input", () => {
    expect(validateTwoFactorCode("12a456")).toEqual({ ok: false, error: "Enter all 6 digits." });
  });

  it("rejects a wrong six-digit code", () => {
    expect(validateTwoFactorCode("000000")).toEqual({
      ok: false,
      error: "That code does not match. Use the demo code shown above.",
    });
  });
});
