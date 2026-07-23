import { z } from "zod";

export const DEFAULT_OPENAI_MODEL = "gpt-5.6-terra";
export const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const DEFAULT_TIMEOUT_MS = 60_000;

const OpenAiResponseSchema = z.object({
  id: z.string().min(1),
  model: z.string().min(1),
  status: z.string().min(1),
  output: z.array(z.object({
    type: z.string(),
    content: z.array(z.object({
      type: z.string(),
      text: z.string().optional(),
    }).passthrough()).optional(),
  }).passthrough()),
}).passthrough();

const OpenAiErrorSchema = z.object({
  error: z.object({
    message: z.string(),
    code: z.union([z.string(), z.null()]).optional(),
  }),
});

export interface OpenAiTextResponse {
  responseId: string;
  model: string;
  status: string;
  outputText: string;
  requestId?: string;
}

export interface OpenAiStructuredResponseRequest {
  instructions: string;
  input: string;
  schemaName: string;
  schema: Record<string, unknown>;
  maxOutputTokens?: number;
}

export interface OpenAiResponsesClient {
  createTextResponse(input: string): Promise<OpenAiTextResponse>;
  createStructuredResponse(request: OpenAiStructuredResponseRequest): Promise<OpenAiTextResponse>;
}

interface OpenAiResponsesClientOptions {
  apiKey?: string;
  model?: string;
  endpoint?: string;
  fetchImplementation?: typeof fetch;
  timeoutMs?: number;
}

export class OpenAiApiError extends Error {
  readonly status?: number;
  readonly code?: string;
  readonly requestId?: string;

  constructor(
    message: string,
    { status, code, requestId, cause }: {
      status?: number;
      code?: string;
      requestId?: string;
      cause?: unknown;
    } = {},
  ) {
    super(message, { cause });
    this.name = "OpenAiApiError";
    this.status = status;
    this.code = code;
    this.requestId = requestId;
  }
}

export function createOpenAiResponsesClient({
  apiKey,
  model = process.env.OPENAI_MODEL ?? DEFAULT_OPENAI_MODEL,
  endpoint = OPENAI_RESPONSES_URL,
  fetchImplementation = globalThis.fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}: OpenAiResponsesClientOptions = {}): OpenAiResponsesClient {
  async function sendResponse(body: Record<string, unknown>): Promise<OpenAiTextResponse> {
    const resolvedApiKey = apiKey ?? process.env.OPENAI_API_KEY;
    if (!resolvedApiKey?.trim()) {
      throw new OpenAiApiError("OpenAI API access is not configured.", {
        code: "openai_not_configured",
      });
    }
    if (typeof fetchImplementation !== "function") {
      throw new OpenAiApiError("A fetch implementation is required for OpenAI requests.", {
        code: "fetch_not_configured",
      });
    }
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      throw new OpenAiApiError("OpenAI request timeout must be positive.", {
        code: "invalid_openai_timeout",
      });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await fetchImplementation(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
          authorization: `Bearer ${resolvedApiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      throw new OpenAiApiError(
        controller.signal.aborted ? "OpenAI request timed out." : "OpenAI request failed.",
        {
          code: controller.signal.aborted ? "openai_timeout" : "openai_request_failed",
          cause: error,
        },
      );
    } finally {
      clearTimeout(timeout);
    }

    const requestId = response.headers.get("x-request-id") ?? undefined;
    const responseBody = await readResponseBody(response);
    if (!response.ok) {
      const errorBody = OpenAiErrorSchema.safeParse(responseBody);
      throw new OpenAiApiError(
        errorBody.success ? errorBody.data.error.message : `OpenAI returned HTTP ${response.status}.`,
        {
          status: response.status,
          code: errorBody.success ? errorBody.data.error.code ?? "openai_response_failed" : "openai_response_failed",
          requestId,
        },
      );
    }

    const parsed = OpenAiResponseSchema.safeParse(responseBody);
    if (!parsed.success) {
      throw new OpenAiApiError("OpenAI returned an invalid response payload.", {
        status: response.status,
        code: "invalid_openai_response",
        requestId,
      });
    }

    const outputText = parsed.data.output
      .flatMap((item) => item.content ?? [])
      .filter((content) => content.type === "output_text")
      .map((content) => content.text ?? "")
      .join("")
      .trim();
    if (!outputText) {
      throw new OpenAiApiError("OpenAI completed without returning text.", {
        status: response.status,
        code: "missing_openai_output",
        requestId,
      });
    }

    return {
      responseId: parsed.data.id,
      model: parsed.data.model,
      status: parsed.data.status,
      outputText,
      ...(requestId ? { requestId } : {}),
    };
  }

  return {
    async createTextResponse(input: string): Promise<OpenAiTextResponse> {
      if (!input.trim()) {
        throw new OpenAiApiError("OpenAI input must not be blank.", {
          code: "invalid_openai_input",
        });
      }
      return sendResponse({
        model,
        input,
        max_output_tokens: 32,
        store: false,
      });
    },

    async createStructuredResponse({
      instructions,
      input,
      schemaName,
      schema,
      maxOutputTokens = 8_000,
    }: OpenAiStructuredResponseRequest): Promise<OpenAiTextResponse> {
      if (!instructions.trim() || !input.trim()) {
        throw new OpenAiApiError("OpenAI instructions and input must not be blank.", {
          code: "invalid_openai_input",
        });
      }
      if (!/^[A-Za-z0-9_-]{1,64}$/u.test(schemaName)) {
        throw new OpenAiApiError("OpenAI schema name is invalid.", {
          code: "invalid_openai_schema",
        });
      }
      if (!Number.isInteger(maxOutputTokens) || maxOutputTokens <= 0) {
        throw new OpenAiApiError("OpenAI max output tokens must be a positive integer.", {
          code: "invalid_openai_output_limit",
        });
      }

      return sendResponse({
        model,
        instructions,
        input,
        text: {
          format: {
            type: "json_schema",
            name: schemaName,
            strict: true,
            schema,
          },
        },
        max_output_tokens: maxOutputTokens,
        store: false,
      });
    },
  };
}

async function readResponseBody(response: Response): Promise<unknown> {
  const responseText = await response.text();
  if (!responseText) return null;
  try {
    return JSON.parse(responseText);
  } catch {
    return responseText;
  }
}

export const openAiResponsesClient = createOpenAiResponsesClient();
