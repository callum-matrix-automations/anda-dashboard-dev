import { describe, expect, it, vi } from "vitest";
import {
  createOpenAiResponsesClient,
  OpenAiApiError,
  OPENAI_RESPONSES_URL,
} from "../../src/backend/integrations/ai/openAiResponsesClient";

const fakeApiKey = "test-openai-key-never-use";

function completedResponse() {
  return Response.json({
    id: "resp_test_001",
    model: "gpt-4.1-2025-04-14",
    status: "completed",
    output: [{
      type: "message",
      content: [{
        type: "output_text",
        text: "ANDA OpenAI connection successful.",
      }],
    }],
  }, {
    headers: { "x-request-id": "req_test_001" },
  });
}

describe("OpenAI Responses client", () => {
  it("sends a non-stored GPT-4.1 Responses API request and extracts output text", async () => {
    const fetchImplementation = vi.fn().mockResolvedValue(completedResponse());
    const client = createOpenAiResponsesClient({ apiKey: fakeApiKey, fetchImplementation });

    await expect(client.createTextResponse("Connection test")).resolves.toEqual({
      responseId: "resp_test_001",
      model: "gpt-4.1-2025-04-14",
      status: "completed",
      outputText: "ANDA OpenAI connection successful.",
      requestId: "req_test_001",
    });

    expect(fetchImplementation).toHaveBeenCalledOnce();
    const [url, request] = fetchImplementation.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(OPENAI_RESPONSES_URL);
    expect(request.method).toBe("POST");
    expect(request.headers).toMatchObject({
      authorization: `Bearer ${fakeApiKey}`,
      "content-type": "application/json",
    });
    expect(JSON.parse(String(request.body))).toEqual({
      model: "gpt-4.1",
      input: "Connection test",
      max_output_tokens: 32,
      store: false,
    });
  });

  it("sends a strict JSON Schema through Responses API text.format", async () => {
    const fetchImplementation = vi.fn().mockResolvedValue(completedResponse());
    const client = createOpenAiResponsesClient({ apiKey: fakeApiKey, fetchImplementation });
    const schema = {
      type: "object",
      properties: { answer: { type: "string" } },
      required: ["answer"],
      additionalProperties: false,
    };

    await client.createStructuredResponse({
      instructions: "Return a structured answer.",
      input: "Question",
      schemaName: "test_answer",
      schema,
      maxOutputTokens: 500,
    });

    const [, request] = fetchImplementation.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(request.body))).toEqual({
      model: "gpt-4.1",
      instructions: "Return a structured answer.",
      input: "Question",
      text: {
        format: {
          type: "json_schema",
          name: "test_answer",
          strict: true,
          schema,
        },
      },
      max_output_tokens: 500,
      store: false,
    });
  });

  it("fails before making a request when the API key is missing", async () => {
    const fetchImplementation = vi.fn();
    const client = createOpenAiResponsesClient({ apiKey: "", fetchImplementation });

    await expect(client.createTextResponse("Connection test")).rejects.toMatchObject({
      code: "openai_not_configured",
    });
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it("maps API errors without including the configured credential", async () => {
    const fetchImplementation = vi.fn().mockResolvedValue(Response.json({
      error: {
        message: "The API key is not valid.",
        code: "invalid_api_key",
      },
    }, {
      status: 401,
      headers: { "x-request-id": "req_failed_001" },
    }));
    const client = createOpenAiResponsesClient({ apiKey: fakeApiKey, fetchImplementation });

    const error = await client.createTextResponse("Connection test").catch((caught) => caught);

    expect(error).toBeInstanceOf(OpenAiApiError);
    expect(error).toMatchObject({
      status: 401,
      code: "invalid_api_key",
      requestId: "req_failed_001",
    });
    expect(String(error)).not.toContain(fakeApiKey);
  });

  it("rejects a successful response that contains no output text", async () => {
    const fetchImplementation = vi.fn().mockResolvedValue(Response.json({
      id: "resp_empty_001",
      model: "gpt-4.1-2025-04-14",
      status: "completed",
      output: [],
    }));
    const client = createOpenAiResponsesClient({ apiKey: fakeApiKey, fetchImplementation });

    await expect(client.createTextResponse("Connection test")).rejects.toMatchObject({
      code: "missing_openai_output",
    });
  });
});
