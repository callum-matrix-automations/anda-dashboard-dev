"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/frontend/components/design-system/primitives/button";

export function MasterSignInScreen({
  returnTo,
  configurationError = false,
}: {
  returnTo: string;
  configurationError?: boolean;
}) {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(
    configurationError ? "Master login has not been configured for this environment." : "",
  );

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (!username.trim() || !password) {
      setError("Enter your username and password.");
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const body = await response.json().catch(() => null) as {
        error?: { message?: string };
      } | null;
      if (!response.ok) {
        setError(body?.error?.message ?? "Sign in failed. Try again.");
        return;
      }
      router.replace(returnTo);
      router.refresh();
    } catch {
      setError("The dashboard could not be reached. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="relative grid min-h-screen min-h-dvh place-items-center overflow-y-auto bg-background px-4 py-8 text-foreground">
      <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_15%_10%,color-mix(in_oklab,var(--secondary),transparent_78%),transparent_34rem),radial-gradient(circle_at_90%_100%,color-mix(in_oklab,var(--accent),transparent_83%),transparent_30rem)]" />
      <section className="relative w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-[0_28px_80px_color-mix(in_oklab,var(--primary),transparent_86%)] sm:p-8" aria-labelledby="sign-in-title">
        <div className="mb-8 flex items-center gap-3">
          <span className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-xl border border-border bg-white shadow-sm">
            <Image unoptimized width={48} height={48} className="size-full object-cover" src="/brand/anda-logo.png" alt="" priority />
          </span>
          <span className="min-w-0">
            <strong className="block text-base tracking-[-.02em]">ANDA Dashboard</strong>
            <span className="block text-xs text-muted-foreground">Argentine Neighborhood Development Association</span>
          </span>
        </div>

        <div className="mb-6">
          <p className="mb-2 text-[.68rem] font-bold uppercase tracking-[.16em] text-secondary">Restricted access</p>
          <h1 id="sign-in-title" className="text-2xl font-semibold">Sign in to continue</h1>
          <p className="mt-2 text-sm text-muted-foreground">Use the master dashboard credentials supplied by the association.</p>
        </div>

        <form className="grid gap-4" onSubmit={submit} noValidate>
          <label className="grid gap-1.5 text-sm font-medium">
            Username
            <input
              className="h-11 rounded-md border border-input bg-background px-3 text-sm outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/25"
              name="username"
              type="text"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              disabled={submitting}
            />
          </label>
          <label className="grid gap-1.5 text-sm font-medium">
            Password
            <span className="flex rounded-md border border-input bg-background transition focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/25">
              <input
                className="h-11 min-w-0 flex-1 bg-transparent px-3 text-sm outline-none"
                name="password"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                disabled={submitting}
              />
              <button
                type="button"
                className="px-3 text-xs font-semibold text-primary hover:text-primary/75"
                onClick={() => setShowPassword((current) => !current)}
                disabled={submitting}
              >
                {showPassword ? "Hide" : "Show"}
              </button>
            </span>
          </label>

          {error && (
            <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/8 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}

          <Button type="submit" size="lg" className="mt-1 h-11 w-full text-sm" loading={submitting}>
            Sign in
          </Button>
        </form>

        <p className="mt-6 border-t border-border pt-4 text-xs leading-relaxed text-muted-foreground">
          This system contains private association records. Credentials should not be shared.
        </p>
      </section>
    </main>
  );
}
