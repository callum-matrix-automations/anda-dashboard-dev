"use client";

import { useEffect, useRef, useState } from "react";
import { useWorkspace } from "@/components/providers/WorkspaceProvider";
import type { BoardTheme } from "@/components/shell/theme";
import { decodeProfileImage, profileInitials, validateProfileImageBytes } from "@/domain/profileImage";

// AIDEV-NOTE: Everything on this screen is personal, frontend-only state. No
// backend-managed security controls are mocked here — that would be auth theater.
export function SettingsScreen() {
  const { viewer, theme, setTheme, avatar, setAvatar } = useWorkspace();
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const readVersion = useRef(0);

  useEffect(() => {
    // AIDEV-NOTE: Viewer changes invalidate reads started by the prior identity; their callbacks must be inert.
    readVersion.current += 1;
  }, [viewer.id]);

  const onFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Reset so choosing the same file again re-fires change.
    event.target.value = "";
    if (!file) return;
    const version = ++readVersion.current;
    let verdict;
    try {
      verdict = await validateProfileImageBytes(file);
    } catch {
      if (version === readVersion.current) setError("That image could not be read. Try a different file.");
      return;
    }
    if (version !== readVersion.current) return;
    if (!verdict.ok) {
      setError(verdict.error);
      return;
    }
    const reader = new FileReader();
    reader.onload = async () => {
      if (version !== readVersion.current) return;
      if (typeof reader.result !== "string") { setError("That image could not be read. Try a different file."); return; }
      try {
        await decodeProfileImage(reader.result);
        if (version !== readVersion.current) return;
        setError("");
        setAvatar(reader.result);
      } catch {
        if (version === readVersion.current) setError("That image could not be decoded. Try a different file.");
      }
    };
    reader.onerror = () => { if (version === readVersion.current) setError("That image could not be read. Try a different file."); };
    reader.readAsDataURL(file);
  };

  const themes: Array<{ value: BoardTheme; label: string; hint: string }> = [
    { value: "board-light", label: "Light", hint: "White and gray surfaces" },
    { value: "board-dark", label: "Dark", hint: "Charcoal and black surfaces" },
  ];

  return (
    <div className="grid max-w-2xl gap-6">
      <div>
        <div className="breadcrumbs text-xs"><ul><li>Personal</li><li>Settings</li></ul></div>
        <h1 className="text-2xl font-semibold">Settings</h1>
        <p className="text-sm opacity-60">
          Personal choices for {viewer.name}. Changes are kept in memory for this demo session only — nothing is uploaded or stored.
        </p>
      </div>

      <section className="card border border-base-300 bg-base-200" aria-labelledby="profile-photo-heading">
        <div className="card-body gap-5 p-5 sm:p-6">
          <h2 id="profile-photo-heading" className="card-title text-base">Profile photo</h2>
          <div className="flex flex-wrap items-center gap-4">
            <div className="avatar placeholder">
              <div className="grid w-16 place-items-center rounded-full bg-neutral text-neutral-content">
                {avatar
                  // eslint-disable-next-line @next/next/no-img-element -- in-memory data URL; next/image expects a servable URL
                  ? <img src={avatar} alt="Profile photo preview" />
                  : <span className="text-lg">{profileInitials(viewer.name)}</span>}
              </div>
            </div>
            <div className="grid gap-2">
              <input
                ref={fileRef}
                className="sr-only"
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={onFile}
                aria-label="Choose profile photo"
              />
              <div className="flex flex-wrap gap-2">
                <button className="btn btn-outline btn-sm min-h-11 sm:min-h-9" onClick={() => fileRef.current?.click()}>
                  {avatar ? "Replace photo" : "Upload photo"}
                </button>
                {avatar && (
                  <button className="btn btn-ghost btn-sm min-h-11 sm:min-h-9" onClick={() => { readVersion.current += 1; setAvatar(null); setError(""); }}>
                    Remove photo
                  </button>
                )}
              </div>
              <p className="text-xs opacity-60">PNG, JPEG, or WebP up to 2 MB. The image stays on this device.</p>
              {error && <p role="alert" className="text-xs text-error">{error}</p>}
            </div>
          </div>
        </div>
      </section>

      <section className="card border border-base-300 bg-base-200" aria-labelledby="appearance-heading">
        <div className="card-body gap-5 p-5 sm:p-6">
          <h2 id="appearance-heading" className="card-title text-base">Appearance</h2>
          <fieldset className="m-0 border-0 p-0">
            <legend className="sr-only">Theme</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {themes.map((option) => (
                <label
                  key={option.value}
                  className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-box border p-3 ${theme === option.value ? "border-base-content" : "border-base-300"}`}
                >
                  <input
                    className="radio radio-sm"
                    type="radio"
                    name="board-theme"
                    checked={theme === option.value}
                    onChange={() => setTheme(option.value)}
                    aria-label={option.label}
                  />
                  <span>
                    <strong className="block text-sm">{option.label}</strong>
                    <span className="text-xs opacity-60">{option.hint}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          <p className="text-xs opacity-60">The theme choice is the only preference this demo persists on this device.</p>
        </div>
      </section>

      {viewer.isSuperadmin && (
        <p role="note" className="text-xs opacity-60">
          Superadmin settings cover the same personal options; this level still has no meeting access.
        </p>
      )}
    </div>
  );
}
