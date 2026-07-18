// AIDEV-NOTE: Frontend-only profile photo rules. The image never leaves the browser —
// This is browser-only input validation and is not a security boundary.

export const MAX_PROFILE_IMAGE_BYTES = 2 * 1024 * 1024; // 2 MB, stated in the UI copy

const ALLOWED_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

export type ProfileImageResult = { ok: true } | { ok: false; error: string };

export function profileInitials(name: string): string {
  const initials = name.trim().split(/\s+/).filter(Boolean).map((part) => part[0]?.toUpperCase()).filter(Boolean).join("");
  return initials || "?";
}

export function validateProfileImage(file: { type: string; size: number }): ProfileImageResult {
  if (!ALLOWED_TYPES.has(file.type)) {
    return { ok: false, error: "Choose a PNG, JPEG, or WebP image." };
  }
  if (!Number.isFinite(file.size) || file.size <= 0) return { ok: false, error: "That file is empty or invalid." };
  if (file.size > MAX_PROFILE_IMAGE_BYTES) {
    return { ok: false, error: "Choose an image up to 2 MB." };
  }
  return { ok: true };
}

const SIGNATURES: Record<string, (bytes: Uint8Array) => boolean> = {
  "image/png": (b) => b.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => b[i] === v),
  "image/jpeg": (b) => b.length >= 4 && b[0] === 0xff && b[1] === 0xd8 && b[b.length - 2] === 0xff && b[b.length - 1] === 0xd9,
  "image/webp": (b) => b.length >= 12 && String.fromCharCode(...b.slice(0, 4)) === "RIFF" && String.fromCharCode(...b.slice(8, 12)) === "WEBP",
};

export async function validateProfileImageBytes(file: File): Promise<ProfileImageResult> {
  const basic = validateProfileImage(file);
  if (!basic.ok) return basic;
  const bytes = await new Promise<Uint8Array>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => reader.result instanceof ArrayBuffer
      ? resolve(new Uint8Array(reader.result))
      : reject(new Error("Image bytes could not be read."));
    reader.onerror = () => reject(reader.error ?? new Error("Image bytes could not be read."));
    reader.readAsArrayBuffer(file);
  });
  if (!SIGNATURES[file.type]?.(bytes)) return { ok: false, error: "The file contents do not match its image type." };
  return { ok: true };
}

export function decodeProfileImage(dataUrl: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("Image decode failed."));
    image.src = dataUrl;
  });
}
