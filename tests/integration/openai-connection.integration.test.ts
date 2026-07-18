import { describe, expect, it } from "vitest";
import { testOpenAiConnection } from "../../src/backend/services/ai/testOpenAiConnection";

const openAiConfigured = Boolean(process.env.OPENAI_API_KEY?.trim());

describe.skipIf(!openAiConfigured)("live OpenAI connection", () => {
  it("sends a minimal GPT-4.1 request through the backend service", async () => {
    const result = await testOpenAiConnection();

    expect(result).toMatchObject({
      status: "connected",
      provider: "openai",
      message: "ANDA OpenAI connection successful.",
    });
    expect(result.model).toMatch(/^gpt-4\.1(?:-|$)/u);
    expect(result.responseId).toMatch(/^resp_/u);
  }, 30_000);
});
