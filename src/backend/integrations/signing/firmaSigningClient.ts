import { z } from "zod";
import type {
  CreateSigningRequestInput,
  SigningRequestProvider,
  SigningRequestReference,
} from "./signingRequestProvider";

const DEFAULT_BASE_URL = "https://api.firma.dev/functions/v1/signing-request-api/";
const DEFAULT_API_VERSION = "1";

const FirmaCreatedRequestSchema = z.object({
  id: z.string().trim().min(1),
}).passthrough();

const FirmaListedRequestSchema = z.object({
  id: z.string().trim().min(1),
  name: z.string(),
  recipients: z.array(z.object({
    email: z.string(),
  }).passthrough()).default([]),
}).passthrough();

const FirmaListSchema = z.object({
  results: z.array(FirmaListedRequestSchema),
}).passthrough();

const FirmaRequestStatusSchema = z.object({
  status: z.string(),
}).passthrough();

const FirmaErrorSchema = z.object({
  message: z.string().optional(),
  error: z.string().optional(),
  code: z.string().optional(),
}).passthrough();

interface FirmaSigningClientOptions {
  apiKey?: string;
  baseUrl?: string;
  apiVersion?: string;
  fetchImplementation?: typeof fetch;
}

export class FirmaSigningClientError extends Error {
  readonly status?: number;
  readonly code: string;

  constructor(message: string, { status, code = "firma_request_failed", cause }: {
    status?: number;
    code?: string;
    cause?: unknown;
  } = {}) {
    super(message, { cause });
    this.name = "FirmaSigningClientError";
    this.status = status;
    this.code = code;
  }
}

export function createFirmaSigningClient({
  apiKey,
  baseUrl = DEFAULT_BASE_URL,
  apiVersion = DEFAULT_API_VERSION,
  fetchImplementation = globalThis.fetch,
}: FirmaSigningClientOptions = {}): SigningRequestProvider {
  const configuration = () => resolveConfiguration({
    apiKey,
    baseUrl,
    apiVersion,
    fetchImplementation,
  });

  async function findRequest(
    requestName: string,
    signerEmail: string,
  ): Promise<SigningRequestReference | null> {
    const resolved = configuration();
    const url = new URL("signing-requests", resolved.baseUrl);
    url.searchParams.set("name", requestName);
    url.searchParams.set("signer_email", signerEmail);
    url.searchParams.set("page", "1");
    url.searchParams.set("page_size", "10");
    const response = await fetchResponse(resolved, url, { method: "GET" }, "firma_lookup_failed");
    const body = await readJson(response);
    if (!response.ok) throw responseError(response, body, "Firma could not look up the signing request.", "firma_lookup_failed");
    const parsed = FirmaListSchema.safeParse(body);
    if (!parsed.success) {
      throw new FirmaSigningClientError("Firma returned an invalid signing request list.", {
        code: "firma_invalid_response",
        cause: parsed.error,
      });
    }
    const email = signerEmail.toLocaleLowerCase("en");
    const exactMatches = parsed.data.results.filter((request) => (
      request.name === requestName
      && request.recipients.some((recipient) => recipient.email.toLocaleLowerCase("en") === email)
    ));
    if (exactMatches.length > 1) {
      throw new FirmaSigningClientError("Firma returned more than one request for the approved PDF.", {
        code: "firma_ambiguous_request",
      });
    }
    return exactMatches[0] ? { id: exactMatches[0].id } : null;
  }

  async function createRequest(input: CreateSigningRequestInput): Promise<SigningRequestReference> {
    const resolved = configuration();
    const url = new URL("signing-requests", resolved.baseUrl);
    let response: Response;
    try {
      response = await fetchResponse(resolved, url, {
        method: "POST",
        body: JSON.stringify({
          name: input.requestName,
          description: input.description,
          document: Buffer.from(input.document).toString("base64"),
          recipients: [{
            id: "temp_treasurer",
            first_name: input.recipient.firstName,
            last_name: input.recipient.lastName,
            email: input.recipient.email,
            designation: "Signer",
            order: 1,
          }],
          anchor_tags: [{
            anchor_string: input.signatureAnchor,
            type: "signature",
            recipient_id: "temp_treasurer",
            width: 30,
            height: 6,
            occurrence: 1,
            ignore_if_not_present: false,
            remove_anchor_text: true,
            case_sensitive: true,
            match_whole_word: true,
          }],
          settings: {
            use_signing_order: false,
            send_signing_email: true,
            allow_download: true,
            attach_pdf_on_finish: true,
          },
        }),
      }, "firma_create_failed");
    } catch (error) {
      if (error instanceof FirmaSigningClientError && error.code === "firma_network_error") {
        const reconciled = await findRequest(input.requestName, input.recipient.email);
        if (reconciled) return reconciled;
      }
      throw error;
    }

    const body = await readJson(response);
    if (!response.ok) throw responseError(response, body, "Firma could not create the signing request.", "firma_create_failed");
    const parsed = FirmaCreatedRequestSchema.safeParse(body);
    if (!parsed.success) {
      throw new FirmaSigningClientError("Firma returned an invalid signing request.", {
        code: "firma_invalid_response",
        cause: parsed.error,
      });
    }
    return { id: parsed.data.id };
  }

  async function sendRequest(externalRequestId: string): Promise<void> {
    const resolved = configuration();
    const encodedId = encodeURIComponent(externalRequestId);
    const url = new URL(`signing-requests/${encodedId}/send`, resolved.baseUrl);
    let response: Response;
    try {
      response = await fetchResponse(resolved, url, {
        method: "POST",
        body: JSON.stringify({}),
      }, "firma_send_failed");
    } catch (error) {
      if (
        error instanceof FirmaSigningClientError
        && error.code === "firma_network_error"
        && await requestHasBeenSent(resolved, externalRequestId)
      ) return;
      throw error;
    }

    if (response.ok) return;
    const body = await readJson(response);
    if (response.status === 409 && await requestHasBeenSent(resolved, externalRequestId)) return;
    throw responseError(response, body, "Firma could not send the signing request.", "firma_send_failed");
  }

  return { findRequest, createRequest, sendRequest };
}

