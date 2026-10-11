"use client";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/frontend/components/design-system/primitives/button";

export function RegisterScreen() {
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [complete, setComplete] = useState(false);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError("");
    const fields = new FormData(event.currentTarget);
    if (fields.get("password") !== fields.get("confirmPassword")) { setError("The two passwords must match."); return; }
    setSubmitting(true);
    try {
      const response = await fetch("/api/auth/register", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ displayName: fields.get("displayName"), email: fields.get("email"), password: fields.get("password") }) });
      const body = await response.json();
      if (!response.ok) { setError(body?.error?.message ?? "Account creation failed. Contact the account operator."); return; }
      setComplete(true);
    } catch { setError("The dashboard could not be reached. Please try again."); }
    finally { setSubmitting(false); }
  }
  return <main className="grid min-h-dvh place-items-center bg-background px-4 py-8 text-foreground">
    <section className="w-full max-w-md rounded-2xl border border-border bg-card p-6 sm:p-8" aria-labelledby="registration-title">
      <p className="mb-3 text-sm font-semibold text-secondary">ANDA Dashboard</p>
      <h1 id="registration-title" className="text-2xl font-semibold">{complete ? "Your account is ready" : "Create your board account"}</h1>
      {complete ? <p className="mt-4 text-sm">You can now sign in with your email address and the password you chose. Your account can view meeting records; only the President can change drafts.</p> : <>
        <p className="mt-2 text-sm text-muted-foreground">Enter your name and email address, then choose your own password. You can sign in as soon as your account is created.</p>
        <form onSubmit={submit} className="mt-6 grid gap-4">
          {[
            { name: "displayName", label: "Your name", type: "text", autoComplete: "name", maxLength: 200 },
            { name: "email", label: "Email address", type: "email", autoComplete: "email", maxLength: 254 },
            { name: "password", label: "Password (at least 12 characters)", type: "password", autoComplete: "new-password", minLength: 12, maxLength: 128 },
            { name: "confirmPassword", label: "Enter your password again", type: "password", autoComplete: "new-password", minLength: 12, maxLength: 128 },
          ].map(field => <label key={field.name} className="grid gap-1.5 text-sm font-medium">{field.label}<input {...field} aria-label={field.label} required disabled={submitting} className="h-11 rounded-md border border-input bg-background px-3 text-sm" /></label>)}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <Button type="submit" loading={submitting} className="h-11">Create account</Button>
        </form>
      </>}
      <Link href="/auth/sign-in" className="mt-6 block text-sm font-semibold text-primary underline">{complete ? "Sign in to your account" : "Back to sign in"}</Link>
    </section>
  </main>;
}
