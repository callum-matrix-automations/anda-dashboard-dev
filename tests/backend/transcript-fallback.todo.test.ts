import { describe, it } from "vitest";

describe("transcript persistence fallback", () => {
  it.todo("queues a validated transcript after all Supabase retries are exhausted");
  it.todo("replays a queued transcript without creating a duplicate after Supabase recovers");
  it.todo("records operator-visible recovery details without logging transcript content");
});