interface ResolvedFirmaConfiguration {
  apiKey: string;
  baseUrl: URL;
  apiVersion: string;
  fetchImplementation: typeof fetch;
}

function resolveConfiguration({
  apiKey,
  baseUrl,
  apiVersion,
  fetchImplementation,
}: Required<Pick<FirmaSigningClientOptions, "baseUrl" | "apiVersion">>
  & Pick<FirmaSigningClientOptions, "apiKey" | "fetchImplementation">): ResolvedFirmaConfiguration {
  const resolvedApiKey = apiKey ?? process.env.FIRMA_API_KEY;
  if (!resolvedApiKey?.trim()) {
    throw new FirmaSigningClientError("Firma signing is not configured.", {
      code: "firma_not_configured",
    });
  }
  if (typeof fetchImplementation !== "function") {
    throw new FirmaSigningClientError("A fetch implementation is required for Firma signing.", {
      code: "fetch_not_configured",
    });
  }
  const resolvedBaseUrl = new URL(baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`);
  return {
    apiKey: resolvedApiKey.trim(),
    baseUrl: resolvedBaseUrl,
    apiVersion,
    fetchImplementation,
  };
}

async function fetchResponse(
  configuration: ResolvedFirmaConfiguration,
  url: URL,
  init: RequestInit,
  operationCode: string,
): Promise<Response> {
  try {
    return await configuration.fetchImplementation(url, {
      ...init,
      headers: {
        accept: "application/json",
        authorization: configuration.apiKey,
        "content-type": "application/json",
        "x-api-version": configuration.apiVersion,
        ...init.headers,
      },
    });
  } catch (error) {
    throw new FirmaSigningClientError("Firma could not be reached.", {
      code: "firma_network_error",
      cause: new Error(operationCode, { cause: error }),
    });
  }
}

async function requestHasBeenSent(
  configuration: ResolvedFirmaConfiguration,
  externalRequestId: string,
): Promise<boolean> {
  const encodedId = encodeURIComponent(externalRequestId);
  const url = new URL(`signing-requests/${encodedId}`, configuration.baseUrl);
  let response: Response;
  try {
    response = await fetchResponse(configuration, url, { method: "GET" }, "firma_status_failed");
  } catch {
    return false;
  }
  if (!response.ok) return false;
  const parsed = FirmaRequestStatusSchema.safeParse(await readJson(response));
  if (!parsed.success) return false;
  return ["sent", "in_progress", "finished"].includes(parsed.data.status.toLocaleLowerCase("en"));
}

function responseError(
  response: Response,
  body: unknown,
  fallback: string,
  code: string,
): FirmaSigningClientError {
  const parsed = FirmaErrorSchema.safeParse(body);
  const providerMessage = parsed.success
    ? parsed.data.message ?? parsed.data.error
    : undefined;
  const message = providerMessage?.trim()
    ? providerMessage.trim().slice(0, 2_000)
    : fallback;
  return new FirmaSigningClientError(message, { status: response.status, code });
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export const firmaSigningClient = createFirmaSigningClient();
