"use client";

import Link from "next/link";
import { useState } from "react";
import { RecoveryEmailSchema } from "@/domain/auth";
import { AuthCard } from "./AuthCard";

// AIDEV-NOTE: Recovery is a pure demo confirmation — no email service exists, and the
// success copy says so explicitly to avoid auth theater.
export function ForgotPasswordScreen() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const parsed = RecoveryEmailSchema.safeParse({ email });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Enter a valid email address.");
      return;
    }
    setError("");
    setSent(true);
  };

  return (
    <AuthCard title="Reset your password" lede="Tell us the email on the account and we would send reset instructions.">
      {sent ? (
        <div role="status" className="alert">
          <span>
            <strong>Check {email}.</strong> In production, reset instructions would arrive there.
            This demo sends nothing — continue back to sign in and use any well-formed credentials.
          </span>
        </div>
      ) : (
        <form className="grid gap-3" onSubmit={submit} noValidate>
          <label className="form-control">
            <span className="label-text mb-1 text-xs">Email</span>
            <input
              className={`input input-bordered ${error ? "input-error" : ""}`}
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              aria-label="Email"
              aria-invalid={error ? true : undefined}
            />
            {error && <span role="alert" className="mt-1 text-xs text-error">{error}</span>}
          </label>
          <button type="submit" className="btn btn-primary">Send reset instructions</button>
        </form>
      )}
      <Link className="link text-sm" href="/auth/sign-in">Back to sign in</Link>
    </AuthCard>
  );
}
