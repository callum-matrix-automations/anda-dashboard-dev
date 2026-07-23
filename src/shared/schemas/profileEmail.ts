import { z } from "zod";

export const NormalizedProfileEmailSchema = z.string()
  .trim()
  .toLowerCase()
  .email()
  .max(320);

export function normalizeProfileEmail(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const parsed = NormalizedProfileEmailSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
