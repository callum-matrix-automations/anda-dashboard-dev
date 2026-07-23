import {
  openAiResponsesClient,
  type OpenAiResponsesClient,
} from "../../integrations/ai/openAiResponsesClient";

export const OPENAI_CONNECTION_TEST_PROMPT =
  "Return exactly the following text and nothing else: ANDA OpenAI connection successful.";

export interface OpenAiConnectionResult {
  status: "connected";
  provider: "openai";
  model: string;
  responseId: string;
  message: string;
}

export function createOpenAiConnectionTester(client: Pick<OpenAiResponsesClient, "createTextResponse">) {
  return async function testOpenAiConnection(): Promise<OpenAiConnectionResult> {
    const response = await client.createTextResponse(OPENAI_CONNECTION_TEST_PROMPT);
    return {
      status: "connected",
      provider: "openai",
      model: response.model,
      responseId: response.responseId,
      message: response.outputText,
    };
  };
}

export const testOpenAiConnection = createOpenAiConnectionTester(openAiResponsesClient);
