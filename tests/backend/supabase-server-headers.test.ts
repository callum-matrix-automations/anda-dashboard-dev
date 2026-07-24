import { describe, expect, it } from "vitest";
import { supabaseServerHeaders } from "../../src/backend/repositories/supabase/supabaseServerHeaders";

describe("supabaseServerHeaders", () => {
  it("uses the legacy JWT key as both the apikey and bearer credential", () => {
    expect(supabaseServerHeaders("legacy-service-role", {
      "content-type": "application/json",
    })).toEqual({
      apikey: "legacy-service-role",
      authorization: "Bearer legacy-service-role",
      "content-type": "application/json",
    });
  });

  it("does not send hosted opaque secret keys as bearer tokens", () => {
    expect(supabaseServerHeaders("sb_secret_hosted", {
      "content-type": "application/json",
    })).toEqual({
      apikey: "sb_secret_hosted",
      "content-type": "application/json",
    });
  });
});
