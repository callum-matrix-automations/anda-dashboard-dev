import { createHash, timingSafeEqual } from "node:crypto";
import type { MasterAuthConfiguration } from "./masterSession";
import { normalizeMasterUsername } from "./masterSession";

export function verifyMasterCredentials(
  username: string,
  password: string,
  configuration: MasterAuthConfiguration,
) {
  return constantTimeTextEqual(normalizeMasterUsername(username), configuration.username)
    && constantTimeTextEqual(password, configuration.password);
}

function constantTimeTextEqual(left: string, right: string) {
  const leftDigest = createHash("sha256").update(left).digest();
  const rightDigest = createHash("sha256").update(right).digest();
  return timingSafeEqual(leftDigest, rightDigest);
}
