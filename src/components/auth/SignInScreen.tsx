"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { SignInSchema } from "@/domain/auth";
import { AuthCard } from "./AuthCard";

// AIDEV-NOTE: Mock sign-in — any well-formed credentials continue to /auth/verify.
// There is deliberately no credential store; validation exists to demo error states.
export function SignInScreen() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const parsed = SignInSchema.safeParse({ email, password });
    if (!parsed.success) {
      const next: { email?: string; password?: string } = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path[0];
        if (field === "email" && !next.email) next.email = issue.message;
        if (field === "password" && !next.password) next.password = issue.message;
      }
      setErrors(next);
      return;
    }
    setErrors({});
    router.push("/auth/verify");
  };

  return (
    <AuthCard title="Sign in" lede="Open the ANDA meeting records demo.">
      <form className="grid gap-3" onSubmit={submit} noValidate>
        <label className="form-control">
          <span className="label-text mb-1 text-xs">Email</span>
          <input
            className={`input input-bordered ${errors.email ? "input-error" : ""}`}
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            aria-label="Email"
            aria-invalid={errors.email ? true : undefined}
          />
          {errors.email && <span role="alert" className="mt-1 text-xs text-error">{errors.email}</span>}
        </label>
        <label className="form-control">
          <span className="label-text mb-1 text-xs">Password</span>
          <div className="join w-full">
            <input
              className={`input input-bordered join-item w-full ${errors.password ? "input-error" : ""}`}
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              aria-label="Password"
              aria-invalid={errors.password ? true : undefined}
            />
            <button
              type="button"
              className="btn btn-outline join-item"
              onClick={() => setShowPassword((current) => !current)}
            >
              {showPassword ? "Hide password" : "Show password"}
            </button>
          </div>
          {errors.password && <span role="alert" className="mt-1 text-xs text-error">{errors.password}</span>}
          <span className="mt-1 text-xs font-medium opacity-70">Demo only — do not enter a real password.</span>
        </label>
        <div className="flex items-center justify-between">
          <Link className="link text-sm" href="/auth/forgot-password">Forgot password?</Link>
          <button type="submit" className="btn btn-primary">Sign in</button>
        </div>
      </form>
      <div className="divider my-1 text-xs opacity-55">or continue with</div>
      <div className="grid gap-2 sm:grid-cols-2">
        {/* AIDEV-NOTE: SSO buttons are mock choices — both land in the same deterministic demo. */}
        <button type="button" className="btn btn-outline" onClick={() => router.push("/auth/verify")}>
          <span aria-hidden className="font-black">⊞</span> Continue with Microsoft
        </button>
        <button type="button" className="btn btn-outline" onClick={() => router.push("/auth/verify")}>
          <span aria-hidden className="font-black">G</span> Continue with Google
        </button>
      </div>
    </AuthCard>
  );
}
