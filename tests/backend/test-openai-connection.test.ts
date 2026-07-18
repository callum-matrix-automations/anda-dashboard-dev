import { describe, expect, it, vi } from "vitest";
import {
  createOpenAiConnectionTester,
  OPENAI_CONNECTION_TEST_PROMPT,
} from "../../src/backend/services/ai/testOpenAiConnection";

describe("testOpenAiConnection", () => {
  it("sends only the fixed connectivity prompt through the OpenAI adapter", async () => {
    const createTextResponse = vi.fn().mockResolvedValue({
      responseId: "resp_test_001",
      model: "gpt-4.1-2025-04-14",
      status: "completed",
      outputText: "ANDA OpenAI connection successful.",
    });
    const client = { createTextResponse };

    await expect(createOpenAiConnectionTester(client)()).resolves.toEqual({
      status: "connected",
      provider: "openai",
      model: "gpt-4.1-2025-04-14",
      responseId: "resp_test_001",
      message: "ANDA OpenAI connection successful.",
    });
    expect(createTextResponse).toHaveBeenCalledWith(OPENAI_CONNECTION_TEST_PROMPT);
    expect(createTextResponse).not.toHaveBeenCalledWith(expect.stringContaining("transcript"));
  });
});
