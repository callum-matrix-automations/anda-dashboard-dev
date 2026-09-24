import { z } from "zod";

export const MasterLoginRequestSchema = z.object({
  username: z.string().trim().min(1).max(64),
  password: z.string().min(1).max(1_024),
}).strict();

export const MasterLoginResponseSchema = z.object({
  ok: z.literal(true),
}).strict();

export type MasterLoginRequest = z.infer<typeof MasterLoginRequestSchema>;
