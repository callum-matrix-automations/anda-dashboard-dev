"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { DEMO_TWO_FACTOR_CODE, TWO_FACTOR_LENGTH, validateTwoFactorCode } from "@/domain/auth";
import { AuthCard } from "./AuthCard";

// AIDEV-NOTE: Segmented 2FA input. The demo code is printed on screen because the demo
// has no authenticator app; validation still exercises the real error paths.
export function TwoFactorScreen() {
  const router = useRouter();
  const [digits, setDigits] = useState<string[]>(Array.from({ length: TWO_FACTOR_LENGTH }, () => ""));
  const [error, setError] = useState("");
  const [resent, setResent] = useState(false);
  const inputs = useRef<Array<HTMLInputElement | null>>([]);

  const setDigit = (index: number, raw: string) => {
    // Accept a full paste into any cell: distribute digits forward from that cell.
    const cleaned = raw.replace(/\D/g, "");
    setDigits((current) => {
      const next = [...current];
      if (cleaned.length === 0) {
        next[index] = "";
        return next;
      }
      for (const [offset, digit] of [...cleaned.slice(0, TWO_FACTOR_LENGTH - index)].entries()) {
        next[index + offset] = digit;
      }
      return next;
    });
    if (cleaned.length > 0) {
      const target = Math.min(index + cleaned.length, TWO_FACTOR_LENGTH - 1);
      inputs.current[target]?.focus();
    }
  };

  const onKeyDown = (index: number, event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Backspace" && !digits[index] && index > 0) inputs.current[index - 1]?.focus();
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const result = validateTwoFactorCode(digits.join(""));
    if (!result.ok) {
      setError(result.error);
      return;
    }
    router.push("/app/dashboard");
  };

  return (
    <AuthCard title="Two-factor verification" lede="Enter the 6-digit code to open the meeting records demo.">
      <div role="note" className="alert py-2 text-sm">
        <span>Demo code: <kbd className="kbd kbd-sm">{DEMO_TWO_FACTOR_CODE}</kbd> — a real deployment would text or app-generate this.</span>
      </div>
      <form className="grid gap-3" onSubmit={submit} noValidate>
        <fieldset className="m-0 border-0 p-0">
          <legend className="mb-2 text-xs opacity-60">Verification code</legend>
          <div className="grid grid-cols-6 gap-1.5">
            {digits.map((digit, index) => (
              <input
                key={index}
                ref={(node) => { inputs.current[index] = node; }}
                className="input h-11 w-full min-w-0 border border-base-300 bg-base-100 p-0 text-center text-lg font-semibold"
                inputMode="numeric"
                autoComplete={index === 0 ? "one-time-code" : "off"}
                value={digit}
                onChange={(event) => setDigit(index, event.target.value)}
                onKeyDown={(event) => onKeyDown(index, event)}
                aria-label={`Digit ${index + 1}`}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? "two-factor-error" : undefined}
              />
            ))}
          </div>
        </fieldset>
        {error && <p id="two-factor-error" role="alert" className="text-sm text-error">{error}</p>}
        {resent && (
          <p role="status" className="text-sm opacity-70">
            A fresh code was issued. In this demo it is always the code shown above; nothing was sent.
          </p>
        )}
        <div className="flex items-center justify-between">
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setResent(true); setError(""); }}>
            Resend code
          </button>
          <button type="submit" className="btn btn-primary">Verify code</button>
        </div>
      </form>
      <Link className="link text-sm" href="/auth/sign-in">Back to sign in</Link>
    </AuthCard>
  );
}
