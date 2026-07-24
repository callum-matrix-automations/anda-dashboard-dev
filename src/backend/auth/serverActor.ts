import { z } from "zod";
import { supabaseServerHeaders } from "../repositories/supabase/supabaseServerHeaders";

export const ServerActorSchema = z.object({
  profileId: z.string().uuid(),
  displayName: z.string().trim().min(1),
  role: z.enum(["USER", "OFFICER", "TREASURER"]),
  isAdmin: z.boolean(),
}).strict();

export type ServerActor = z.infer<typeof ServerActorSchema>;
export type ServerActorResolver = (request: Request) => Promise<ServerActor | null>;
export type MeetingPermission = "read" | "review" | "sign";

const StoredProfileSchema = z.object({
  id: z.string().uuid(),
  account_type: z.literal("MEMBER"),
  member_role: z.enum(["USER", "OFFICER", "TREASURER"]),
  is_admin: z.boolean(),
  display_name: z.string().trim().min(1),
  account_status: z.literal("ACTIVE"),
}).strict();

export class ServerActorResolutionError extends Error {
  readonly code: string;

  constructor(message: string, { code = "actor_resolution_failed", cause }: {
    code?: string;
    cause?: unknown;
  } = {}) {
    super(message, { cause });
    this.name = "ServerActorResolutionError";
    this.code = code;
  }
}

export function actorHasPermission(actor: ServerActor, permission: MeetingPermission) {
  if (permission === "read") return true;
  if (permission === "sign") return actor.role === "TREASURER";
  return actor.role === "OFFICER" || actor.role === "TREASURER";
}

export function createSupabaseServerActorResolver({
  apiUrl,
  secretKey,
  developmentProfileId,
  stagingProfileId,
  applicationEnvironment,
  nodeEnvironment,
  fetchImplementation = globalThis.fetch,
}: {
  apiUrl?: string;
  secretKey?: string;
  developmentProfileId?: string;
  stagingProfileId?: string;
  applicationEnvironment?: string;
  nodeEnvironment?: string;
  fetchImplementation?: typeof fetch;
} = {}): ServerActorResolver {
  return async function resolveServerActor() {
    const environment = nodeEnvironment ?? process.env.NODE_ENV;
    const deploymentEnvironment = applicationEnvironment ?? process.env.ANDA_ENVIRONMENT;
    const configuredProfileId = environment === "production"
      ? deploymentEnvironment === "staging"
        ? stagingProfileId ?? process.env.ANDA_STAGING_ACTOR_PROFILE_ID
        : null
      : developmentProfileId ?? process.env.ANDA_DEV_ACTOR_PROFILE_ID;

    // A real authenticated-session resolver will replace these temporary fixed
    // identities when Microsoft OAuth is implemented. Production fails closed
    // except for the explicit staging identity used by client testing.
    if (!configuredProfileId?.trim()) return null;

    const parsedProfileId = z.string().uuid().safeParse(configuredProfileId.trim());
    if (!parsedProfileId.success) {
      throw new ServerActorResolutionError("The configured server actor profile ID is invalid.", {
        code: "actor_not_configured",
        cause: parsedProfileId.error,
      });
    }

    const resolvedApiUrl = apiUrl ?? process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
    const resolvedSecretKey = secretKey ?? process.env.SUPABASE_SECRET_KEY;
    if (!resolvedApiUrl || !resolvedSecretKey || typeof fetchImplementation !== "function") {
      throw new ServerActorResolutionError("Server actor persistence is not configured.", {
        code: "actor_persistence_not_configured",
      });
    }

    const profilesUrl = new URL("/rest/v1/profiles", resolvedApiUrl);
    profilesUrl.searchParams.set(
      "select",
      "id,account_type,member_role,is_admin,display_name,account_status",
    );
    profilesUrl.searchParams.set("id", `eq.${parsedProfileId.data}`);
    profilesUrl.searchParams.set("account_type", "eq.MEMBER");
    profilesUrl.searchParams.set("account_status", "eq.ACTIVE");
    profilesUrl.searchParams.set("limit", "1");

    let response: Response;
    try {
      response = await fetchImplementation(profilesUrl, {
        headers: supabaseServerHeaders(resolvedSecretKey, {
          accept: "application/json",
        }),
      });
    } catch (error) {
      throw new ServerActorResolutionError("The server actor profile could not be loaded.", {
        cause: error,
      });
    }

    if (!response.ok) {
      throw new ServerActorResolutionError("The server actor profile lookup failed.", {
        code: "actor_persistence_failed",
      });
    }

    const parsedProfiles = StoredProfileSchema.array().max(1).safeParse(await response.json());
    if (!parsedProfiles.success) {
      throw new ServerActorResolutionError("The server actor profile response was invalid.", {
        code: "invalid_actor_response",
        cause: parsedProfiles.error,
      });
    }
    const profile = parsedProfiles.data[0];
    if (!profile) return null;

    return ServerActorSchema.parse({
      profileId: profile.id,
      displayName: profile.display_name,
      role: profile.member_role,
      isAdmin: profile.is_admin,
    });
  };
}

export const resolveServerActor = createSupabaseServerActorResolver();
