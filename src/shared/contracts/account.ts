import { z } from "zod";
export const AccountLoginRequestSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(1).max(1024),
}).strict();
export const CurrentAccountSchema = z.object({
  profileId: z.string().uuid(),
  displayName: z.string().trim().min(1),
  role: z.enum(["USER", "OFFICER", "TREASURER"]),
}).strict();
export type CurrentAccount = z.infer<typeof CurrentAccountSchema>;
