import { z } from "zod";
import { CurrentAccountSchema } from "../../shared/contracts/account";
import { supabaseServerHeaders } from "../repositories/supabase/supabaseServerHeaders";
import { createRequestAuthClient } from "./supabaseAuth";
export const ServerActorSchema = CurrentAccountSchema;
export type ServerActor = z.infer<typeof ServerActorSchema>;
export type ServerActorResolver = (request: Request) => Promise<ServerActor | null>;
export type MeetingPermission = "read" | "review" | "approve" | "discard" | "sign";
const StoredProfileSchema = z.object({
  id: z.string().uuid(), account_type: z.literal("MEMBER"),
  member_role: z.enum(["USER", "OFFICER", "TREASURER"]),
  display_name: z.string().trim().min(1), account_status: z.literal("ACTIVE"),
}).strict();
export class ServerActorResolutionError extends Error {
  readonly code: string;
  constructor(message: string, {code = "actor_resolution_failed", cause}: {code?: string; cause?: unknown} = {}) {
    super(message, {cause}); this.name = "ServerActorResolutionError"; this.code = code;
  }
}
export function actorHasPermission(actor: ServerActor, permission: MeetingPermission) {
  if (permission === "read" || permission === "review") return true;
  if (permission === "sign") return actor.role === "TREASURER";
  return actor.role === "OFFICER" || actor.role === "TREASURER";
}
export async function loadServerActor(profileId: string, {
  apiUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL,
  secretKey = process.env.SUPABASE_SECRET_KEY, fetchImplementation = globalThis.fetch,
}: {apiUrl?: string; secretKey?: string; fetchImplementation?: typeof fetch} = {}): Promise<ServerActor | null> {
  if (!apiUrl || !secretKey) throw new ServerActorResolutionError("Account persistence is not configured.");
  const url = new URL("/rest/v1/profiles", apiUrl);
  url.searchParams.set("select", "id,account_type,member_role,display_name,account_status");
  url.searchParams.set("id", `eq.${z.string().uuid().parse(profileId)}`);
  url.searchParams.set("account_type", "eq.MEMBER"); url.searchParams.set("account_status", "eq.ACTIVE"); url.searchParams.set("limit", "1");
  const response = await fetchImplementation(url, {headers: supabaseServerHeaders(secretKey), cache: "no-store"});
  if (!response.ok) throw new ServerActorResolutionError("Account lookup failed.");
  const profile = StoredProfileSchema.array().max(1).parse(await response.json())[0];
  return profile ? {profileId: profile.id, displayName: profile.display_name, role: profile.member_role} : null;
}
export function createSupabaseServerActorResolver({
  verifyUser = async (request: Request) => {
    const {data, error} = await createRequestAuthClient(request).auth.getUser();
    if (error?.status && error.status >= 500) throw new ServerActorResolutionError("Account authentication is unavailable.");
    return error ? null : data.user?.id ?? null;
  }, ...options
}: {verifyUser?: (request: Request) => Promise<string | null>; apiUrl?: string; secretKey?: string; fetchImplementation?: typeof fetch} = {}): ServerActorResolver {
  return async request => { const id = await verifyUser(request); return id ? loadServerActor(id, options) : null; };
}
export const resolveServerActor = createSupabaseServerActorResolver();
