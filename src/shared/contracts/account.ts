import { z } from "zod";
export const AccountLoginRequestSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(1).max(1024),
}).strict();
export const CurrentAccountSchema = z.object({
  profileId: z.string().uuid(),
  displayName: z.string().trim().min(1),
  role: z.enum(["USER", "OFFICER", "TREASURER"]),
  boardPosition: z.enum(["PRESIDENT", "VICE_PRESIDENT"]).nullable().optional(),
}).strict();
export type CurrentAccount = z.infer<typeof CurrentAccountSchema>;
export const AccountRegistrationRequestSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  displayName: z.string().trim().min(1).max(200),
  password: z.string().min(12).max(128),
  invitationCode: z.string().trim().regex(/^[A-Za-z0-9_-]{43}$/),
}).strict();
