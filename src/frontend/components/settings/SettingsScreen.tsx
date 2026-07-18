"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import { useWorkspace } from "@/frontend/components/providers/WorkspaceProvider";
import type { BoardTheme } from "@/frontend/components/shell/theme";
import { decodeProfileImage, profileInitials, validateProfileImageBytes } from "@/frontend/utils/profileImage";

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
    { value: "board-light", label: "Light", hint: "White and gray surfaces" },
    { value: "board-dark", label: "Dark", hint: "Charcoal and black surfaces" },
  ];

  return (
    <div className="grid max-w-2xl gap-6">
      <div><div className="breadcrumbs text-xs"><ul><li>Personal</li><li>Settings</li></ul></div><h1 className="text-2xl font-semibold">Settings</h1><p className="text-sm opacity-60">Browser-only appearance settings. Nothing is uploaded to a backend.</p></div>
      <section className="card border border-base-300 bg-base-200"><div className="card-body gap-5 p-5 sm:p-6">
        <h2 className="card-title text-base">Profile photo</h2>
        <div className="flex flex-wrap items-center gap-4">
          <div className="avatar placeholder"><div className="grid w-16 place-items-center overflow-hidden rounded-full bg-neutral text-neutral-content">{avatar ? <Image unoptimized width={64} height={64} src={avatar} alt="Profile photo preview" /> : <span className="text-lg">{profileInitials("ANDA")}</span>}</div></div>
          <div className="grid gap-2"><input ref={fileRef} className="sr-only" type="file" accept="image/png,image/jpeg,image/webp" onChange={onFile} aria-label="Choose profile photo" /><div className="flex gap-2"><button className="btn btn-outline btn-sm" onClick={() => fileRef.current?.click()}>{avatar ? "Replace photo" : "Upload photo"}</button>{avatar && <button className="btn btn-ghost btn-sm" onClick={() => setAvatar(null)}>Remove photo</button>}</div><p className="text-xs opacity-60">PNG, JPEG, or WebP up to 2 MB. The image stays in this browser session.</p>{error && <p role="alert" className="text-xs text-error">{error}</p>}</div>
        </div>
      </div></section>
      <section className="card border border-base-300 bg-base-200"><div className="card-body gap-5 p-5 sm:p-6"><h2 className="card-title text-base">Appearance</h2><div className="grid gap-2 sm:grid-cols-2">{themes.map((option) => <label key={option.value} className={`flex cursor-pointer items-center gap-3 rounded-box border p-3 ${theme === option.value ? "border-base-content" : "border-base-300"}`}><input className="radio radio-sm" type="radio" name="board-theme" checked={theme === option.value} onChange={() => setTheme(option.value)} /><span><strong className="block text-sm">{option.label}</strong><span className="text-xs opacity-60">{option.hint}</span></span></label>)}</div></div></section>
    </div>
  );
}
