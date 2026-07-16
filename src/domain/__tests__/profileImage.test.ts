import { describe, expect, it } from "vitest";
import { MAX_PROFILE_IMAGE_BYTES, profileInitials, validateProfileImage } from "../profileImage";

describe("validateProfileImage", () => {
  it("accepts png, jpeg, and webp under the size limit", () => {
    for (const type of ["image/png", "image/jpeg", "image/webp"]) {
      expect(validateProfileImage({ type, size: 1024 })).toEqual({ ok: true });
    }
  });

  it("rejects non-image and unsupported image types", () => {
    for (const type of ["text/plain", "application/pdf", "image/svg+xml", ""]) {
      expect(validateProfileImage({ type, size: 1024 })).toEqual({
        ok: false,
        error: "Choose a PNG, JPEG, or WebP image.",
      });
    }
  });

  it("rejects files over the documented limit and accepts the boundary", () => {
    expect(validateProfileImage({ type: "image/png", size: MAX_PROFILE_IMAGE_BYTES })).toEqual({ ok: true });
    expect(validateProfileImage({ type: "image/png", size: MAX_PROFILE_IMAGE_BYTES + 1 })).toEqual({
      ok: false,
      error: "Choose an image up to 2 MB.",
    });
  });

  it("rejects empty, negative, and non-finite sizes", () => {
    for (const size of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) expect(validateProfileImage({ type: "image/png", size })).toEqual({
      ok: false,
      error: "That file is empty or invalid.",
    });
  });
});

describe("profileInitials", () => {
  it("normalizes whitespace and provides a safe fallback", () => {
    expect(profileInitials("  Priya   Raman ")).toBe("PR");
    expect(profileInitials("   ")).toBe("?");
  });
});
