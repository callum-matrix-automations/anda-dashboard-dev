import { describe, expect, it, vi } from "vitest";
import {
  createOpenAiConnectionTester,
  OPENAI_CONNECTION_TEST_PROMPT,
} from "../../src/backend/services/ai/testOpenAiConnection";

describe("testOpenAiConnection", () => {
  it("sends only the fixed connectivity prompt through the OpenAI adapter", async () => {
    const createTextResponse = vi.fn().mockResolvedValue({
      responseId: "resp_test_001",
      model: "gpt-5.6-terra",
      status: "completed",
      outputText: "ANDA OpenAI connection successful.",
    });
    const client = { createTextResponse };

    await expect(createOpenAiConnectionTester(client)()).resolves.toEqual({
      status: "connected",
      provider: "openai",
      model: "gpt-5.6-terra",
      responseId: "resp_test_001",
      message: "ANDA OpenAI connection successful.",
    });
    expect(createTextResponse).toHaveBeenCalledWith(OPENAI_CONNECTION_TEST_PROMPT);
    expect(createTextResponse).not.toHaveBeenCalledWith(expect.stringContaining("transcript"));
  });
});
