"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import { useWorkspace } from "@/frontend/components/providers/WorkspaceProvider";
import type { BoardTheme } from "@/frontend/components/shell/theme";
import { decodeProfileImage, profileInitials, validateProfileImageBytes } from "@/frontend/utils/profileImage";
import { Button } from "@/frontend/components/design-system/primitives/button";
import { cn } from "@/frontend/components/design-system/lib/utils";

export function SettingsScreen() {
  const { theme, setTheme, avatar, setAvatar } = useWorkspace();
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const readVersion = useRef(0);

  const onFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const version = ++readVersion.current;
    const verdict = await validateProfileImageBytes(file).catch(() => ({ ok: false as const, error: "That image could not be read." }));
    if (version !== readVersion.current) return;
    if (!verdict.ok) { setError(verdict.error); return; }
    const reader = new FileReader();
    reader.onload = async () => {
      if (version !== readVersion.current || typeof reader.result !== "string") return;
      try {
        await decodeProfileImage(reader.result);
        if (version === readVersion.current) { setAvatar(reader.result); setError(""); }
      } catch { if (version === readVersion.current) setError("That image could not be decoded."); }
    };
    reader.onerror = () => setError("That image could not be read.");
    reader.readAsDataURL(file);
  };

  const themes: Array<{ value: BoardTheme; label: string; hint: string }> = [
    { value: "board-light", label: "Light", hint: "ANDA navy, teal, and warm white" },
    { value: "board-dark", label: "Dark", hint: "The original navy operations theme" },
  ];

  return (
    <div className="grid max-w-2xl gap-6">
      <div>
        <div className="text-xs font-semibold tracking-wide text-secondary">Personal · Settings</div>
        <h1 className="mt-0.5 text-2xl font-semibold">Settings</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">Browser-only appearance settings. Nothing is uploaded to a backend.</p>
      </div>

      <section className="rounded-xl border border-border bg-card p-5 shadow-sm shadow-primary/5 sm:p-6">
        <h2 className="text-base font-semibold">Profile photo</h2>
        <div className="mt-5 flex flex-wrap items-center gap-4">
          <div className="grid size-16 place-items-center overflow-hidden rounded-full bg-primary text-primary-foreground">
            {avatar ? <Image unoptimized width={64} height={64} src={avatar} alt="Profile photo preview" /> : <span className="text-lg">{profileInitials("ANDA")}</span>}
          </div>
          <div className="grid gap-2">
            <input ref={fileRef} className="sr-only" type="file" accept="image/png,image/jpeg,image/webp" onChange={onFile} aria-label="Choose profile photo" />
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>{avatar ? "Replace photo" : "Upload photo"}</Button>
              {avatar && <Button variant="ghost" size="sm" onClick={() => setAvatar(null)}>Remove photo</Button>}
            </div>
            <p className="text-xs text-muted-foreground">PNG, JPEG, or WebP up to 2 MB. The image stays in this browser session.</p>
            {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-border bg-card p-5 shadow-sm shadow-primary/5 sm:p-6">
        <h2 className="text-base font-semibold">Appearance</h2>
        <div className="mt-5 grid gap-2 sm:grid-cols-2">
          {themes.map((option) => (
            <label key={option.value} className={cn(
              "flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors",
              theme === option.value ? "border-secondary bg-secondary/5" : "border-border hover:bg-muted/50",
            )}>
              <input className="size-4 accent-primary" type="radio" name="board-theme" checked={theme === option.value} onChange={() => setTheme(option.value)} />
              <span><strong className="block text-sm">{option.label}</strong><span className="text-xs text-muted-foreground">{option.hint}</span></span>
            </label>
          ))}
        </div>
      </section>
    </div>
  );
}
