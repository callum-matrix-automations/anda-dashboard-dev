import { z } from "zod";

// AIDEV-NOTE: Frontend-only demo authentication. Nothing here is security — no
// credential ever leaves the browser and no token exists. Validators gate the demo
// flow so the UI can exercise realistic error states deterministically.

export const SignInSchema = z.object({
  email: z.string().trim().email("Enter a valid email address."),
  password: z.string().min(8, "Password must be at least 8 characters."),
});
export type SignInInput = z.infer<typeof SignInSchema>;

export const RecoveryEmailSchema = z.object({
  email: z.string().trim().email("Enter a valid email address."),
});
export type RecoveryEmailInput = z.infer<typeof RecoveryEmailSchema>;

// AIDEV-NOTE: Deterministic demo 2FA code — surfaced in the verify screen copy and
// asserted in tests. Deliberately not random so the whole flow is clickable offline.
export const DEMO_TWO_FACTOR_CODE = "246810";

export const TWO_FACTOR_LENGTH = DEMO_TWO_FACTOR_CODE.length;

export type TwoFactorResult = { ok: true } | { ok: false; error: string };

export function validateTwoFactorCode(code: string): TwoFactorResult {
  if (!new RegExp(`^\\d{${TWO_FACTOR_LENGTH}}$`).test(code)) {
    return { ok: false, error: `Enter all ${TWO_FACTOR_LENGTH} digits.` };
  }
  if (code !== DEMO_TWO_FACTOR_CODE) {
    return { ok: false, error: "That code does not match. Use the demo code shown above." };
  }
  return { ok: true };
}
